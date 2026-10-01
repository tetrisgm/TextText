import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { encodeBase64, imageType, MAX_IMAGE_BYTES } from "./image-import";

export type PastedImageFile = {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type TextpackAssetAddition = {
  filename: string;
  contentType: string;
  data: string;
};

export type EditorImagePaste = {
  document: DocumentSnapshot;
  addedAssets: TextpackAssetAddition[];
  caret: number;
};

const MAX_PASTED_IMAGES = 16;

function availableFilename(name: string, extension: string, occupied: Set<string>): string {
  const sourceStem = name.replace(/\.[^.]*$/, "").trim();
  const stem = sourceStem
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100) || "pasted-image";
  let candidate = `${stem}.${extension}`;
  for (let suffix = 2; occupied.has(candidate.toLocaleLowerCase()); suffix += 1) {
    candidate = `${stem}-${suffix}.${extension}`;
  }
  occupied.add(candidate.toLocaleLowerCase());
  return candidate;
}

function markdownAlt(value: string): string {
  return value.replace(/[\\\[\]]/g, "\\$&");
}

/**
 * Build one canonical document edit and the exact binary entries it needs.
 * The caller commits both to the guarded TextPack write; this helper never
 * creates a second store for pasted bytes.
 */
export async function prepareEditorImagePaste(input: {
  document: DocumentSnapshot;
  selection: { from: number; to: number };
  files: readonly PastedImageFile[];
  occupiedFilenames?: readonly string[];
  makeId?: () => string;
}): Promise<EditorImagePaste> {
  if (!input.files.length || input.files.length > MAX_PASTED_IMAGES) {
    throw new Error(`Paste between 1 and ${MAX_PASTED_IMAGES} images at a time.`);
  }
  const body = input.document.content.body;
  const { from, to } = input.selection;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > body.length) {
    throw new Error("The document selection changed. Paste the image again.");
  }
  const occupied = new Set((input.occupiedFilenames ?? []).map((value) => value.toLocaleLowerCase()));
  for (const asset of input.document.content.assets) {
    const filename = asset.src.match(/^assets\/([^/]+)$/)?.[1];
    if (filename) occupied.add(filename.toLocaleLowerCase());
  }
  const additions: TextpackAssetAddition[] = [];
  const documentAssets = [...input.document.content.assets];
  const markdown: string[] = [];
  const makeId = input.makeId ?? (() => crypto.randomUUID());
  let totalBytes = 0;
  for (const file of input.files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name || "Image"}: choose an image no larger than 20 MiB.`);
    }
    totalBytes += bytes.length;
    if (totalBytes > 40 * 1024 * 1024) throw new Error("Paste no more than 40 MiB of images at a time.");
    const detected = imageType(bytes);
    const filename = availableFilename(file.name, detected.extension, occupied);
    const alt = file.name.replace(/\.[^.]*$/, "").trim().slice(0, 1000) || "Image";
    const src = `assets/${filename}`;
    documentAssets.push({
      id: makeId(),
      kind: "image",
      src,
      alt,
      contentType: detected.contentType,
    });
    additions.push({ filename, contentType: detected.contentType, data: encodeBase64(bytes) });
    markdown.push(`![${markdownAlt(alt)}](${src})`);
  }
  const inserted = markdown.join("\n\n");
  return {
    document: validateDocumentSnapshot({
      ...input.document,
      content: {
        ...input.document.content,
        body: body.slice(0, from) + inserted + body.slice(to),
        assets: documentAssets,
      },
    }),
    addedAssets: additions,
    caret: from + inserted.length,
  };
}
