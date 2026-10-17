// Package the existing Mac brand artwork without resizing or changing pixels.
// Run with --check to verify the checked-in Windows icon matches its sources.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const assets = new URL("mac/Assets.xcassets/AppIcon.appiconset/", root);
const sources = [
  [16, "icon_16x16.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_256x256.png"],
];
const images = await Promise.all(sources.map(async ([size, name]) => {
  const png = await readFile(new URL(name, assets));
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`Invalid source icon: ${name}`);
  }
  return png;
}));
const directory = Buffer.alloc(6 + sources.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sources.length, 4);
let offset = directory.length;
for (let index = 0; index < sources.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = sources[index][0] % 256;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
const icon = Buffer.concat([directory, ...images]);
const target = new URL("windows/TextText.Windows/TextText.ico", root);
if (process.argv.includes("--check")) {
  if (!(await readFile(target)).equals(icon)) throw new Error("Windows icon differs from its source artwork.");
  console.log("Windows icon matches all five original brand image sizes.");
} else {
  await writeFile(target, icon);
}
