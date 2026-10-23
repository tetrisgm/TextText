namespace TextText.Core;

public sealed partial class SyncEngine {
    public sealed record CatalogIssue(string Path,string Reason);
    public IReadOnlyList<CatalogIssue> CatalogIssues {get;private set;}=[];
    readonly HashSet<string> catalogHeldIDs=new(StringComparer.Ordinal);
    readonly HashSet<string> catalogPrefixes=new(StringComparer.OrdinalIgnoreCase);
    State? catalogState;
    string[]? observedCatalog;
    bool CatalogQuarantined=>CatalogIssues.Count>0;
    static string PortableCatalogKey(string path)=>string.Join('/',path.Split('/').Select(part=>part.Trim(' ').Normalize()));
    bool CatalogHolds(string path) {var key=PortableCatalogKey(path);return catalogPrefixes.Any(prefix=>key.Equals(prefix,StringComparison.OrdinalIgnoreCase)||key.StartsWith(prefix+"/",StringComparison.OrdinalIgnoreCase));}
    static void ValidatePortableComponents(string path) {
        foreach(var part in path.Split('/')) {
            var stem=part.Split('.')[0].TrimEnd(' ');
            if(part.Any(c=>c<32||"<>:\"|?*\\".Contains(c))||System.Text.RegularExpressions.Regex.IsMatch(stem,@"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new IOException("Invalid portable workspace path.");
        }
    }
    string[] CatalogPaths()=>transport.Folders.Concat(transport.AuthoritativeFolders??[]).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
    void ObserveCatalog(State state,IReadOnlyList<RemoteItem> remote,TextPackStore.GenerationInventory discovered) {
        var folders=CatalogPaths();if(folders.Length>40000||transport.Folders.Count>20000||transport.AuthoritativeFolders?.Count>20000)throw new IOException("Too many workspace folders.");
        var issues=new List<CatalogIssue>();
        foreach(var folder in folders) {
            ValidatePortableComponents(folder);
            var parts=folder.Split('/');var first=Array.FindIndex(parts,part=>part.EndsWith(' '));
            if(first<0){store.ValidateManagedFolder(folder);continue;}
            // Only an ordinary name's trailing spaces can be scoped. Traversal,
            // empty names, alternate separators and other invalid paths still fail.
            var portable=PortableCatalogKey(folder);store.ValidateManagedFolder(portable);
            if(parts.Any(part=>part.Length==0||part.StartsWith('.')||part.EndsWith('.')||part.TrimEnd(' ').Length==0)||folder.Contains('\\')||folder.Contains(':')||folder.Length>1024)throw new IOException("Invalid workspace folder.");
            issues.Add(new(folder,"nonportable-name"));catalogPrefixes.Add(PortableCatalogKey(string.Join('/',parts.Take(first+1))));
        }
        CatalogIssues=issues.ToArray();
        ValidateCatalogItemPaths(remote);
        if(CatalogQuarantined) {
            if(state.FolderCommand is not null) {
                // A retained topology command depends on the whole manifest.
                foreach(var id in remote.Select(item=>item.ItemId).Concat(state.Items.Keys).Concat(discovered.Files.Select(file=>file.ItemId)).Concat(state.Outbox.Select(op=>op.ItemId)))catalogHeldIDs.Add(id);
            }
            foreach(var identity in state.FolderBaseline?.Identities??[])if(ChangedFolderDestination(identity) is {} changed){catalogPrefixes.Add(PortableCatalogKey(identity.Path));catalogPrefixes.Add(PortableCatalogKey(changed));}
            void Hold(string id,params string?[] paths){if(paths.Any(path=>path is not null&&CatalogHolds(path)))catalogHeldIDs.Add(id);}
            foreach(var item in remote)Hold(item.ItemId,item.RelativePath);
            foreach(var pair in state.Items)Hold(pair.Key,pair.Value.Path);
            foreach(var op in state.Outbox.Concat(state.SharedRenames.Values))Hold(op.ItemId,op.Path,op.Destination);
            foreach(var pair in state.ProtectedRenames)Hold(pair.Key,pair.Value.Request.Source,pair.Value.Request.Destination,pair.Value.Resolution?.LocalPath,pair.Value.Resolution?.RemotePath);
            foreach(var op in state.BinaryOutbox){Hold(op.ItemId,op.SourcePath);if(op.SourcePath is null&&!state.Items.ContainsKey(op.ItemId))catalogHeldIDs.Add(op.ItemId);}
            foreach(var id in remote.Select(item=>item.ItemId).Concat(state.Items.Keys).Concat(discovered.Files.Select(file=>file.ItemId)).Distinct(StringComparer.Ordinal)){var intent=store.Intent(id);if(intent is not null)Hold(id,intent.Path,intent.Destination);if(SharedEditingStore.HasProtectedState(store.StateDirectory,id))catalogHeldIDs.Add(id);}
            if(state.PendingPull is {} pull)Hold(pull.ItemId,pull.Path,pull.OldPath);
            foreach(var file in discovered.Files)Hold(file.ItemId,file.Path);
            if(discovered.Errors.Any(error=>error.Path=="."||CatalogHolds(error.Path)))throw new IOException("A held folder's local identity cannot be verified. Its files remain preserved.");
        }
        // Still validate identity/case ambiguity among all independently usable paths.
        store.ValidateFolderCatalog(folders.Where(folder=>!CatalogHolds(folder)).ToArray());
        observedCatalog=folders;catalogState=state;
    }
    void ValidateCatalogItemPaths(IReadOnlyList<RemoteItem> remote) {
        var exact=new HashSet<string>(StringComparer.Ordinal);
        var portable=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var item in remote) {
            ValidatePortableComponents(item.RelativePath);
            _=store.Resolve(CatalogHolds(item.RelativePath)?PortableCatalogKey(item.RelativePath):item.RelativePath);
            if(item.Deleted)continue;
            if(!exact.Add(item.RelativePath)||!portable.Add(PortableCatalogKey(item.RelativePath))&&!CatalogHolds(item.RelativePath))throw new IOException("Remote documents request conflicting paths. Files remain preserved.");
        }
    }
    void CheckCatalogRefresh(IReadOnlyList<RemoteItem> remote) {
        if(catalogState is null)return;
        ValidateCatalogItemPaths(remote);
        if(!CatalogQuarantined){var folders=CatalogPaths();foreach(var folder in folders)ValidatePortableComponents(folder);store.ValidateFolderCatalog(folders);return;}
        if(!CatalogPaths().SequenceEqual(observedCatalog!))throw new FileChangedException();
        if(remote.Any(item=>CatalogHolds(item.RelativePath)&&!catalogHeldIDs.Contains(item.ItemId)))throw new FileChangedException();
    }
}
