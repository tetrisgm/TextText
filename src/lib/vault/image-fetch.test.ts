import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const lookup = vi.hoisted(() => vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]));
vi.mock("node:dns/promises", () => ({ default: { lookup }, lookup }));
import { preparePublicImage } from "./image-fetch";
afterEach(() => { vi.unstubAllGlobals(); lookup.mockReset(); lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); });
const png = () => sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).png().toBuffer();
it("preserves validated image bytes and creates the existing UI preview", async () => {
 const bytes = await png(); const fetcher = vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/png" } })); vi.stubGlobal("fetch", fetcher);
 const result = await preparePublicImage("https://example.com/my-photo.png");
 expect(result.original.equals(bytes)).toBe(true); expect(result.filename).toBe("my-photo.png"); expect(result.width).toBe(4); expect((await sharp(result.preview).metadata()).format).toBe("webp");
 expect(fetcher.mock.calls[0]).toBeDefined();
});
it("rejects private destinations and validates redirect destinations with pinned transport", async () => {
 const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })); vi.stubGlobal("fetch", fetcher);
 await expect(preparePublicImage("https://example.com/image")).rejects.toThrow("public image"); expect(fetcher).toHaveBeenCalledTimes(1);
 lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
 await expect(preparePublicImage("https://other.example/image")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(preparePublicImage("https://user:secret@example.com/image")).rejects.toThrow("public image");
});
it("caps actual streamed bytes even with an understated length and cancels the reader", async () => {
 const cancel = vi.fn(); vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel }), { headers: { "content-type": "image/png", "content-length": "1" } }));
 await expect(preparePublicImage("https://example.com/image", { maxBytes: 10 })).rejects.toThrow("size"); expect(cancel).toHaveBeenCalled();
});
it.each(["headers", "body", "dns"])("bounds stalled %s even when underlying work ignores abort", async phase => {
 if (phase === "dns") lookup.mockImplementation(() => new Promise(() => {}));
 vi.stubGlobal("fetch", () => phase === "headers" ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { "content-type": "image/png" } })));
 await expect(preparePublicImage("https://example.com/image", { timeoutMs: 20 })).rejects.toThrow("timed out");
});
it("rejects disguised content, mismatched MIME, empty data and caller cancellation", async () => {
 vi.stubGlobal("fetch", async () => new Response("<html>bad</html>", { headers: { "content-type": "image/png" } }));
 await expect(preparePublicImage("https://example.com/image")).rejects.toThrow();
 const bytes = await png(); vi.stubGlobal("fetch", async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
 await expect(preparePublicImage("https://example.com/image")).rejects.toThrow("declared type");
 vi.stubGlobal("fetch", async () => new Response(new Uint8Array(), { headers: { "content-type": "image/png" } }));
 await expect(preparePublicImage("https://example.com/image")).rejects.toThrow("nonempty");
 const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
 await expect(preparePublicImage("https://example.com/image", { signal: controller.signal })).rejects.toThrow("interrupted"); expect(fetcher).not.toHaveBeenCalled();
});
it("cancels a late response body after a fetch ignored the expired signal", async () => {
 let resolve!: (response: Response) => void;
 vi.stubGlobal("fetch", () => new Promise<Response>(done => { resolve = done; }));
 await expect(preparePublicImage("https://example.com/image", { timeoutMs: 20 })).rejects.toThrow("timed out");
 const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "image/png" } }));
 await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
