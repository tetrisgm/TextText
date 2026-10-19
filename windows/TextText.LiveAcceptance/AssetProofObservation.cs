using System.Collections;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TextText.Core;

// Private actor observation only. No recovery, Open, Follow, or directory creation.
internal static class AssetProofObservation
{
    const int Limit = 64 * 1024 * 1024;
    static IOException Refusal() => new("Readonly asset observation unavailable or changed.");
    internal static string Request(JsonElement value)
    {
        var fields = value.ValueKind == JsonValueKind.Object ? value.EnumerateObject().ToArray() : [];
        if (fields.Length != 2 || !fields.Select(x => x.Name).Order().SequenceEqual(new[] { "sampleId", "version" }) ||
            !value.GetProperty("version").TryGetInt32(out var version) || version != 1 ||
            value.GetProperty("sampleId").ValueKind != JsonValueKind.String) throw Refusal();
        var id = value.GetProperty("sampleId").GetString()!;
        if (!Guid.TryParseExact(id, "D", out var uuid) || uuid.ToString("D") != id) throw Refusal();
        return id;
    }
    internal static bool SafePath(string path) => Encoding.UTF8.GetByteCount(path) is > 0 and <= 1024 &&
        !path.StartsWith('/') && !path.Any(c => c < 32 || c == 127 || "\\:<>\"|?*".Contains(c)) &&
        path.Split('/').All(c => c.Length > 0 && c is not ("." or ".."));
    internal sealed record Capture(object Editing, object Store, object Active, object Token, string Path, string Fingerprint);
    internal static async Task<Capture> CaptureSession(object bridge, string itemId, string accountId, string workspaceId, Uri origin, string root, CancellationToken ct)
    {
        const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
        var editing = bridge.GetType().GetField("editing", flags)?.GetValue(bridge) ?? throw Refusal();
        var gate = editing.GetType().GetField("gate", flags)?.GetValue(editing) as SemaphoreSlim ?? throw Refusal();
        await gate.WaitAsync(ct);
        try
        {
            if (editing.GetType().GetField("disposed", flags)?.GetValue(editing) is not false) throw Refusal();
            var sessions = editing.GetType().GetField("sessions", flags)?.GetValue(editing) as IDictionary ?? throw Refusal();
            var matches = new List<DictionaryEntry>();
            foreach (DictionaryEntry entry in sessions)
                if (entry.Value?.GetType().GetProperty("ItemId")?.GetValue(entry.Value) as string == itemId) matches.Add(entry);
            if (matches.Count != 1) throw Refusal();
            var match = matches[0]; var active = match.Value!;
            var path = active.GetType().GetProperty("Path")?.GetValue(active) as string ?? throw Refusal();
            if (!SafePath(path) || !path.EndsWith(".textpack", StringComparison.Ordinal)) throw Refusal();
            // Primary-constructor fields are deliberately discovered by unique TYPE,
            // not a guessed compiler-generated field name; ambiguity fails closed.
            var stores = editing.GetType().GetFields(flags).Where(f => f.FieldType == typeof(TextPackStore)).Select(f => f.GetValue(editing)).ToArray();
            if (stores.Length != 1 || stores[0] is not TextPackStore store ||
                Path.GetFullPath(store.Root) != Path.GetFullPath(root)) throw Refusal();
            if (editing.GetType().GetField("principalAccountId", flags)?.GetValue(editing) as string != accountId) throw Refusal();
            AccountRootOwnership.RequireNoAdoption(store.StateDirectory);
            var expectedMethod = typeof(AccountRootOwnership).GetMethod("Expected", BindingFlags.Static | BindingFlags.NonPublic) ?? throw Refusal();
            var expectedOwner = expectedMethod.Invoke(null, [store, origin, workspaceId, accountId]) ?? throw Refusal();
            var ownerPath = Path.Combine(store.StateDirectory, AccountRootOwnership.FileName);
            var ownerBytes = RetainedFileReplacement.Read(ownerPath, 4096);
            RetainedFileReplacement.JsonFields(ownerBytes,["Version","Origin","WorkspaceId","AccountId","RootHash"],["Version","Origin","WorkspaceId","AccountId","RootHash"]);
            var owner = JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes) ?? throw Refusal();
            if (owner.Version is not (1 or 2) || (owner with { Version = 1 }) != (AccountRootOwnership.Owner)expectedOwner) throw Refusal();
            var profile = ProfileProof(store, owner);
            var history = CompletedHistory(store, owner);
            var method = editing.GetType().GetMethod("ReadProtectionSnapshot", BindingFlags.Static | BindingFlags.NonPublic) ?? throw Refusal();
            var protection = method.Invoke(null, [store, itemId, accountId]) ?? throw Refusal();
            if (protection.GetType().GetProperty("Protected")?.GetValue(protection) is not false) throw Refusal();
            var fingerprint = protection.GetType().GetProperty("Fingerprint")?.GetValue(protection) as string ?? throw Refusal();
            if (!ownerBytes.SequenceEqual(RetainedFileReplacement.Read(ownerPath, 4096)) || profile != ProfileProof(store, owner)) throw Refusal();
            if(history != CompletedHistory(store, owner))throw Refusal();
            return new(editing, store, active, match.Key, path, TextPackStore.Hash(ownerBytes) + ":" + profile + ":" + history + ":" + fingerprint);
        }
        finally { gate.Release(); }
    }
    static string CompletedHistory(TextPackStore store, AccountRootOwnership.Owner owner) {
        var principal = RetainedReplacementProfile.PrincipalHash(owner);
        var assembly = typeof(TextPackStore).Assembly;
        var folderType = assembly.GetType("TextText.Core.FolderCaseRename") ?? throw Refusal();
        var folder = Activator.CreateInstance(folderType, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public, null, [store], null) ?? throw Refusal();
        var sources = new object[] { new ReplacementRecoveryRegistry(store.Root, store.StateDirectory), folder };
        var proof = new SortedDictionary<string,string>(StringComparer.Ordinal);
        foreach(var source in sources) {
            var method = source.GetType().GetMethod("ReadCompletedHistory", BindingFlags.Instance | BindingFlags.NonPublic) ?? throw Refusal();
            if(method.Invoke(source,[principal]) is not Dictionary<string,string> entries)throw Refusal();
            foreach(var entry in entries)proof.Add(source.GetType().Name+"/"+entry.Key,entry.Value);
        }
        return TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(proof));
    }
    static string ProfileProof(TextPackStore store, AccountRootOwnership.Owner owner) {
        var directory = Path.Combine(store.StateDirectory, "retained-replacement-profile");
        RetainedFileReplacement.CheckPath(directory);
        var rootNames = Directory.GetFileSystemEntries(store.StateDirectory);
        if (rootNames.Length > 10000 || rootNames.Any(p => Path.GetFileName(p).StartsWith(".owner-v2-", StringComparison.Ordinal))) throw Refusal();
        if (owner.Version == 1) { if (Directory.Exists(directory) || File.Exists(directory)) throw Refusal(); return "none"; }
        if (!Directory.Exists(directory)) throw Refusal();
        var files = Directory.GetFileSystemEntries(directory);
        var known = new[] { "profile.json", "owner-v1.json", "owner-displaced.json", "profile-v1.json", "profile-v1-displaced.json", "profile-v2.json", "profile-v2-displaced.json", "profile-v3.json", "profile-v3-displaced.json", "profile-v4.json", "profile-v4-displaced.json", "profile-v5.json", "profile-v5-displaced.json" };
        if (files.Length > known.Length || files.Any(path => !known.Contains(Path.GetFileName(path), StringComparer.Ordinal))) throw Refusal();
        // Entire existing C# method is fixed byte/hash/schema validation only.
        // Do NOT invoke public Verify: it acquires/creates a migration lease.
        var verify = typeof(RetainedReplacementProfile).GetMethod("VerifyUnlocked", BindingFlags.Static | BindingFlags.NonPublic) ?? throw Refusal();
        verify.Invoke(null, [store.StateDirectory, owner, TextPackStore.Hash(Encoding.UTF8.GetBytes(store.Root))]);
        var hashes = new SortedDictionary<string,string>(StringComparer.Ordinal);
        foreach (var path in files) hashes.Add(Path.GetFileName(path), TextPackStore.Hash(RetainedFileReplacement.Read(path,8192)));
        verify.Invoke(null, [store.StateDirectory, owner, TextPackStore.Hash(Encoding.UTF8.GetBytes(store.Root))]);
        if (!files.Order(StringComparer.Ordinal).SequenceEqual(Directory.GetFileSystemEntries(directory).Order(StringComparer.Ordinal))) throw Refusal();
        return TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(hashes));
    }
    internal static void Unchanged(Capture before, Capture after)
    {
        if (!ReferenceEquals(before.Editing, after.Editing) || !ReferenceEquals(before.Store, after.Store) ||
            !ReferenceEquals(before.Active, after.Active) || !Equals(before.Token, after.Token) ||
            before.Path != after.Path || before.Fingerprint != after.Fingerprint) throw Refusal();
    }
    internal sealed record Pack(string ArchiveHash, string RawDocument, IReadOnlyDictionary<string, string> Assets);
    static HashSet<string> RawNames(byte[] bytes) {
        int N(int offset, int size) {
            if (offset < 0 || offset > bytes.Length - size) throw Refusal();
            long value = 0; for (var i = 0; i < size; i++) value |= (long)bytes[offset + i] << (8 * i);
            if (value > int.MaxValue) throw Refusal(); return (int)value;
        }
        if (bytes.Length < 22) throw Refusal();
        var end = -1;
        for (var o = bytes.Length - 22; o >= Math.Max(0, bytes.Length - 65557); o--)
            if (N(o, 4) == 0x06054b50 && o + 22 + N(o + 20, 2) == bytes.Length) { end = o; break; }
        if (end < 0 || N(end + 4, 2) != 0 || N(end + 6, 2) != 0) throw Refusal();
        var count = N(end + 10, 2); var size = N(end + 12, 4); var start = N(end + 16, 4);
        if (count is < 1 or > 10000 || N(end + 8, 2) != count || (long)start + size != end) throw Refusal();
        var cursor = start; var names = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < count; i++) {
            if (N(cursor, 4) != 0x02014b50) throw Refusal();
            var flags = N(cursor + 8, 2); var method = N(cursor + 10, 2);
            var length = N(cursor + 28, 2); var extra = N(cursor + 30, 2); var comment = N(cursor + 32, 2);
            var local = N(cursor + 42, 4); var compressed = N(cursor + 20, 4);
            if ((flags & 1) != 0 || method is not (0 or 8) || length == 0 || (long)cursor + 46 + length + extra + comment > end) throw Refusal();
            var name = new UTF8Encoding(false, true).GetString(bytes, cursor + 46, length);
            if (((flags & 0x800) == 0 && name.Any(c => c > 127)) || !names.Add(name) || N(cursor + 34, 2) != 0 ||
                N(local, 4) != 0x04034b50 || N(local + 6, 2) != flags || N(local + 8, 2) != method || N(local + 26, 2) != length) throw Refusal();
            var localExtra = N(local + 28, 2);
            if ((long)local + 30 + length + localExtra + compressed > start ||
                !bytes.AsSpan(local + 30, length).SequenceEqual(Encoding.UTF8.GetBytes(name))) throw Refusal();
            cursor += 46 + length + extra + comment;
        }
        if (cursor != end) throw Refusal(); return names;
    }
    static Dictionary<string, byte[]> Entries(byte[] bytes)
    {
        if (bytes.Length is 0 or > Limit) throw Refusal();
        var names = RawNames(bytes);
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        var entries = new Dictionary<string, byte[]>(StringComparer.Ordinal); long total = 0;
        foreach (var entry in zip.Entries)
        {
            total = checked(total + entry.Length);
            if (entries.Count >= 10000 || total > Limit || !SafePath(entry.FullName.TrimEnd('/')) ||
                entries.ContainsKey(entry.FullName) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw Refusal();
            using var input = entry.Open(); using var output = new MemoryStream();
            var buffer = new byte[65536]; int read;
            while ((read = input.Read(buffer)) > 0) { if (output.Length + read > Limit) throw Refusal(); output.Write(buffer, 0, read); }
            if (output.Length != entry.Length || Crc32(output.ToArray()) != entry.Crc32) throw Refusal();
            entries.Add(entry.FullName, output.ToArray());
        }
        if (!names.SetEquals(entries.Keys)) throw Refusal();
        return entries;
    }
    internal static Pack Inspect(byte[] bytes, string itemId)
    {
        var entries = Entries(bytes);
        if (TextPackStore.Identity(bytes) != itemId) throw Refusal();
        var roots = entries.Keys.Where(k => k == "text.md" || Regex.IsMatch(k, @"\A[^/]+/text\.md\z"))
            .Select(k => k[..^7]).Where(k => entries.ContainsKey(k + "document.json")).ToArray();
        if (roots.Length != 1) throw Refusal();
        var prefix = roots[0]; var raw = new UTF8Encoding(false, true).GetString(entries[prefix + "document.json"]);
        if (Encoding.UTF8.GetByteCount(raw) > 262144) throw Refusal();
        using var json = JsonDocument.Parse(raw);
        var body = json.RootElement.GetProperty("content").GetProperty("body").GetString() ?? throw Refusal();
        var markdown = new UTF8Encoding(false, true).GetString(entries[prefix + "text.md"]);
        if (markdown.StartsWith('\uFEFF')) markdown = markdown[1..];
        var match = Regex.Match(markdown, @"\A---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)\z");
        if ((match.Success ? match.Groups[1].Value : markdown) != body) throw Refusal();
        var header = Regex.Match(markdown, @"\A---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)");
        if (header.Success) {
            var titles = Regex.Matches(header.Groups[1].Value, @"^title:[ \t]*(.*?)[ \t]*\r?$", RegexOptions.Multiline);
            if (titles.Count > 1) throw Refusal();
            if (titles.Count == 1) {
                var title = titles[0].Groups[1].Value;
                if (title.StartsWith('"')) title = JsonSerializer.Deserialize<string>(title) ?? throw Refusal();
                if (title != json.RootElement.GetProperty("content").GetProperty("title").GetString()) throw Refusal();
            }
        }
        var assets = entries.Where(e => e.Key.StartsWith(prefix + "assets/", StringComparison.Ordinal) && !e.Key.EndsWith('/'))
            .ToDictionary(e => e.Key[prefix.Length..], e => TextPackStore.Hash(e.Value), StringComparer.Ordinal);
        if (assets.Count is < 1 or > 32) throw Refusal();
        return new(TextPackStore.Hash(bytes), raw, assets);
    }
    static uint Crc32(byte[] bytes) {
        uint crc = 0xFFFFFFFF;
        foreach (var value in bytes) { crc ^= value; for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xEDB88320u : 0u); }
        return ~crc;
    }
    internal static void RequireUnique(string root, string itemId, string relativePath) {
        var visited = 0; long bytesRead = 0; var matches = new List<string>();
        void Scan(string directory) {
            RetainedFileReplacement.CheckPath(directory);
            var before = RetainedFileReplacement.Fingerprint(directory) ?? throw Refusal();
            foreach (var entry in Directory.GetFileSystemEntries(directory).Order(StringComparer.Ordinal)) {
                if (directory == root && Path.GetFileName(entry) == ".texttext") continue;
                if (++visited > 10000) throw Refusal();
                RetainedFileReplacement.CheckPath(entry);
                if (Directory.Exists(entry)) { Scan(entry); continue; }
                if (!entry.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase)) continue;
                var path = Path.GetRelativePath(root, entry).Replace('\\', '/');
                var bytes = Read(root, path); bytesRead = checked(bytesRead + bytes.Length);
                if (bytesRead > 256 * 1024 * 1024) throw Refusal();
                // Existing native identity parser reads original bytes only. No store instance or recovery.
                _ = Entries(bytes);
                var identity = TextPackStore.Identity(bytes) ?? throw Refusal();
                if (identity == itemId) matches.Add(path);
            }
            if (before != RetainedFileReplacement.Fingerprint(directory)) throw Refusal();
        }
        Scan(root);
        if (matches.Count != 1 || matches[0] != relativePath) throw Refusal();
    }
    internal static byte[] Read(string root, string relativePath)
    {
        if (!OperatingSystem.IsWindows() || !SafePath(relativePath) || !relativePath.EndsWith(".textpack", StringComparison.Ordinal)) throw Refusal();
        var path = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
        RetainedFileReplacement.CheckPath(path);
        var parents = new List<string>();
        var parent = Path.GetDirectoryName(path);
        while (parent is not null && parent.Length >= Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).Length) {
            parents.Add(parent); if (parent == Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)) break;
            parent = Path.GetDirectoryName(parent);
        }
        var ancestorStamps = parents.Select(p => (Path: p, Stamp: RetainedFileReplacement.Fingerprint(p) ?? throw Refusal())).ToArray();
        var before = RetainedFileReplacement.Fingerprint(path) ?? throw Refusal();
        if (before.Length is <= 0 or > Limit) throw Refusal();
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        // Compare both the held handle and the named path identity; never block a writer.
        var heldBefore = Identity(file.SafeFileHandle);
        if (heldBefore.Volume != before.Volume || heldBefore.Id != before.FileId || heldBefore.Links != 1) throw Refusal();
        var data = new byte[checked((int)before.Length)]; file.ReadExactly(data);
        if (file.ReadByte() != -1 || Identity(file.SafeFileHandle) != heldBefore || before != RetainedFileReplacement.Fingerprint(path)) throw Refusal();
        RetainedFileReplacement.CheckPath(path);
        if (ancestorStamps.Any(a => a.Stamp != RetainedFileReplacement.Fingerprint(a.Path))) throw Refusal();
        return data;
    }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    struct FileInfo { public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle, out FileInfo info);
    static (uint Volume, ulong Id, uint Links, ulong Size, ulong Write) Identity(Microsoft.Win32.SafeHandles.SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var i)) throw Refusal();
        return (i.Volume, (ulong)i.IndexHigh << 32 | i.IndexLow, i.Links, (ulong)i.SizeHigh << 32 | i.SizeLow, (ulong)i.WriteHigh << 32 | i.WriteLow);
    }
    // Fixed code only; JSON is a serialized DATA argument. Runs in actual WebView2,
    // not Utf8JsonWriter, so ECMAScript numbers/integer-like keys match all peers.
    internal static string CanonicalScript(string raw) => "(raw=>{const c=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(c(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(c(v[k]))]))):v);return c(JSON.parse(raw));})(" + JsonSerializer.Serialize(raw) + ")";
}
