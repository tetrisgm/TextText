import { strFromU8, Unzip, UnzipInflate, type UnzipFile } from "fflate";

export const ASSISTANT_OFFICE_ATTACHMENT_ACCEPT = ".docx,.xlsx,.pptx";

const MAX_ARCHIVE_BYTES = 5_000_000;
const MAX_ARCHIVE_FILES = 256;
const MAX_EXTRACTED_BYTES = 8_000_000;
const MAX_SINGLE_ENTRY_BYTES = 4_000_000;
const MAX_OUTPUT_CHARACTERS = 120_000;

const OFFICE_MEDIA_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

const GENERIC_ZIP_MEDIA_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]);

export type OfficeAttachmentKind = keyof typeof OFFICE_MEDIA_TYPES;

export type OfficeAttachmentFile = {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
};

export class OfficeAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeAttachmentError";
  }
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function officeAttachmentKind(
  name: string,
  mediaType = "",
): OfficeAttachmentKind | null {
  const extension = fileExtension(name);
  if (!(extension in OFFICE_MEDIA_TYPES)) return null;

  const kind = extension as OfficeAttachmentKind;
  const normalizedMediaType = mediaType.toLowerCase().split(";", 1)[0].trim();
  if (
    !GENERIC_ZIP_MEDIA_TYPES.has(normalizedMediaType) &&
    normalizedMediaType !== OFFICE_MEDIA_TYPES[kind]
  ) {
    return null;
  }
  return kind;
}

function requireOfficeKind(file: OfficeAttachmentFile): OfficeAttachmentKind {
  const extension = fileExtension(file.name);
  if (!(extension in OFFICE_MEDIA_TYPES)) {
    throw new OfficeAttachmentError(
      `${file.name} is not a supported Word, Excel, or PowerPoint file.`,
    );
  }

  const kind = officeAttachmentKind(file.name, file.type);
  if (!kind) {
    throw new OfficeAttachmentError(`${file.name} does not match its file type.`);
  }
  return kind;
}

function safeArchivePath(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("\\")) return false;
  if (name.startsWith("/") || /^[a-z]:/i.test(name)) return false;
  return !name.split("/").some((part) => part === "..");
}

function wantedEntry(kind: OfficeAttachmentKind, name: string): boolean {
  if (name === "[Content_Types].xml") return true;
  if (kind === "docx") return name === "word/document.xml";
  if (kind === "xlsx") {
    return (
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
    );
  }
  return (
    name === "ppt/presentation.xml" ||
    name === "ppt/_rels/presentation.xml.rels" ||
    /^ppt\/slides\/slide\d+\.xml$/i.test(name) ||
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name)
  );
}

function boundedArchiveError(fileName: string, reason: "entries" | "expanded") {
  if (reason === "entries") {
    return new OfficeAttachmentError(
      `${fileName} has too many files to read safely.`,
    );
  }
  return new OfficeAttachmentError(
    `${fileName} expands too much to read safely.`,
  );
}

