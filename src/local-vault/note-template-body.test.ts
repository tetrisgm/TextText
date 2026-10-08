import { expect, it } from "vitest";
import { noteTemplateBody } from "./note-template-body";
it("keeps snippet text exact and rejects empty, oversized or embedded media",()=>{
 const body="## Meeting\n- [ ] Discuss [agenda](https://example.com)\n";
 expect(noteTemplateBody(body)).toBe(body);
 for(const invalid of [" ","x".repeat(100001),"![Photo](assets/x.png)","<img src='image.png'>","[Attachment](assets/doc.pdf)","blob:abc", "[Attachment](file.pdf)"]) expect(()=>noteTemplateBody(invalid)).toThrow();
});

it("does not copy reference-style attachments or HTML media without their files", () => {
 for (const body of ["[File][report]\n\n[report]: report.pdf", "<video src='clip.mp4'></video>", "<audio src='recording.mp3'></audio>"]) expect(() => noteTemplateBody(body)).toThrow();
 const web = "[Agenda][link]\n\n[link]: https://example.com/agenda";
 expect(noteTemplateBody(web)).toBe(web);
});
