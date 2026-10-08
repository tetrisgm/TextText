import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";

// Untrusted PDF parsing stays out of the HTTP/sync event loop. This worker
// receives bytes only; PDF.js has no URL, cookies or external font sources.
let document;
try {
  document = await getDocumentProxy(new Uint8Array(workerData), {
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    stopAtErrors: true, verbosity: 0,
  });
  if (document.numPages > 200) throw new Error("limit");
  const pages = [];
  let characters = 0;
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const { items } = await page.getTextContent();
    let text = "";
    for (const item of items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
      characters += item.str.length + 1;
      if (characters > 2_000_000) throw new Error("limit");
    }
    // Preserve prose as inert Markdown, including literal bracketed links,
    // HTML-looking text and image syntax that appeared inside the PDF.
    pages.push(text.trim().split("\n").map(line => line
      .replace(/[\\`*_{}\[\]<>]/g, "\\$&")
      .replace(/^(\s*)([#>+\-=]|\d+[.)])(?=\s)/, "$1\\$2")).join("\n"));
    page.cleanup();
  }
  const markdown = pages.filter(Boolean).join("\n\n");
  if (!markdown) throw new Error("empty");
  parentPort.postMessage({ markdown });
} catch {
  // Never return parser errors that could include document text or secrets.
  parentPort.postMessage({ error: "This PDF could not be read. Open the original PDF instead." });
} finally {
  await document?.destroy();
}
