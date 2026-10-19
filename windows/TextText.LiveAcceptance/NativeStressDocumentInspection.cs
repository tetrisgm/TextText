using System.Text.Json;

// Actor-only inspection. Optional subtitle absence is normalized for comparison,
// never synthesized into the returned full DocumentSnapshot.
static class NativeStressDocumentInspection
{
    internal static string Script(string itemId,string workspaceId) => "(()=>{const es=document.querySelectorAll('[aria-label=\"Edit item\"][data-ai-item-id]');if(es.length!==1)return null;const e=es[0],k=e.dataset.aiItemId;if(k!=="+JsonSerializer.Serialize(itemId)+"&&!k?.endsWith(':'+"+JsonSerializer.Serialize(workspaceId)+"+':'+"+JsonSerializer.Serialize(itemId)+"))return null;const api=window.texttextDocumentInspection;const d=api?.version===1?api.read(k):null;const s=e.querySelector('textarea[aria-label=\"Subtitle\"]'),b=e.querySelector('[aria-label=\"Document body\"]');return d&&s&&b&&(d.content.subtitle===undefined?'':d.content.subtitle)===s.value&&d.content.body===b.textContent?d:null})()";
    internal static string Field(JsonElement content,string key)
    {
        if(key=="subtitle"&&!content.TryGetProperty(key,out _))return "";
        var value=content.GetProperty(key);
        if(value.ValueKind!=JsonValueKind.String)throw new Exception("Invalid live document field.");
        return value.GetString()!;
    }
    internal static void Validate(JsonElement doc,string title)
    {
        if(doc.ValueKind!=JsonValueKind.Object||Field(doc.GetProperty("content"),"title")!=title
            ||doc.GetProperty("presentation").GetProperty("template").GetProperty("id").GetString()!="texttext.article")throw new Exception("Actual live article snapshot unavailable.");
        _=Field(doc.GetProperty("content"),"body");_=Field(doc.GetProperty("content"),"subtitle");
    }
}
