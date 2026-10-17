using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

static class MirrorScheduleTests
{
    sealed class Remote : ISyncTransport {
        public bool Authorized;public int Requests,Uploads;public byte[]? Bytes;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default) {
            Interlocked.Increment(ref Requests);
            if(!Authorized)throw new HttpRequestException("Fixture unauthorized",null,HttpStatusCode.Unauthorized);
            return Task.FromResult<IReadOnlyList<RemoteItem>>(Bytes is null?[]:[new("schedule-item","Note.textpack",TextPackStore.Hash(Bytes))]);
        }
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(new RemotePack(Bytes!,"Note.textpack",TextPackStore.Hash(Bytes!)));
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? basis,string operation,CancellationToken ct=default) {
            Bytes=bytes;Interlocked.Increment(ref Uploads);return Task.FromResult(TextPackStore.Hash(bytes));
        }
        public Task<string> RenameAsync(string id,string from,string to,string basis,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
        public Task DeleteAsync(string id,string path,string basis,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
    }
    static byte[] Pack(string body) {
        using var bytes=new MemoryStream();
        using(var zip=new ZipArchive(bytes,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: schedule-item\ntitle: Note\n---\n"+body);
        return bytes.ToArray();
    }
    public static async Task RunAsync(string root,Func<MirrorPolicy> factory,CancellationToken ct) {
        var folder=Path.Combine(root,"schedule-workspace");var state=Path.Combine(root,"schedule-state");
        var store=new TextPackStore(folder,state);var file=store.Write("Note.textpack",Pack("Pending before authentication"));
        var remote=new Remote();var parked=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        WorkspaceContext Context()=>new(folder,"schedule-workspace",new Uri("https://fixture.test"),()=>Task.FromResult("isolated"),(name,data)=>{
            if(name=="texttext:vault-sync-status"&&data is not null&&JsonSerializer.SerializeToElement(data).TryGetProperty("authenticationRequired",out var value)&&value.GetBoolean())parked.TrySetResult();
            return Task.CompletedTask;
        },MirrorPolicyFactory:factory);
        var bridge=new WindowsBridge(Context(),remote,state);
        byte[] retained;
        try {
            await parked.Task.WaitAsync(TimeSpan.FromSeconds(10),ct);
            var denied=Volatile.Read(ref remote.Requests);
            retained=Pack("Local edits while authentication is unavailable");
            store.Write(file.Path,retained,file.Hash);
            await Task.Delay(2300,ct);
            if(remote.Requests!=denied||remote.Uploads!=0||!store.Read(file.Path).SequenceEqual(retained))throw new Exception("Authentication wait retried from file wakes or lost pending bytes");
        } finally {await bridge.RetireAsync();}
        remote.Authorized=true;
        var renewed=new WindowsBridge(Context(),remote,state);
        try {
            var deadline=DateTime.UtcNow.AddSeconds(10);
            while(Volatile.Read(ref remote.Uploads)==0&&DateTime.UtcNow<deadline)await Task.Delay(20,ct);
            if(remote.Uploads!=1||remote.Bytes is null||!remote.Bytes.SequenceEqual(retained))throw new Exception("Fresh authenticated bridge did not resume exact retained file");
        } finally {await renewed.RetireAsync();}
        Console.WriteLine("PASS native Windows scheduler parks401 through file changes and authenticated replacement resumes retained work");
    }
}