function extractWantedEntries(
  archive: Uint8Array,
  kind: OfficeAttachmentKind,
  fileName: string,
): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const seenNames = new Set<string>();
  let fileCount = 0;
  let declaredExtractedBytes = 0;
  let extractedBytes = 0;
  let extractionError: Error | null = null;

  const unzip = new Unzip((entry: UnzipFile) => {
    fileCount += 1;
    if (fileCount > MAX_ARCHIVE_FILES) {
      extractionError = boundedArchiveError(fileName, "entries");
      throw extractionError;
    }
    if (!safeArchivePath(entry.name) || seenNames.has(entry.name)) {
      extractionError = new OfficeAttachmentError(
        `${fileName} could not be read as an Office file.`,
      );
      throw extractionError;
    }
    seenNames.add(entry.name);

    if (entry.originalSize !== undefined) {
      declaredExtractedBytes += entry.originalSize;
      if (entry.originalSize > MAX_SINGLE_ENTRY_BYTES) {
        extractionError = boundedArchiveError(fileName, "expanded");
        throw extractionError;
      }
      if (declaredExtractedBytes > MAX_EXTRACTED_BYTES) {
        extractionError = boundedArchiveError(fileName, "expanded");
        throw extractionError;
      }
    }

    if (!wantedEntry(kind, entry.name)) return;

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    entry.ondata = (error, chunk, final) => {
      if (error) {
        extractionError = error;
        return;
      }
      entryBytes += chunk.byteLength;
      extractedBytes += chunk.byteLength;
      if (
        entryBytes > MAX_SINGLE_ENTRY_BYTES ||
        extractedBytes > MAX_EXTRACTED_BYTES
      ) {
        entry.terminate();
        extractionError = boundedArchiveError(fileName, "expanded");
        throw extractionError;
      }
      chunks.push(chunk);
      if (!final) return;

      const content = new Uint8Array(entryBytes);
      let offset = 0;
      for (const part of chunks) {
        content.set(part, offset);
        offset += part.byteLength;
      }
      entries.set(entry.name, content);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  try {
    unzip.push(archive, true);
  } catch {
    if (extractionError) throw extractionError;
    throw new OfficeAttachmentError(
      `${fileName} could not be read as an Office file.`,
    );
  }
  if (extractionError) {
    throw extractionError;
  }
  return entries;
}

function xml(entries: Map<string, Uint8Array>, name: string): string | null {
  const value = entries.get(name);
  if (!value) return null;
  try {
    return strFromU8(value);
  } catch {
    return null;
  }
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(?:#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (entity) => {
      const normalized = entity.toLowerCase();
      if (normalized === "&amp;") return "&";
      if (normalized === "&apos;") return "'";
      if (normalized === "&gt;") return ">";
      if (normalized === "&lt;") return "<";
      if (normalized === "&quot;") return '"';

      const hexadecimal = normalized.startsWith("&#x");
      const digits = normalized.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return "";
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    },
  );
}

function cleanLines(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function taggedText(
  source: string,
  textTag: "a:t" | "w:t" | "t",
  replacements: readonly [RegExp, string][],
): string {
  // Open XML producers commonly indent between elements. Removing whitespace
  // between tags keeps that serialization detail out of the extracted text
  // without touching whitespace stored inside a text node.
  let prepared = source.replace(/>\s+</g, "><");
  for (const [pattern, replacement] of replacements) {
    prepared = prepared.replace(pattern, replacement);
  }

  const escapedTag = textTag.replace(":", "\\:");
  const textPattern = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
    "gi",
  );
  return cleanLines(
    prepared.replace(textPattern, (_match, text: string) =>
      decodeXmlText(text.replace(/<[^>]+>/g, "")),
    ).replace(/<[^>]+>/g, ""),
  );
}

function extractDocx(entries: Map<string, Uint8Array>, fileName: string): string {
  const documentXml = xml(entries, "word/document.xml");
  if (!documentXml) {
    throw new OfficeAttachmentError(
      `${fileName} does not contain a readable Word document.`,
    );
  }
  const text = taggedText(documentXml, "w:t", [
    [/<\/w:p>(?=\s*<\/w:tc>)/gi, ""],
    [/<w:tab\b[^>]*\/>/gi, "\t"],
    [/<w:(?:br|cr)\b[^>]*\/>/gi, "\n"],
    [/<\/w:tc>/gi, "\t"],
    [/<\/w:(?:p|tr)>/gi, "\n"],
  ]);
  return text || "No readable text was found in this Word document.";
}

function xmlAttribute(tag: string, name: string): string | null {
  const escapedName = name.replace(":", "\\:");
  const match = tag.match(
    new RegExp(`(?:^|\\s)${escapedName}=(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match ? decodeXmlText(match[1] ?? match[2] ?? "") : null;
}

function sharedStrings(source: string | null): string[] {
  if (!source) return [];
  return [...source.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map(
    (match) =>
      taggedText(match[1], "t", [[/<\/r>/gi, ""]]).replace(/\n+/g, " "),
  );
}

function workbookSheetNames(
  workbook: string | null,
  relationships: string | null,
): Map<string, string> {
  const relationshipTargets = new Map<string, string>();
  if (relationships) {
    for (const match of relationships.matchAll(/<Relationship\b[^>]*>/gi)) {
      const id = xmlAttribute(match[0], "Id");
      const target = xmlAttribute(match[0], "Target");
      const targetMode = xmlAttribute(match[0], "TargetMode");
      if (!id || !target || targetMode?.toLowerCase() === "external") continue;
      const normalized = target.replace(/^\/?xl\//i, "").replace(/^\//, "");
      if (/^(?:\.\.\/|\/)/.test(normalized)) continue;
      relationshipTargets.set(id, `xl/${normalized.replace(/^\.\//, "")}`);
    }
  }

  const names = new Map<string, string>();
  if (!workbook) return names;
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/gi)) {
    const name = xmlAttribute(match[0], "name");
    const relationshipId = xmlAttribute(match[0], "r:id");
    const target = relationshipId
      ? relationshipTargets.get(relationshipId)
      : null;
    if (name && target) names.set(target, name);
  }
  return names;
}

function cellText(cellTag: string, values: readonly string[]): string {
  const openingTag = cellTag.match(/^<c\b[^>]*>/i)?.[0] ?? "";
  const type = xmlAttribute(openingTag, "t")?.toLowerCase();
  const formula = cellTag.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/i)?.[1];
  const rawValue = cellTag.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1];
  const inlineValue = cellTag.match(/<is(?:\s[^>]*)?>([\s\S]*?)<\/is>/i)?.[1];

  let value = rawValue ? decodeXmlText(rawValue.replace(/<[^>]+>/g, "")) : "";
  if (type === "s") value = values[Number.parseInt(value, 10)] ?? "";
  if (type === "b") value = value === "1" ? "TRUE" : "FALSE";
  if (type === "inlinestr" && inlineValue) {
    value = taggedText(inlineValue, "t", []).replace(/\n+/g, " ");
  }
  if (formula) {
    const decodedFormula = decodeXmlText(formula.replace(/<[^>]+>/g, ""));
    return value ? `=${decodedFormula} (${value})` : `=${decodedFormula}`;
  }
  return value;
}

