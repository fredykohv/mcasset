import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// One atlas, with separate crystal, bronze and wrapped-leather color regions.
export const palette = {
  ".": [0, 0, 0, 0],
  O: [37, 27, 49, 255],
  P: [248, 226, 255, 255],
  C: [190, 124, 235, 255],
  S: [105, 56, 151, 255],
  G: [144, 91, 45, 255],
  A: [234, 187, 94, 255],
  H: [89, 52, 49, 255],
  W: [158, 104, 72, 255]
};

export const pixels = [
  "................",
  ".............O..",
  "............OPO.",
  "...........OPSO.",
  "..........OPCSO.",
  ".........OPCSO..",
  "........OPCSO...",
  "...OO..OPCSO....",
  "...OGOOPCSO.....",
  "....OGACSO......",
  "....OHAGO.......",
  "...OHWOAGO......",
  "..OHWHOOGO......",
  ".OPWHO..OO......",
  ".OPOO...........",
  "..OO............"
];

export function createSwordImage() {
  assert.equal(pixels.length, 16);
  const data = new Uint8ClampedArray(16 * 16 * 4);
  pixels.forEach((row, y) => {
    assert.equal(row.length, 16, `Row ${y} must have 16 pixels`);
    [...row].forEach((symbol, x) => {
      assert.ok(palette[symbol], `Unknown palette symbol: ${symbol}`);
      data.set(palette[symbol], (y * 16 + x) * 4);
    });
  });
  return { width: 16, height: 16, data };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

export function swordPng() {
  const { width, height, data } = createSwordImage();
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA, with filter 0 on every scanline.
  const rows = Array.from({ length: height }, (_, y) => Buffer.concat([
    Buffer.from([0]),
    Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4))
  ]));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL("../examples/amethyst-sword/assets/mcasset/textures/item/amethyst_sword.png", import.meta.url);
  await mkdir(path.dirname(fileURLToPath(output)), { recursive: true });
  await writeFile(output, swordPng());
  process.stdout.write(`Wrote ${fileURLToPath(output)}\n`);
}
