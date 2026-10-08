import { expect, it } from "vitest";
import { noteIcon } from "./note-icons";
it("accepts one bounded emoji grapheme and rejects markup or multiple icons", () => {
  for (const icon of ["🇫🇷", "1️⃣", "💡", "✍️", "👩🏽‍💻", " ✅ "]) expect(noteIcon(icon)).toBe(icon.trim());
  for (const value of ["", "1", "🇫", "a", "💡📌", "<img>", null, {}, "a".repeat(1000)]) expect(noteIcon(value)).toBe("");
});
