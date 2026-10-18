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
        foreach(var vector in JsonDocument.Parse(File.ReadAllText(Path.Combine(FindRoot(),"sync","fixtures","mirror-lifecycle.json"))).RootElement.EnumerateArray()) {
            var policy=NativePolicyTestHost.Create();
            check(await policy.LifecycleAsync(vector.GetProperty("observed").Deserialize<MirrorLifecycleObservation>(json)!)==vector.GetProperty("decision").Deserialize<MirrorLifecycleDecision>(json),"source lifecycle vector: "+vector.GetProperty("name"));
        }
        foreach(var vector in JsonDocument.Parse(File.ReadAllText(Path.Combine(FindRoot(),"sync","fixtures","mirror-queue.json"))).RootElement.EnumerateArray()) {
            var policy=NativePolicyTestHost.Create();
            var result=await policy.QueueAsync(vector.GetProperty("observed").Deserialize<MirrorQueueObservation>(json)!);
            check(JsonSerializer.Serialize(result,json)==JsonSerializer.Serialize(vector.GetProperty("decision").Deserialize<MirrorQueueDecision>(json),json),"source queue vector: "+vector.GetProperty("name"));
        }
        var largeCandidates=Enumerable.Range(0,512).Select(i=>new MirrorQueueCandidate("operation-"+i,false,false,false,true)).ToArray();
        var largeQueue=await NativePolicyTestHost.Create().QueueAsync(new(largeCandidates,128));
        check(largeQueue.HasMore&&largeQueue.OperationIds.SequenceEqual(largeCandidates.Take(128).Select(c=>c.OperationId)),"bounded native queue snapshot above former small RPC line limit");
        foreach(var altered in new[]{"scope","requestId","observed","digest","pageId","unknown-id","duplicate-id","reordered-id","over-budget"}) {
            var policy=new MirrorPolicy(digest,scope,(script,ct)=>{
                if(script.Contains(".handshake("))return Task.FromResult(JsonSerializer.Serialize(new{version=1,digest,pageId="page",generation=1}));
                if(script.Contains(".bind("))return Task.FromResult(JsonSerializer.Serialize(new{version=1,digest,pageId="page",generation=1,scope},json));
                var request=JsonNode.Parse(script[(script.IndexOf('(')+1)..^1])!;
                request["decision"]=JsonSerializer.SerializeToNode(new MirrorQueueDecision(["a"],false),json);
                if(altered=="unknown-id")request["decision"]!["operationIds"]=new JsonArray("unknown");
                else if(altered=="duplicate-id")request["decision"]!["operationIds"]=new JsonArray("a","a");
                else if(altered=="reordered-id")request["decision"]!["operationIds"]=new JsonArray("b","a");
                else if(altered=="over-budget")request["decision"]!["operationIds"]=new JsonArray("a","b");
                else request[altered]="invalid";
                return Task.FromResult(request.ToJsonString());
            });
            var budget=altered=="reordered-id"?2:1;
            var refused=false;
            try{await policy.QueueAsync(new([new("a",false,false,false,true),new("b",false,false,false,true)],budget));}
            catch(Exception e)when(e is IOException or JsonException or InvalidOperationException){refused=true;}
            check(refused,"queue reply refuses "+altered);
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
