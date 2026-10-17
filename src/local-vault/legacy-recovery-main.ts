import { collectLegacyRecovery, legacyRecoveryText } from "./legacy-recovery";

const status = document.querySelector<HTMLElement>("#status")!;
const records = document.querySelector<HTMLElement>("#records")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
function save(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function read() {
  refresh.disabled = true; download.disabled = true; download.onclick = null; records.replaceChildren();
  status.textContent = "Reading saved drafts…";
  try {
    const bundle = await collectLegacyRecovery(localStorage, indexedDB);
    status.textContent = bundle.records.length ? `${bundle.records.length} saved records. Recovery copies can contain private writing.` : "No older drafts were found in this profile.";
    download.disabled = bundle.records.length === 0;
    download.onclick = () => save("TextText older drafts.json", JSON.stringify(bundle, null, 2), "application/json");
    bundle.records.forEach((record, index) => {
      const section = document.createElement("section"), title = document.createElement("h2"), detail = document.createElement("p");
      const text = legacyRecoveryText(record);
      title.textContent = text?.title || `Saved record ${index + 1}`;
      detail.textContent = `Recovery record ${index + 1}`;
      detail.className = "detail"; section.append(title, detail);
      if (text) {
        const preview = document.createElement("pre"); preview.textContent = text.body; section.append(preview);
        const button = document.createElement("button"); button.textContent = "Save text";
        button.onclick = () => save(`TextText recovered note ${index + 1}.md`, `${text.title}\n\n${text.body}`, "text/markdown"); section.append(button);
      } else {
        const message = document.createElement("p"); message.textContent = "A text preview is unavailable. The recovery download includes the original record."; section.append(message);
      }
      records.append(section);
    });
  } catch (error) { status.textContent = error instanceof Error ? error.message : "Saved drafts could not be read. The originals remain in this profile."; }
  finally { refresh.disabled = false; }
}
refresh.onclick = () => void read();
void read();