function sheetText(source: string, values: readonly string[]): string {
  const rows: string[] = [];
  for (const row of source.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/gi)) {
      const openingTag = cell[0].match(/^<c\b[^>]*>/i)?.[0] ?? "";
      const reference = xmlAttribute(openingTag, "r") ?? "Cell";
      const value = cellText(cell[0], values);
      if (value) cells.push(`${reference}: ${value}`);
    }
    if (cells.length) rows.push(cells.join("\t"));
  }
  return cleanLines(rows.join("\n"));
}

function numberedEntrySort(a: string, b: string): number {
  const aNumber = Number.parseInt(a.match(/(\d+)\.xml$/i)?.[1] ?? "0", 10);
  const bNumber = Number.parseInt(b.match(/(\d+)\.xml$/i)?.[1] ?? "0", 10);
  return aNumber - bNumber || a.localeCompare(b);
}

function extractXlsx(entries: Map<string, Uint8Array>, fileName: string): string {
  if (!entries.has("xl/workbook.xml")) {
    throw new OfficeAttachmentError(
      `${fileName} does not contain a readable Excel workbook.`,
    );
  }
  const values = sharedStrings(xml(entries, "xl/sharedStrings.xml"));
  const names = workbookSheetNames(
    xml(entries, "xl/workbook.xml"),
    xml(entries, "xl/_rels/workbook.xml.rels"),
  );
  const sheetEntries = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(numberedEntrySort);
  if (!sheetEntries.length) {
    return "No readable cells were found in this Excel workbook.";
  }

  const sections = sheetEntries.map((name, index) => {
    const source = xml(entries, name) ?? "";
    const title = names.get(name) ?? `Sheet ${index + 1}`;
    return `${title}\n${sheetText(source, values) || "No readable cells."}`;
  });
  return cleanLines(sections.join("\n\n"));
}

function extractPptx(entries: Map<string, Uint8Array>, fileName: string): string {
  if (!entries.has("ppt/presentation.xml")) {
    throw new OfficeAttachmentError(
      `${fileName} does not contain a readable PowerPoint presentation.`,
    );
  }
  const slideEntries = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(numberedEntrySort);
  if (!slideEntries.length) {
    return "No readable slides were found in this PowerPoint presentation.";
  }

  const sections = slideEntries.map((name, index) => {
    const source = xml(entries, name) ?? "";
    const slide = taggedText(source, "a:t", [[/<\/a:p>/gi, "\n"]]);
    const slideNumber = name.match(/slide(\d+)\.xml$/i)?.[1] ?? `${index + 1}`;
    const notesName = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
    const notesSource = xml(entries, notesName);
    const notes = notesSource
      ? taggedText(notesSource, "a:t", [[/<\/a:p>/gi, "\n"]])
      : "";
    return [
      `Slide ${index + 1}`,
      slide || "No readable text.",
      notes ? `Speaker notes\n${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return cleanLines(sections.join("\n\n"));
}

function validateContentType(
  entries: Map<string, Uint8Array>,
  kind: OfficeAttachmentKind,
  fileName: string,
): void {
  const contentTypes = xml(entries, "[Content_Types].xml");
  if (!contentTypes) {
    throw new OfficeAttachmentError(
      `${fileName} could not be read as an Office file.`,
    );
  }
  if (!contentTypes.toLowerCase().includes(OFFICE_MEDIA_TYPES[kind])) {
    throw new OfficeAttachmentError(`${fileName} does not match its file type.`);
  }
  if (/macroenabled|vbaProject/i.test(contentTypes)) {
    throw new OfficeAttachmentError(
      `${fileName} contains macros and cannot be read here.`,
    );
  }
}

/**
 * Read text from a bounded Open XML attachment without executing embedded
 * content or resolving external relationships.
 */
export async function extractOfficeAttachmentText(
  file: OfficeAttachmentFile,
): Promise<string> {
  const kind = requireOfficeKind(file);
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new OfficeAttachmentError(
      `${file.name} is too large. Keep Office attachments under 5 MB.`,
    );
  }

  let archive: Uint8Array;
  try {
    archive = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new OfficeAttachmentError(`${file.name} could not be read.`);
  }
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new OfficeAttachmentError(
      `${file.name} is too large. Keep Office attachments under 5 MB.`,
    );
  }

  const entries = extractWantedEntries(archive, kind, file.name);
  validateContentType(entries, kind, file.name);

  const text =
    kind === "docx"
      ? extractDocx(entries, file.name)
      : kind === "xlsx"
        ? extractXlsx(entries, file.name)
        : extractPptx(entries, file.name);
  return text.slice(0, MAX_OUTPUT_CHARACTERS);
}
