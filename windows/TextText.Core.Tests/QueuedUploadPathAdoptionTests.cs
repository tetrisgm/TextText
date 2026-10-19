using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

// Actual durable outbox/OS paths and packaged policy. No installed root or HTTP writer.
static class QueuedUploadPathAdoptionTests
{
    const string Id="c1111111-1111-4111-8111-111111111111",Account="queued-path-account",Generation="generation-a";
    const string Original="Original.textpack",Moved="Moved.textpack";
    static readonly ProtectedRenameScope Scope=new("https://queued-path.test","queued-path",Account);
    public static async Task Run(string temp,Action<bool,string> check)
    {
        await UnknownGeneration(temp,check);
        await DeletionIntent(temp,check);
        await MissingCapabilities(temp,check);
        await SamePath(temp,check);
        foreach(var moved in new[]{false,true})await LostReply(temp,moved,check);
        foreach(var moved in new[]{false,true})await Positive(temp,moved,check);
        foreach(var race in new[]{"permission","remote","projection","duplicate","payload","intent","protection","origin","workspace","account","fresh-permission","fresh-account","fresh-remote","unavailable"})await PolicyRace(temp,race,check);
    }
    public static async Task UnknownGeneration(string temp,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"unknown",known:false,expectUnsupportedStaging:!OperatingSystem.IsWindows());
        if(!OperatingSystem.IsWindows()) {
            var portableBefore=JsonSerializer.Serialize(fixture.State());var remoteBefore=fixture.Remote.Data.ToArray();
            bool Retained()=>JsonSerializer.Serialize(fixture.State())==portableBefore&&fixture.State().Outbox.Count==0&&
                File.ReadAllBytes(fixture.Store.Resolve(Original)).SequenceEqual(fixture.Changed)&&!File.Exists(fixture.Store.Resolve(Moved))&&
                fixture.Remote.Data.SequenceEqual(remoteBefore)&&fixture.Remote.Attempts.Count==0&&!fixture.Sync.HasEligiblePending;
            check(RetainedFileReplacement.Fingerprint(fixture.Store.Resolve(Original)) is null&&Retained(),
                "portable unknown-generation staging requires unavailable Windows fingerprint and retains exact changed bytes without operation or dispatch");
            await fixture.Pass();fixture.Restart();await fixture.Pass();
            check(Retained(),"portable unknown-generation staging remains retained without fabricated operation or eligible retry across restart");
            return;
        }
        var before=fixture.Proof();fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};
        await fixture.Pass();
        check(fixture.Proof()==before&&fixture.Remote.Attempts.Count==0&&!fixture.Sync.HasEligiblePending&&fixture.Sync.Status.Error=="A queued file update needs review before its path can change. Your file is kept on this device.",
            "unknown generations defer exact queued operation and bytes without dispatch or hot-loop admission");
        fixture.Restart();await fixture.Pass();
        check(fixture.Proof()==before&&fixture.Remote.Attempts.Count==0,
            "fresh engine keeps unknown-generation command and all target work without allocating a replacement");
    }
    static async Task DeletionIntent(string temp,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"deletion");
        fixture.Store.RemoveRetaining(Original,fixture.Pending.Hash,recordDeletion:true);
        File.WriteAllBytes(fixture.Store.Resolve(Original),fixture.Changed);
        var before=fixture.Proof();fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};
        await fixture.Pass();fixture.Restart();await fixture.Pass();
        check(fixture.Proof()==before&&fixture.Remote.Attempts.Count==0&&fixture.Store.Intent(Id) is {Kind:"delete"},
            "deletion intent defers exact operation payload baseline private work and paths across restart with zero dispatch");
    }
    public static async Task MissingCapabilities(string temp,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"missing-current-capabilities");var before=fixture.Proof();
        fixture.Remote.Capabilities=null;fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};
        await fixture.Pass();fixture.Restart();await fixture.Pass();
        check(fixture.Proof()==before&&fixture.Remote.Attempts.Count==0&&!fixture.Sync.HasEligiblePending&&fixture.Sync.Status.Error=="A queued file update needs review before its path can change. Your file is kept on this device.",
            "missing current manifest capabilities never reuse cached permission to reissue queued paths");
    }
    static async Task SamePath(string temp,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"same-path");var before=fixture.Pending;var pathPolicyCalls=0;
        fixture.Restart(script=>{if(script.Contains(".queuedUploadPath("))pathPolicyCalls++;return Task.CompletedTask;});fixture.Remote.Offline=false;
        await fixture.Sync.SyncAsync();
        check(fixture.Remote.Attempts.Single()==before&&pathPolicyCalls==0&&fixture.State().Outbox.Count==0&&fixture.Sync.Status.Error is null,
            "same-path upload retains its original command and existing CAS without path-policy admission");
    }
    static async Task LostReply(string temp,bool moved,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"lost-reply-"+moved);var original=fixture.Pending;
        fixture.Remote.Offline=false;fixture.Remote.LoseAfterCommit=true;await fixture.Pass();
        var before=fixture.Proof();var attempts=fixture.Remote.Attempts.Count;
        if(moved)fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};
        fixture.Restart();await fixture.Pass();
        if(moved)check(fixture.Proof()==before&&fixture.Remote.Attempts.Count==attempts&&!fixture.Sync.HasEligiblePending&&fixture.Sync.Status.Error is not null&&fixture.Remote.Item.Revision==original.Hash,
            "lost upload ACK plus peer path change retains full immutable uncertain work and committed bytes without reissue after restart");
        else check(fixture.State().Outbox.Count==0&&fixture.Remote.Attempts.Count==attempts+1&&fixture.Remote.Attempts.All(attempt=>attempt==original)&&fixture.Store.Read(Original).SequenceEqual(fixture.Changed),
            "ordinary same-path lost ACK still replays its exact existing command through normal CAS");
    }
    static async Task Positive(string temp,bool alreadyMoved,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"positive-"+alreadyMoved);var before=fixture.Pending;
        fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};fixture.Remote.Offline=false;
        if(alreadyMoved)fixture.Store.Rename(Original,Moved,before.Hash);
        await fixture.Sync.SyncAsync();var sent=fixture.Remote.Attempts.Single();
        check(sent==before with{Id=sent.Id,Path=Moved}&&sent.Id!=before.Id&&Convert.FromBase64String(sent.Payload!).SequenceEqual(fixture.Changed)&&
            fixture.State().Outbox.Count==0&&fixture.Sync.Status.Error is null&&fixture.Store.Read(Moved).SequenceEqual(fixture.Changed)&&!File.Exists(fixture.Store.Resolve(Original))&&fixture.Store.Intent(Id) is null,
            "authorized queued path adoption reissues only identity/path with exact bytes and normal CAS after "+(alreadyMoved?"existing exact intent":"native no-overwrite move"));
    }
    static async Task PolicyRace(string temp,string race,Action<bool,string> check)
    {
        using var fixture=await Fixture.Create(temp,"race-"+race);fixture.Remote.Item=fixture.Remote.Item with{RelativePath=Moved};
        var seen=false;var expected=fixture.Proof();
        fixture.Restart(async script=>{
            if(seen||!script.Contains(".queuedUploadPath("))return;seen=true;
            switch(race)
            {
                case "fresh-permission":fixture.Remote.BeforeManifest=()=>fixture.Remote.Capabilities=new(false,false,[],new(){{Id,false}});break;
                case "fresh-account":fixture.Remote.BeforeManifest=()=>fixture.Remote.Binding=Scope with{AccountId="other-account"};break;
                case "fresh-remote":fixture.Remote.BeforeManifest=()=>fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Later.textpack"};break;
                case "permission":fixture.Remote.Capabilities=new(false,false,[],new(){{Id,false}});break;
                case "remote":fixture.Remote.Item=fixture.Remote.Item with{Revision=new string('f',64)};break;
                case "projection":File.WriteAllBytes(fixture.Store.Resolve(Original),Pack("external later text",true));break;
                case "duplicate":File.WriteAllBytes(fixture.Store.Resolve("Duplicate.textpack"),fixture.Changed);break;
                case "payload":var state=fixture.State();var bytes=Pack("replacement durable payload",true);state.Outbox[0]=state.Outbox[0] with{Hash=TextPackStore.Hash(bytes),Payload=Convert.ToBase64String(bytes)};File.WriteAllBytes(Path.Combine(fixture.Store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));break;
                case "intent":fixture.Store.RemoveRetaining(Original,fixture.Pending.Hash,recordDeletion:true);File.WriteAllBytes(fixture.Store.Resolve(Original),fixture.Changed);break;
                case "protection":var directory=Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id);Directory.CreateDirectory(directory);File.WriteAllBytes(Path.Combine(directory,"binary-intent.json"),JsonSerializer.SerializeToUtf8Bytes(new{Version=1,ItemId=Id,Path=Original,BeforeHash=fixture.Pending.Hash,AfterHash=fixture.Pending.Hash}));break;
                case "origin":fixture.Remote.Binding=Scope with{Origin="https://other.test"};break;
                case "workspace":fixture.Remote.Binding=Scope with{WorkspaceId="other-workspace"};break;
                case "account":fixture.Remote.Binding=Scope with{AccountId="other-account"};break;
            }
            expected=fixture.Proof();
            if(race=="unavailable")throw new IOException("Controlled policy unavailable");
            await Task.CompletedTask;
        });
        try{await fixture.Sync.SyncAsync();}catch(IOException){}catch(InvalidDataException){}
        check(seen&&fixture.Remote.Attempts.Count==0&&fixture.Proof()==expected,
            "post-policy "+race+" race retains exact current target operation bytes baseline intents and private work with zero dispatch");
    }
    static byte[] Pack(string body,bool known)
    {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
        {
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: "+Id+"\n---\n"+body);
            if(known)using(var writer=new StreamWriter(zip.CreateEntry("texttext-lifecycle.json").Open()))writer.Write(JsonSerializer.Serialize(new{version=1,generation=Generation}));
        }
        return output.ToArray();
    }
    sealed class Fixture:IDisposable
    {
        public required TextPackStore Store;public required Remote Remote;public required SyncEngine Sync;public required byte[] Changed;
        public SyncEngine.State State()=>JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(Store.StateDirectory,"sync.json")))!;
        public SyncEngine.Operation Pending=>State().Outbox.Single();
        public static async Task<Fixture> Create(string temp,string name,bool known=true,bool expectUnsupportedStaging=false)
        {
            if(expectUnsupportedStaging&&(OperatingSystem.IsWindows()||known))throw new ArgumentException("Unsupported staging is only a portable unknown-generation fixture.");
            var suffix=name+"-"+Guid.NewGuid().ToString("N");
            var store=new TextPackStore(Path.Combine(temp,"queued-path-"+suffix),Path.Combine(temp,"queued-state-"+suffix));
            AccountRootOwnership.Open(store,new(Scope.Origin),Scope.WorkspaceId,Account);
            var original=Pack("Initial",known);var remote=new Remote(original,known);
            var fixture=new Fixture{Store=store,Remote=remote,Changed=Pack("Pending exact bytes",known),Sync=new(store,remote,Account,NativePolicyTestHost.Create(Account))};
            await fixture.Sync.SyncAsync();File.WriteAllBytes(store.Resolve(Original),fixture.Changed);
            remote.Offline=true;await fixture.Pass();
            if(expectUnsupportedStaging) {
                if(fixture.State().Outbox.Count!=0||remote.Attempts.Count!=0)throw new Exception("Portable unknown generation unexpectedly staged or dispatched an operation.");
            } else if(fixture.Pending.Hash!=TextPackStore.Hash(fixture.Changed))throw new Exception("Fixture did not stage actual changed bytes.");
            remote.Attempts.Clear();
            return fixture;
        }
        public async Task Pass(){try{await Sync.SyncAsync();}catch(HttpRequestException){} }
        public void Restart(Func<string,Task>? hook=null)=>Sync=new(Store,Remote,Account,NativePolicyTestHost.Create(Account,hook));
        public string Proof()
        {
            var state=State();var op=state.Outbox.Single();var bytes=Convert.FromBase64String(op.Payload!);
            if(TextPackStore.Hash(bytes)!=op.Hash||TextPackStore.Identity(bytes)!=Id)throw new Exception("Invalid staged fixture payload.");
            var shared=Path.Combine(Store.StateDirectory,"shared-editing",Id);
            var privateFiles=new SortedDictionary<string,string>(StringComparer.Ordinal);
            foreach(var name in new[]{"checkpoint.json","intent.json","move-intent.json","binary-intent.json","acknowledge.json"})
            {var path=Path.Combine(shared,name);if(File.Exists(path))privateFiles[name]=Convert.ToBase64String(File.ReadAllBytes(path));}
            var recoveryRoot=Store.GetRecoveryDirectory();
            var recovery=Directory.GetFiles(recoveryRoot,"*",SearchOption.AllDirectories).OrderBy(x=>x,StringComparer.Ordinal).ToDictionary(x=>Path.GetRelativePath(recoveryRoot,x),x=>Convert.ToBase64String(File.ReadAllBytes(x)));
            var old=Store.Resolve(Original);var moved=Store.Resolve(Moved);
            return JsonSerializer.Serialize(new{Operation=op,Payload=Convert.ToBase64String(bytes),Baseline=state.Items.GetValueOrDefault(Id),Intent=Store.Intent(Id),Private=privateFiles,Recovery=recovery,
                Saved=state.ProtectedRenames.TryGetValue(Id,out var saved)?Convert.ToBase64String(ProtectedSavedRename.ArchiveBytes(saved)):null,Legacy=state.SharedRenames.GetValueOrDefault(Id),Pull=state.PendingPull,Folder=state.FolderCommand,
                Binary=state.BinaryOutbox.Where(x=>x.ItemId==Id).ToArray(),BinaryBaseline=state.BinaryBaselines.GetValueOrDefault(Id),BinaryRevision=state.BinaryRevisions.GetValueOrDefault(Id),
                Old=File.Exists(old)?Convert.ToBase64String(File.ReadAllBytes(old)):null,New=File.Exists(moved)?Convert.ToBase64String(File.ReadAllBytes(moved)):null});
        }
        public void Dispose(){}
    }
    sealed class Remote(byte[] initial,bool known):ISyncTransport
    {
        public RemoteItem Item=new(Id,Original,TextPackStore.Hash(initial),Lifecycle:known?Generation:null);
        public byte[] Data=initial;public bool Offline,LoseAfterCommit;public Action? BeforeManifest;
        readonly Dictionary<string,(SyncEngine.Operation Request,string Revision)> receipts=[];
        public List<SyncEngine.Operation> Attempts=[];
        public ProtectedRenameScope Binding=Scope;
        public ProtectedRenameScope? ProtectedRenameBinding=>Binding;
        public WorkspaceCapabilities? Capabilities{get;set;}=new(true,true,[],new(){{Id,true}});
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){var action=BeforeManifest;BeforeManifest=null;action?.Invoke();return Task.FromResult<IReadOnlyList<RemoteItem>>([Item]);}
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(new RemotePack(Data,Item.RelativePath,Item.Revision));
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default)
        {
            var request=new SyncEngine.Operation(operation,"upload",id,path,null,revision,TextPackStore.Hash(bytes),Convert.ToBase64String(bytes),Lifecycle:Item.Lifecycle);Attempts.Add(request);
            if(Offline)throw new HttpRequestException("Controlled offline upload");
            if(receipts.TryGetValue(operation,out var receipt)){if(receipt.Request!=request)throw new InvalidDataException("Fixture receipt identity changed.");return Task.FromResult(receipt.Revision);}
            if(Item.RelativePath!=path||Item.Revision!=revision)throw new SyncConflictException();
            Data=bytes;Item=Item with{Revision=TextPackStore.Hash(bytes)};receipts[operation]=(request,Item.Revision);
            if(LoseAfterCommit){LoseAfterCommit=false;throw new HttpRequestException("Controlled lost upload ACK");}
            return Task.FromResult(Item.Revision);
        }
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected rename RPC.");
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected delete RPC.");
    }
}
