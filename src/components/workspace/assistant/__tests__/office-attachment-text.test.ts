import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  extractOfficeAttachmentText,
  officeAttachmentKind,
  type OfficeAttachmentFile,
} from "../office-attachment-text";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

function archiveFile(
  name: string,
  type: string,
  entries: Record<string, string | Uint8Array>,
): OfficeAttachmentFile {
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        typeof value === "string" ? strToU8(value) : value,
      ]),
    ),
    { level: 6 },
  );
  return {
    name,
    type,
    size: archive.byteLength,
    async arrayBuffer() {
      return archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer;
    },
  };
}

function contentTypes(type: string, part: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/${part}" ContentType="${type}"/>
    </Types>`;
}

describe("Office attachment type validation", () => {
  it("accepts standard Office MIME types and browser-generic ZIP types", () => {
    expect(officeAttachmentKind("brief.DOCX", TYPES.docx)).toBe("docx");
    expect(officeAttachmentKind("numbers.xlsx", "application/zip")).toBe(
      "xlsx",
    );
    expect(officeAttachmentKind("deck.pptx", "")).toBe("pptx");
  });

  it("rejects macro formats and mismatched declared types", () => {
    expect(
      officeAttachmentKind(
        "brief.docx",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
      ),
    ).toBeNull();
    expect(officeAttachmentKind("macro.docm", "application/zip")).toBeNull();
  });
});

describe("Office attachment text extraction", () => {
  it("preserves Word paragraphs, tabs, tables, and XML entities", async () => {
    const file = archiveFile("brief.docx", TYPES.docx, {
      "[Content_Types].xml": contentTypes(TYPES.docx, "word/document.xml"),
      "word/document.xml": `<?xml version="1.0"?>
        <w:document xmlns:w="word"><w:body>
          <w:p><w:r><w:t>First &amp; best</w:t></w:r></w:p>
          <w:p><w:r><w:t>Second</w:t><w:tab/><w:t>point</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>B</w:t></w:p></w:tc></w:tr></w:tbl>
        </w:body></w:document>`,
    });

    await expect(extractOfficeAttachmentText(file)).resolves.toBe(
      "First & best\nSecond\tpoint\nA\tB",
    );
  });

  it("preserves Excel sheets, shared strings, formulas, booleans, and inline text", async () => {
    const file = archiveFile("numbers.xlsx", TYPES.xlsx, {
      "[Content_Types].xml": contentTypes(TYPES.xlsx, "xl/workbook.xml"),
      "xl/workbook.xml": `
        <workbook xmlns:r="relationships"><sheets>
          <sheet name="Forecast" sheetId="1" r:id="rId1"/>
        </sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `
        <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `
        <sst><si><t>Revenue</t></si><si><r><t>North</t></r><r><t> America</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `
        <worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2"><v>42</v></c><c r="B2"><f>A2*2</f><v>84</v></c></row>
          <row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="inlineStr"><is><t>Ready</t></is></c></row>
        </sheetData></worksheet>`,
    });

    await expect(extractOfficeAttachmentText(file)).resolves.toBe(
      [
        "Forecast",
        "A1: Revenue\tB1: North America",
        "A2: 42\tB2: =A2*2 (84)",
        "A3: TRUE\tB3: Ready",
      ].join("\n"),
    );
  });

  it("preserves numbered PowerPoint slides and speaker notes", async () => {
    const file = archiveFile("deck.pptx", TYPES.pptx, {
      "[Content_Types].xml": contentTypes(
        TYPES.pptx,
        "ppt/presentation.xml",
      ),
      "ppt/presentation.xml": "<p:presentation/>",
      "ppt/slides/slide2.xml":
        "<p:sld><a:p><a:t>Second slide</a:t></a:p></p:sld>",
      "ppt/slides/slide1.xml":
        "<p:sld><a:p><a:t>Opening</a:t></a:p><a:p><a:t>Key point</a:t></a:p></p:sld>",
      "ppt/notesSlides/notesSlide1.xml":
        "<p:notes><a:p><a:t>Pause here</a:t></a:p></p:notes>",
    });

    await expect(extractOfficeAttachmentText(file)).resolves.toBe(
      [
        "Slide 1",
        "Opening\nKey point",
        "Speaker notes",
        "Pause here",
        "",
        "Slide 2",
        "Second slide",
      ].join("\n"),
    );
  });
});

describe("Office attachment archive limits", () => {
  it("rejects a declared archive above the compressed byte limit before reading", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file: OfficeAttachmentFile = {
      arrayBuffer,
      name: "large.docx",
      size: 5_000_001,
      type: TYPES.docx,
    };

    await expect(extractOfficeAttachmentText(file)).rejects.toThrow(
      "Keep Office attachments under 5 MB.",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects a highly compressed required XML entry before returning text", async () => {
    const oversizedDocument = `<w:document><w:p><w:t>${"x".repeat(
      4_000_001,
    )}</w:t></w:p></w:document>`;
    const file = archiveFile("bomb.docx", TYPES.docx, {
      "[Content_Types].xml": contentTypes(TYPES.docx, "word/document.xml"),
      "word/document.xml": oversizedDocument,
    });
    expect(file.size).toBeLessThan(50_000);

    await expect(extractOfficeAttachmentText(file)).rejects.toThrow(
      "expands too much to read safely",
    );
  });

  it("rejects archives with too many entries", async () => {
    const entries: Record<string, string> = {
      "[Content_Types].xml": contentTypes(TYPES.docx, "word/document.xml"),
      "word/document.xml": "<w:document><w:p><w:t>Safe</w:t></w:p></w:document>",
    };
    for (let index = 0; index < 255; index += 1) {
      entries[`word/media/empty-${index}.txt`] = "";
    }
    const file = archiveFile("crowded.docx", TYPES.docx, entries);

    await expect(extractOfficeAttachmentText(file)).rejects.toThrow(
      "too many files to read safely",
    );
  });

  it("rejects unsafe archive paths even though extraction never writes files", async () => {
    const file = archiveFile("unsafe.docx", TYPES.docx, {
      "[Content_Types].xml": contentTypes(TYPES.docx, "word/document.xml"),
      "../word/document.xml":
        "<w:document><w:p><w:t>Unsafe</w:t></w:p></w:document>",
    });

    await expect(extractOfficeAttachmentText(file)).rejects.toThrow(
      "could not be read as an Office file",
    );
  });

  it("rejects macro-bearing Open XML packages", async () => {
    const file = archiveFile("macro.docx", TYPES.docx, {
      "[Content_Types].xml": `${contentTypes(
        TYPES.docx,
        "word/document.xml",
      )}<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>`,
      "word/document.xml":
        "<w:document><w:p><w:t>Text</w:t></w:p></w:document>",
    });

    await expect(extractOfficeAttachmentText(file)).rejects.toThrow(
      "contains macros",
    );
  });
});
