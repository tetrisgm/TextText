// Recognising a Word, Excel or PowerPoint attachment, without the machinery
// for reading one.
//
// Extracting the text needs fflate and an XML walk, which is a quarter of a
// megabyte that the workspace was parsing on every load because the assistant
// imports the attachment code and the attachment code imported all of this in
// one piece. Classifying a dropped file is four string comparisons, and it is
// the only part anyone needs before a file actually arrives.

export const ASSISTANT_OFFICE_ATTACHMENT_ACCEPT = ".docx,.xlsx,.pptx";

export const OFFICE_MEDIA_TYPES = {
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

export function fileExtension(name: string): string {
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
