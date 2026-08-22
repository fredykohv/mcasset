import test from "node:test";
import assert from "node:assert/strict";
import { alphaMaskFromImageData, buildGeneratedItemExtrusion } from "../src/generatedItemExtrusion.js";

test("creates alpha mask from image data", () => {
  const imageData = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 20,
      0, 0, 0, 0,
      0, 0, 0, 200
    ])
  };

  assert.deepEqual(alphaMaskFromImageData(imageData, 0.1), [true, false, false, true]);
});

test("merges contiguous opaque pixels into rectangles", () => {
  const width = 4;
  const height = 3;
  const mask = [
    true, true, false, false,
    true, true, false, true,
    false, false, false, true
  ];

  const extrusion = buildGeneratedItemExtrusion(mask, width, height, 1);
  assert.deepEqual(extrusion.frontBackRects, [
    { x: 0, y: 0, width: 2, height: 2 },
    { x: 3, y: 1, width: 1, height: 2 }
  ]);
});

test("builds north/south/east/west edge segments for alpha silhouette", () => {
  const width = 3;
  const height = 3;
  const mask = [
    false, true, false,
    true, true, true,
    false, true, false
  ];

  const extrusion = buildGeneratedItemExtrusion(mask, width, height, 1);
  assert.deepEqual(extrusion.sideRects.north, [{ x: 1, y: 0, length: 1 }, { x: 0, y: 1, length: 1 }, { x: 2, y: 1, length: 1 }]);
  assert.deepEqual(extrusion.sideRects.south, [{ x: 0, y: 1, length: 1 }, { x: 2, y: 1, length: 1 }, { x: 1, y: 2, length: 1 }]);
  assert.deepEqual(extrusion.sideRects.west, [{ x: 0, y: 1, length: 1 }, { x: 1, y: 0, length: 1 }, { x: 1, y: 2, length: 1 }]);
  assert.deepEqual(extrusion.sideRects.east, [{ x: 1, y: 0, length: 1 }, { x: 1, y: 2, length: 1 }, { x: 2, y: 1, length: 1 }]);
});
