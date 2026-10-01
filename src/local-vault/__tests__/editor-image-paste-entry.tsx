import { createRoot } from "react-dom/client";
import { useState } from "react";
import { UnifiedDocumentEditor, type EditorImagePasteRequest } from "@/components/document/UnifiedDocumentEditor";
import { DocumentEngineStyles } from "@/components/document/DocumentEngineStyles";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { asPost, localBlog, writePayload } from "../model";
import { prepareEditorImagePaste } from "../editor-image-paste";
import { emptyPack, encodePack, openPack } from "../pack";
import type { VaultFile } from "../bridge";

declare global {
  interface Window {
    __editorImagePasteResult?: {
      body: string;
      assets: Array<[string, string | undefined]>;
      png: number[];
      gif: number[];
    };
  }
}

const template = BUILTIN_TEMPLATES.find(value => value.id === "texttext.note")!;
const initial = emptyDocumentSnapshot({ id: template.id, version: template.version });
initial.content.body = "Before after";
const seed: VaultFile = {
  path: "Notes/Browser paste.textpack",
  hash: "",
  markdown: '---\ntextTextId: "browser-paste"\n---\n\nBefore after',
  documentJSON: JSON.stringify(initial),
  templateJSON: JSON.stringify(template),
};

function BrowserPasteEditor() {
  const [document, setDocument] = useState(initial);
  const paste = async (request: EditorImagePasteRequest) => {
    const edit = await prepareEditorImagePaste({
      document: request.document,
      selection: request.selection,
      files: request.files,
    });
    const additions = edit.addedAssets.map(asset => ({
      filename: asset.filename,
      contentType: asset.contentType,
      data: Uint8Array.from(atob(asset.data), character => character.charCodeAt(0)),
    }));
    const packed = encodePack(emptyPack(), writePayload(seed, edit.document), additions);
    const opened = openPack(packed, seed.path, "");
    window.__editorImagePasteResult = {
      body: edit.document.content.body,
      assets: edit.document.content.assets.map(asset => [asset.src, asset.contentType]),
      png: [...opened.entries[opened.prefix + "assets/Pasted.png"]],
      gif: [...opened.entries[opened.prefix + "assets/Animated.gif"]],
    };
    setDocument(edit.document);
    return { caret: edit.caret };
  };
  return <>
    <DocumentEngineStyles />
    <UnifiedDocumentEditor
      transport="local"
      externalDocument={document}
      blog={localBlog}
      post={asPost(document, seed.path)}
      template={template}
      collab={{ postId: seed.path, userName: "You", color: "#3970c5", canEdit: true }}
      onDocumentChange={setDocument}
      onPasteImages={paste}
      onDone={() => {}}
    />
  </>;
}

createRoot(document.getElementById("root")!).render(<BrowserPasteEditor />);
