import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { parseMinecraftModel } from "../src/modelCore.js";
import { buildModelGroup } from "../src/modelRenderer.js";

function renderImage(t, width, height, mask) {
  const data = new Uint8ClampedArray(width * height * 4);
  mask.forEach((opaque, index) => data.set([180, 100, 220, opaque ? 255 : 0], index * 4));
  const imageData = { width, height, data };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        return {
          getContext() {
            return { drawImage() {}, getImageData: () => imageData };
          }
        };
      }
    }
  });
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, "document", previous);
    } else {
      delete globalThis.document;
    }
  });
  const parsed = parseMinecraftModel(JSON.stringify({
    parent: "minecraft:builtin/generated",
    textures: { layer0: "mcasset:item/test" }
  }));
  const texture = new THREE.Texture({ width, height });
  const group = buildModelGroup(parsed, {
    textureIndex: new Map([["/assets/mcasset/textures/item/test.png", texture]])
  });
  group.updateMatrixWorld(true);
  return group;
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
}

test("generated item side walls stay within the one-unit thickness", (t) => {
  const group = renderImage(t, 4, 4, [
    false, false, false, false,
    false, true, false, false,
    false, false, false, false,
    false, false, false, false
  ]);
  const bounds = new THREE.Box3().setFromObject(group);
  near(bounds.min.z, -0.5);
  near(bounds.max.z, 0.5);
  const sides = group.children.slice(2);
  assert.equal(sides.length, 4);
  const expectedCenters = [[-2, 4, 0], [-2, 0, 0], [-4, 2, 0], [0, 2, 0]];
  sides.forEach((mesh, index) => {
    mesh.position.toArray().forEach((value, axis) => near(value, expectedCenters[index][axis]));
  });
});

test("all silhouette walls sample the opaque pixel, not its transparent neighbor", (t) => {
  const group = renderImage(t, 4, 4, [
    false, false, false, false,
    false, true, false, false,
    false, false, false, false,
    false, false, false, false
  ]);
  for (const side of group.children.slice(2)) {
    const uv = side.geometry.getAttribute("uv");
    const u = Array.from({ length: uv.count }, (_, i) => uv.getX(i)).reduce((a, b) => a + b) / uv.count;
    const v = Array.from({ length: uv.count }, (_, i) => uv.getY(i)).reduce((a, b) => a + b) / uv.count;
    assert.equal(Math.floor(u * 4), 1);
    assert.equal(Math.floor((1 - v) * 4), 1);
  }
});

test("rear rectangles preserve pixel positions instead of reversing each texture region", (t) => {
  const group = renderImage(t, 4, 2, [true, true, false, true, false, true, true, true]);
  const backs = group.children.filter((mesh) => mesh.rotation.y === Math.PI);
  assert.ok(backs.length > 1);
  for (const back of backs) {
    const positions = back.geometry.getAttribute("position");
    const uv = back.geometry.getAttribute("uv");
    for (let i = 0; i < positions.count; i += 1) {
      const world = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(back.matrixWorld);
      near(uv.getX(i), (world.x + 8) / 16);
      near(uv.getY(i), (world.y + 8) / 16);
    }
  }
});
