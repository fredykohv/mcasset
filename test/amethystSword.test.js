import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createSwordImage, palette, swordPng } from "../scripts/generate-amethyst-sword.mjs";
import { validateAssetFile } from "../src/assetReport.js";
import { alphaMaskFromImageData, buildGeneratedItemExtrusion } from "../src/generatedItemExtrusion.js";

const root = new URL("../examples/amethyst-sword/", import.meta.url);
const modelPath = fileURLToPath(new URL("assets/mcasset/models/item/amethyst_sword.json", root));
const textureUrl = new URL("assets/mcasset/textures/item/amethyst_sword.png", root);

test("reference sword resolves without a Minecraft installation and stays a generated item", async () => {
  const { parsed, summary } = await validateAssetFile({ modelPath, assetsRoot: fileURLToPath(root) });
  assert.equal(parsed.modelKind, "generated_item");
  assert.deepEqual(parsed.elements, []);
  assert.equal(summary.status, "pass_with_warnings");
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.unresolvedTextureReferences, []);
  assert.equal(summary.warnings.length, 1);
  assert.match(summary.warnings[0], /approximation/);
  assert.equal(summary.decision, "request_user_approval");
});

test("committed PNG contains the reproducible RGBA artwork, including transparency", async () => {
  const image = createSwordImage();
  for (const png of [await readFile(textureUrl), swordPng()]) {
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), image.width);
    assert.equal(png.readUInt32BE(20), image.height);
    assert.equal(png[24], 8);
    assert.equal(png[25], 6);
    const compressed = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
        compressed.push(png.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(compressed));
    assert.equal(raw.length, image.height * (1 + image.width * 4));
    for (let y = 0; y < image.height; y += 1) {
      const offset = y * (1 + image.width * 4);
      assert.equal(raw[offset], 0);
      assert.deepEqual(
        raw.subarray(offset + 1, offset + 1 + image.width * 4),
        Buffer.from(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4))
      );
    }
  }
});

test("one atlas has distinct crystal blade, bronze guard, and dark leather grip", () => {
  const { width, data } = createSwordImage();
  const pixel = (x, y) => [...data.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
  assert.deepEqual(pixel(12, 4), palette.C);
  assert.deepEqual(pixel(6, 10), palette.A);
  assert.deepEqual(pixel(3, 12), palette.H);
  assert.notDeepEqual(palette.C, palette.A);
  assert.notDeepEqual(palette.C, palette.H);
  assert.ok(palette.C[2] > palette.C[0]);
  assert.ok(palette.A[0] > palette.A[2]);
  assert.ok(Math.max(...palette.H.slice(0, 3)) < Math.min(...palette.C.slice(0, 3)));
});

test("sword silhouette is connected, mostly transparent, and extrudes to one model unit", () => {
  const image = createSwordImage();
  const mask = alphaMaskFromImageData(image);
  const occupied = mask.filter(Boolean).length;
  assert.ok(occupied > 50 && occupied < mask.length * 0.45);
  const visited = new Set([mask.indexOf(true)]);
  const queue = [...visited];
  for (let i = 0; i < queue.length; i += 1) {
    const index = queue[i];
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
      const neighbor = ny * image.width + nx;
      if (mask[neighbor] && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  assert.equal(visited.size, occupied);
  const extrusion = buildGeneratedItemExtrusion(mask, image.width, image.height);
  assert.equal(extrusion.depth, 1);
  assert.equal(extrusion.frontBackRects.reduce((sum, rect) => sum + rect.width * rect.height, 0), occupied);
});
