import { expect, it } from "vitest";
import { noteTemplateBody } from "./note-template-body";
it("keeps snippet text exact and rejects empty, oversized or embedded media",()=>{
 const body="## Meeting\n- [ ] Discuss [agenda](https://example.com)\n";
 expect(noteTemplateBody(body)).toBe(body);
 for(const invalid of [" ","x".repeat(100001),"![Photo](assets/x.png)","<img src='image.png'>","[Attachment](assets/doc.pdf)","blob:abc", "[Attachment](file.pdf)"]) expect(()=>noteTemplateBody(invalid)).toThrow();
});
