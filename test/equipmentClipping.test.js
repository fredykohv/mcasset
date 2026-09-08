import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import * as THREE from "three";
import { buildEquipmentScene } from "../src/equipmentScene.js";
import { parseMinecraftModel } from "../src/modelCore.js";

async function sample(folder, name) {
  const root = new URL(`../examples/${folder}/assets/mcasset/`, import.meta.url);
  const parsed = parseMinecraftModel(await readFile(new URL(`models/item/${name}.json`, root), "utf8"));
  const png = await readFile(new URL(`textures/item/${name}.png`, root));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const bytes = inflateSync(Buffer.concat(chunks));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 4 + 1);
    assert.equal(bytes[offset], 0, "Example PNGs use unfiltered RGBA scanlines");
    data.set(bytes.subarray(offset + 1, offset + width * 4 + 1), y * width * 4);
  }
  const texture = new THREE.Texture({ width, height, data });
  return { parsed, textureIndex: new Map([[`/assets/mcasset/textures/item/${name}.png`, texture]]) };
}

function stubImageReadback(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement() {
      let image;
      return { getContext: () => ({
        drawImage: (source) => { image = source; }, getImageData: () => image
      }) };
    } }
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
}

function assertNoBodyPenetration(scene, label) {
  scene.updateMatrixWorld(true);
  for (const name of ["head", "torso", "rightArm", "leftArm", "rightLeg", "leftLeg"]) {
    const part = scene.getObjectByName(name);
    const { width, height, depth } = part.geometry.parameters;
    // The grip may contact the distal four pixels of a holding hand.
    const bottom = -height / 2 + (name.endsWith("Arm") ? 4 : 0);
    const interior = new THREE.Box3(
      new THREE.Vector3(-width / 2 + 0.01, bottom + 0.01, -depth / 2 + 0.01),
      new THREE.Vector3(width / 2 - 0.01, height / 2 - 0.01, depth / 2 - 0.01)
    );
    for (const itemName of ["Main hand item", "Offhand item"]) {
      scene.getObjectByName(itemName)?.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const relative = part.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
        const position = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
        for (let offset = 0; offset < index.count; offset += 3) {
          const vertices = [0, 1, 2].map(j => new THREE.Vector3()
            .fromBufferAttribute(position, index.getX(offset + j)).applyMatrix4(relative));
          assert.equal(interior.intersectsTriangle(new THREE.Triangle(...vertices)), false,
            `${label}: ${itemName} penetrates ${name} outside the gripping hand`);
        }
      });
    }
  }
}

test("the actual sword and shield PNG silhouettes clear Steve outside the gripping hands", async (t) => {
  stubImageReadback(t);
  const sword = await sample("amethyst-sword", "amethyst_sword");
  const shield = await sample("spartan-shield", "spartan_shield");
  for (const [mainHand, offhand] of [[sword, shield], [shield, sword], [sword, null], [null, shield]]) {
    const scene = buildEquipmentScene({ mainHand, offhand });
    const label = `${mainHand?.parsed.textures.layer0 ?? "empty"} / ${offhand?.parsed.textures.layer0 ?? "empty"}`;
    assertNoBodyPenetration(scene, label);
    // Shared shoulders keep the grip correct as either arm rotates.
    scene.getObjectByName("rightArmPivot").rotation.x -= 0.3;
    scene.getObjectByName("leftArmPivot").rotation.x -= 0.3;
    assertNoBodyPenetration(scene, `${label} with raised arms`);
  }
});
