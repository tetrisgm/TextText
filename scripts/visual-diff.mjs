/**
 * Pixel diff between two runs of scripts/visual-surfaces.mts.
 *
 *   node scripts/visual-diff.mjs <beforeDir> <afterDir> <tmpDir>
 *
 * Reports the fraction of pixels that differ per surface plus the bounding
 * box of the change, so a rewrite that moved nothing reads as zero and one
 * that moved something tells you where to look. Uses ffmpeg to decode.
 */
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [a, b, outDir] = process.argv.slice(2);
if (!a || !b || !outDir) throw new Error("usage: visual-diff.mjs <before> <after> <tmp>");
const names = readdirSync(a).filter((f) => f.endsWith(".png"));

const raw = (p) => {
  const tmp = join(outDir, "visual-diff.ppm");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", p, "-pix_fmt", "rgb24", "-f", "image2", tmp]);
  const buf = readFileSync(tmp);
  let i = 0;
  const fields = [];
  while (fields.length < 4) {
    while (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x09) i += 1;
    if (buf[i] === 0x23) { while (buf[i] !== 0x0a) i += 1; continue; }
    const start = i;
    while (i < buf.length && buf[i] !== 0x20 && buf[i] !== 0x0a && buf[i] !== 0x09) i += 1;
    fields.push(buf.slice(start, i).toString());
  }
  i += 1;
  return { w: +fields[1], h: +fields[2], px: buf.subarray(i) };
};

const rows = [];
for (const name of names) {
  let A, B;
  try { A = raw(join(a, name)); B = raw(join(b, name)); } catch { console.log(`${name}: unreadable`); continue; }
  if (A.w !== B.w || A.h !== B.h) { console.log(`${name}: SIZE ${A.w}x${A.h} vs ${B.w}x${B.h}`); continue; }
  let diff = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const n = Math.min(A.px.length, B.px.length);
  for (let i = 0; i < n; i += 3) {
    if (Math.abs(A.px[i] - B.px[i]) > 6 || Math.abs(A.px[i + 1] - B.px[i + 1]) > 6 || Math.abs(A.px[i + 2] - B.px[i + 2]) > 6) {
      diff += 1;
      const px = (i / 3) % A.w;
      const py = Math.floor(i / 3 / A.w);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
  }
  rows.push({ name, pct: (diff / (n / 3)) * 100, box: diff ? `${x0},${y0} .. ${x1},${y1}` : "" });
}
rows.sort((x, y) => y.pct - x.pct);
for (const r of rows) {
  const flag = r.pct === 0 ? "     same" : r.pct < 0.05 ? "    ~same" : "  CHANGED";
  console.log(`${flag}  ${r.pct.toFixed(3).padStart(8)}%  ${r.name}  ${r.box}`);
}
