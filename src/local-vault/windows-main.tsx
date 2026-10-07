import { createRoot } from "react-dom/client";
import { VaultApp } from "./VaultApp";
import { setVaultTransport } from "./bridge";
import { createWindowsVaultTransport } from "./windows-transport";

async function start() {
  const view = (window as unknown as { chrome?: { webview?: Parameters<typeof createWindowsVaultTransport>[0] } }).chrome?.webview;
  if (!view) throw new Error("Open TextText from the Windows desktop app.");
  const transport = await createWindowsVaultTransport(view);
  const reset = setVaultTransport(transport.request);
  window.addEventListener("unload", () => { reset(); transport.destroy(); }, { once: true });
  createRoot(document.getElementById("root")!).render(<VaultApp />);
}
void start().catch(error => {
  const root = document.getElementById("root");
  if (root) root.textContent = error instanceof Error ? error.message : "TextText could not open. Please reopen the app.";
});
