using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

static class MirrorPolicyTests
{
    public static async Task Run(Action<bool,string> check)
    {
        var digest=new string('f',64);var scope=new MirrorScope("account","workspace","connection");
        var observation=new MirrorObservation(new string('a',64),new string('a',64),"r","r",false);
        var json=new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
        foreach(var altered in new[]{"none","scope","requestId","observed","digest","pageId","disposition"}) {
            var policy=new MirrorPolicy(digest,scope,(script,ct)=>{
                if(script.Contains(".handshake("))return Task.FromResult(JsonSerializer.Serialize(new{version=1,digest,pageId="page",generation=1}));
                if(script.Contains(".bind("))return Task.FromResult(JsonSerializer.Serialize(new{version=1,digest,pageId="page",generation=1,scope},json));
                var request=JsonNode.Parse(script[(script.IndexOf('(')+1)..^1])!;
                request["disposition"]="idle";
                if(altered!="none")request[altered]="invalid";
                return Task.FromResult(request.ToJsonString());
            });
            var refused=false;MirrorDisposition? result=null;
            try{result=await policy.DecideAsync(observation);}catch(Exception e) when(e is IOException or JsonException or InvalidOperationException){refused=true;}
            check(altered=="none" ? !refused&&result==MirrorDisposition.Idle : refused,"native policy reply validation: "+altered);
            policy.Retire();
            refused=false;try{await policy.DecideAsync(observation);}catch(IOException){refused=true;}
            check(refused,"retired policy cannot resume: "+altered);
        }
        foreach(var vector in JsonDocument.Parse(File.ReadAllText(Path.Combine(FindRoot(),"sync","fixtures","mirror-schedule.json"))).RootElement.EnumerateArray()) {
            var policy=NativePolicyTestHost.Create();
            var scheduleObservation=vector.GetProperty("observed").Deserialize<MirrorScheduleObservation>(json)!;
            check(await policy.ScheduleAsync(scheduleObservation)==vector.GetProperty("decision").Deserialize<MirrorScheduleDecision>(json),"source schedule vector: "+vector.GetProperty("name"));
        }
        check(MirrorFailure.Outcome(new HttpRequestException("ignored",null,System.Net.HttpStatusCode.Unauthorized))=="auth-required","401 classified structurally");
        check(MirrorFailure.Outcome(new HttpRequestException("401 text is not status"))=="transient","network error text cannot invent authentication failure");
        check(MirrorFailure.Outcome(new IOException("offline"))=="storage","storage failure is not a generic network retry");
        var delayed=new TaskCompletionSource<string>();
        var stuck=new MirrorPolicy(digest,scope,(_,_)=>delayed.Task,TimeSpan.FromMilliseconds(20));
        var timeout=false;try{await stuck.DecideAsync(observation);}catch(TimeoutException){timeout=true;}
        check(timeout,"unresponsive policy has a bounded native timeout");
        delayed.SetResult(JsonSerializer.Serialize(new{version=1,digest,pageId="late"}));
        var retired=false;try{await stuck.DecideAsync(observation);}catch(IOException){retired=true;}
        check(retired,"late reply cannot revive timed-out policy lease");
    }
    static string FindRoot() {
        var directory=new DirectoryInfo(AppContext.BaseDirectory);
        while(directory is not null&&!File.Exists(Path.Combine(directory.FullName,"sync","fixtures","mirror-schedule.json")))directory=directory.Parent;
        return directory?.FullName??throw new IOException("Missing source schedule fixture.");
    }

}
