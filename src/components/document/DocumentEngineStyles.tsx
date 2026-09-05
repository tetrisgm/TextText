// The document engine's stylesheet as a component, in its own module.
//
// FolderPage needs the engine CSS for its rows but used to import it from
// DocumentRenderer, which carries react-markdown and its ~240KB package
// graph; that put Markdown parsing on the path to the first list paint.
// Importers that only need the styles take them from here.

import { DOCUMENT_ENGINE_CSS } from "@/lib/presentation/styles";

export function DocumentEngineStyles() {
  return <style>{DOCUMENT_ENGINE_CSS}</style>;
}
