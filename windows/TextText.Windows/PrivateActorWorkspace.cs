#if TEXTTEXT_STRESS_ACTOR
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TextText.Core;
namespace TextText.Windows;

// Only the private actor references this type. No web request can choose a root.
public sealed class PrivateActorWorkspace
{
    public sealed record Isolation(int Version, string Root, string SessionRoot);
    public static Isolation ParseIsolation(JsonElement value) {
        var keys=new[]{"version","root","sessionRoot"};
        if(value.ValueKind!=JsonValueKind.Object||value.EnumerateObject().Count()!=3||keys.Any(key=>!value.TryGetProperty(key,out _))||value.GetProperty("version").ValueKind!=JsonValueKind.Number||!value.GetProperty("version").TryGetInt32(out var version)||version!=1||value.GetProperty("root").ValueKind!=JsonValueKind.String||value.GetProperty("sessionRoot").ValueKind!=JsonValueKind.String)throw new IOException("Invalid private actor isolation schema.");
        return new(version,value.GetProperty("root").GetString()!,value.GetProperty("sessionRoot").GetString()!);
    }
    sealed record Scope(int Version,string Root,string WorkspaceId,string ItemId,string Title,string RelativePath,string PrincipalHash);
    readonly string receipt;
    readonly string itemId,title,relative;
    bool freshPrepared;
    public string Root {get;}
    public string WorkspaceId {get;}
    string StatePath(Uri origin) => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","Sync",TextPackStore.Hash(Encoding.UTF8.GetBytes(origin.AbsoluteUri+"\n"+WorkspaceId+"\n"+Root)));
    public TaskCompletionSource Ready {get;} = new(TaskCreationOptions.RunContinuationsAsynchronously);
    static string Canonical(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
    static void SafeAncestors(string path) {
        for(var at=path;!string.IsNullOrEmpty(at);at=Path.GetDirectoryName(at)) {
            FileAttributes attributes;
            try {attributes=File.GetAttributes(at);}
            catch(FileNotFoundException){continue;}
            catch(DirectoryNotFoundException){continue;}
            if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Private actor paths must not contain links.");
        }
    }
    public PrivateActorWorkspace(Isolation isolation,string session,string file,string workspaceId,string itemId,string title) {
        if(isolation.Version!=1||!Path.IsPathFullyQualified(isolation.Root)||!Path.IsPathFullyQualified(isolation.SessionRoot)||!Path.IsPathFullyQualified(session)||!Path.IsPathFullyQualified(file))throw new IOException("Invalid private actor isolation.");
        var parent=Canonical(isolation.SessionRoot);Root=Canonical(isolation.Root);
        var generation=Canonical(session);var relay=Path.GetDirectoryName(generation);var relayParent=relay is null?null:Path.GetDirectoryName(relay);
        if(!Directory.Exists(parent)||!Directory.Exists(generation)||relay is null||relayParent is null||Canonical(relayParent)!=parent||Root!=Path.Combine(parent,"vault")||relay==Root||
            !Regex.IsMatch(Path.GetFileName(relay),@"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\z")||!Regex.IsMatch(Path.GetFileName(generation),@"^generation-[0-9]{3}\z")||Path.GetFileName(generation)=="generation-000")throw new IOException("Private actor generation must belong to its runner relay session.");
        SafeAncestors(parent);SafeAncestors(session);SafeAncestors(Root);SafeAncestors(file);
        var prefix=Root+Path.DirectorySeparatorChar;var absolute=Path.GetFullPath(file);
        if(!absolute.StartsWith(prefix,StringComparison.Ordinal)||!Guid.TryParseExact(workspaceId,"D",out _)||!Guid.TryParseExact(itemId,"D",out _)||!title.StartsWith("Six-client acceptance ",StringComparison.Ordinal))throw new IOException("Private actor fixture scope is invalid.");
        relative=absolute[prefix.Length..].Replace(Path.DirectorySeparatorChar,'/');
        if(relative.Split('/').Any(p=>p.Length==0||p is "." or "..")||!relative.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))throw new IOException("Invalid private actor fixture path.");
        this.itemId=itemId;this.title=title;WorkspaceId=workspaceId;receipt=Path.Combine(parent,"isolated-workspace-scope.json");
        if(File.Exists(receipt)){SafeAncestors(receipt);if(new FileInfo(receipt).Length>8192)throw new IOException("Private actor scope exceeds its bound.");}
        else if(Directory.Exists(Root)&&Directory.EnumerateFileSystemEntries(Root).Any())throw new IOException("Fresh private actor root must be empty.");
    }
    Scope Expected(Uri origin,string accountId) {
        if(origin.Scheme!="https"||origin.UserInfo.Length!=0||origin.AbsolutePath!="/"||origin.Query.Length!=0||origin.Fragment.Length!=0||string.IsNullOrWhiteSpace(accountId))throw new IOException("Verified private actor account required.");
        return new(1,Root,WorkspaceId,itemId,title,relative,TextPackStore.Hash(Encoding.UTF8.GetBytes(origin.GetLeftPart(UriPartial.Authority).ToLowerInvariant()+"\n"+accountId)));
    }
    Scope ReadScope() {
        SafeAncestors(receipt);
        if(new FileInfo(receipt).Length>8192)throw new IOException("Private actor scope exceeds its bound.");
        var bytes=File.ReadAllBytes(receipt);if(bytes.Length>8192)throw new IOException("Private actor scope exceeds its bound.");
        using var json=JsonDocument.Parse(bytes);var keys=new[]{"Version","Root","WorkspaceId","ItemId","Title","RelativePath","PrincipalHash"};
        if(json.RootElement.ValueKind!=JsonValueKind.Object||json.RootElement.EnumerateObject().Count()!=keys.Length||keys.Any(key=>!json.RootElement.TryGetProperty(key,out _)))throw new IOException("Private actor scope schema changed.");
        return JsonSerializer.Deserialize<Scope>(bytes) ?? throw new IOException("Private actor scope is missing.");
    }
    void VerifyOwner(TextPackStore store,Uri origin,string accountId) {
        var path=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);SafeAncestors(path);
        if(!File.Exists(path)||new FileInfo(path).Length>4096)throw new IOException("Private actor retained ownership is missing.");
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(path)) ?? throw new IOException("Invalid private actor ownership.");
        if(owner.Origin!=origin.GetLeftPart(UriPartial.Authority).ToLowerInvariant()||owner.WorkspaceId!=WorkspaceId||owner.AccountId!=accountId||owner.RootHash!=TextPackStore.Hash(Encoding.UTF8.GetBytes(store.Root))||owner.Version is not (1 or 2))throw new IOException("Private actor ownership changed.");
        AccountRootOwnership.RequireNoAdoption(store.StateDirectory);
        if(owner.Version==2||RetainedReplacementProfile.Exists(store.StateDirectory))RetainedReplacementProfile.Verify(store.StateDirectory,owner,owner.RootHash);
    }
    public void PrepareVerified(Uri origin,string accountId) {
        var expected=Expected(origin,accountId);SafeAncestors(Root);SafeAncestors(receipt);
        if(File.Exists(receipt)) {
            if(ReadScope()!=expected)throw new IOException("Private actor scope changed.");
            if(!Directory.Exists(Root))throw new IOException("Private actor root is missing.");
            var statePath=StatePath(origin);SafeAncestors(statePath);
            if(!Directory.Exists(statePath)||!File.Exists(Path.Combine(statePath,AccountRootOwnership.FileName))||!File.Exists(Path.Combine(statePath,"sync.json")))throw new IOException("Private actor reopen requires its retained native owner and state.");
            var store=WindowsBridge.OpenStore(Root,origin,WorkspaceId);
            if(!File.Exists(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName))||!File.Exists(Path.Combine(store.StateDirectory,"sync.json")))throw new IOException("Private actor reopen requires its retained native owner and state.");
            VerifyOwner(store,origin,accountId);WorkspaceLocation.Validate(Root,origin.AbsoluteUri,WorkspaceId);
            VerifyFixture();return;
        }
        if(Directory.Exists(Root)&&Directory.EnumerateFileSystemEntries(Root).Any())throw new IOException("Fresh private actor root must be empty.");
        // Reject an orphaned per-device state instead of adopting or overwriting it.
        var state=StatePath(origin);
        SafeAncestors(state);if(Directory.Exists(state)&&Directory.EnumerateFileSystemEntries(state).Any())throw new IOException("Fresh private actor state already exists.");
        Directory.CreateDirectory(Root);
        using var output=new FileStream(receipt,FileMode.CreateNew,FileAccess.Write,FileShare.None);JsonSerializer.Serialize(output,expected);output.Flush(true);
        freshPrepared=true;
    }
    public void RevalidateBeforeBinding(Uri origin,string accountId) {
        if(!freshPrepared){PrepareVerified(origin,accountId);return;}
        SafeAncestors(Root);SafeAncestors(receipt);
        if(ReadScope()!=Expected(origin,accountId))throw new IOException("Private actor scope changed before binding.");
        // OpenWorkspace has published only its portable binding at this point.
        if(Directory.EnumerateFileSystemEntries(Root).Any(path=>Path.GetFileName(path)!=".texttext"))throw new IOException("Private actor fresh vault changed before binding.");
        var portable=Path.Combine(Root,".texttext");SafeAncestors(portable);
        if(!Directory.Exists(portable)||Directory.EnumerateFileSystemEntries(portable).Any(path=>Path.GetFileName(path)!="workspace-binding.json"))throw new IOException("Private actor portable metadata changed before binding.");
        WorkspaceLocation.Validate(Root,origin.AbsoluteUri,WorkspaceId);
        var state=StatePath(origin);SafeAncestors(state);
        if(Directory.Exists(state)&&Directory.EnumerateFileSystemEntries(state).Any())throw new IOException("Private actor fresh device state changed before binding.");
    }
    public void VerifyPublished(Uri origin,string accountId) {
        var store=WindowsBridge.OpenStore(Root,origin,WorkspaceId);
        if(!File.Exists(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName)))throw new IOException("Private actor native ownership was not published.");
        VerifyOwner(store,origin,accountId);
    }
    public void VerifyFixture() {
        var file=Path.Combine(Root,relative.Replace('/',Path.DirectorySeparatorChar));SafeAncestors(file);
        if(!File.Exists(file)||TextPackStore.Identity(File.ReadAllBytes(file))!=itemId)throw new IOException("Private actor fixture has not materialized with its exact identity.");
    }
}
#endif
