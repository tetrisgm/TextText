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
        var delayed=new TaskCompletionSource<string>();
        var stuck=new MirrorPolicy(digest,scope,(_,_)=>delayed.Task,TimeSpan.FromMilliseconds(20));
        var timeout=false;try{await stuck.DecideAsync(observation);}catch(TimeoutException){timeout=true;}
        check(timeout,"unresponsive policy has a bounded native timeout");
        delayed.SetResult(JsonSerializer.Serialize(new{version=1,digest,pageId="late"}));
        var retired=false;try{await stuck.DecideAsync(observation);}catch(IOException){retired=true;}
        check(retired,"late reply cannot revive timed-out policy lease");
    }
}
