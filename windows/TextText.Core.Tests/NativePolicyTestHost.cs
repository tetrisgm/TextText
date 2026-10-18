using System.Diagnostics;
using System.Text.Json;
using TextText.Core;

// Test-only source evaluator. No production binary starts this process.
static class NativePolicyTestHost
{
    static readonly Lazy<Host> Shared=new(()=>new Host());
    public static MirrorPolicy Create(string? account=null,Func<string,Task>? beforeRequest=null) {
        var context=Guid.NewGuid().ToString();
        return new MirrorPolicy(new string('f',64),new(account??"fixture-account","fixture-workspace",context),
            async(script,ct)=>{if(beforeRequest is not null)await beforeRequest(script);return await Shared.Value.Evaluate(context,script,ct);});
    }
    sealed class Host
    {
        readonly Process child;readonly SemaphoreSlim gate=new(1,1);
        bool failed;
        public Host() {
            var root=new DirectoryInfo(AppContext.BaseDirectory);
            while(root is not null&&!File.Exists(Path.Combine(root.FullName,"sync","native-policy-test-host.mjs")))root=root.Parent;
            if(root is null)throw new IOException("Run native policy tests from the source checkout.");
            var start=new ProcessStartInfo("node"){WorkingDirectory=root.FullName,UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true};
            start.ArgumentList.Add("--import");start.ArgumentList.Add("tsx");start.ArgumentList.Add("sync/native-policy-test-host.mjs");
            start.Environment.Clear();foreach(var key in new[]{"PATH","HOME","TMPDIR","TMP","TEMP","SystemRoot"})if(Environment.GetEnvironmentVariable(key) is {} value)start.Environment[key]=value;
            child=Process.Start(start)??throw new IOException("Could not start policy test host.");
        }
        public async Task<string> Evaluate(string context,string script,CancellationToken ct) {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(4));
            ct=timeout.Token;
            await gate.WaitAsync(ct);
            try {
                if(failed||child.HasExited)throw new IOException("Policy test host is unavailable.");
                await child.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new{context,script}).AsMemory(),ct);
                await child.StandardInput.FlushAsync(ct);
                var line=await child.StandardOutput.ReadLineAsync(ct)??throw new IOException("Policy test host exited.");
                if(line.Length>16*1024*1024)throw new IOException("Policy test host response exceeded bounds.");
                using var reply=JsonDocument.Parse(line);
                if(!reply.RootElement.GetProperty("ok").GetBoolean())throw new IOException("Policy test host rejected request.");
                return reply.RootElement.GetProperty("result").GetString()!;
            } catch {
                // Do not let a late response satisfy the next request.
                failed=true;
                try{if(!child.HasExited)child.Kill(entireProcessTree:true);}catch(InvalidOperationException){}
                throw;
            } finally {gate.Release();}
        }
    }
}
