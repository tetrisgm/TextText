import { describe, expect, it } from "vitest";
import { markdownToHtmlLite, readerItemHex, readerItemLongId, readerItemPrefix } from "../reader-api.server";

describe("Reader API item ids", () => {
  const uuid = "508c2cd7-1175-4419-9f4f-494b99bd9d15";
  it("maps a UUID to a 52-bit id and back to a lookup prefix in every accepted form", () => {
    expect(readerItemHex(uuid)).toBe("000508c2cd711754");
    const long = readerItemLongId(uuid);
    expect(long).toBe(BigInt("0x508c2cd711754").toString());
    expect(Number(long)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(readerItemPrefix(long)).toBe("508c2cd7-1175-4");
    expect(readerItemPrefix(Number(long))).toBe("508c2cd7-1175-4");
    expect(readerItemPrefix("tag:google.com,2005:reader/item/000508c2cd711754")).toBe("508c2cd7-1175-4");
    expect(readerItemPrefix("000508c2cd711754")).toBe("508c2cd7-1175-4");
    expect(readerItemPrefix("nonsense")).toBeNull();
  });

  it("renders enough HTML for a reader client", () => {
    const html = markdownToHtmlLite("# Title\n\nA **bold** [link](https://a.test/x) and <script>.\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('<a href="https://a.test/x">link</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });
});
