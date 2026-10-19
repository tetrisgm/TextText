// Serializable readonly inspection of the actual selected editor/provider.
export function readLiveFieldDocument({ itemId, workspaceId, title }) {
  const editors=document.querySelectorAll('[aria-label="Edit item"][data-ai-item-id]');
  if(editors.length!==1)return null;
  const editor=editors[0],key=editor.dataset.aiItemId;
  if(key!==itemId&&!key?.endsWith(':'+workspaceId+':'+itemId))return null;
  const api=window.texttextDocumentInspection;
  const doc=api?.version===1?api.read(key):null;
  const subtitle=editor.querySelector('textarea[aria-label="Subtitle"]'),body=editor.querySelector('[aria-label="Document body"]');
  if(!doc||!subtitle||!body||doc.content.title!==title||(doc.content.subtitle===undefined?'':doc.content.subtitle)!==subtitle.value
    ||doc.content.body!==body.textContent||doc.presentation?.template?.id!=='texttext.article')return null;
  return doc;
}
