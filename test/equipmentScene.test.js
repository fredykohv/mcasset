import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildClassicPlayerGroup,
  buildEquipmentScene,
  CLASSIC_PLAYER_DIMENSIONS,
  EQUIPMENT_SLOTS,
  resolveEquipmentTransform,
  skinUvRects,
  validateSkinDimensions
} from "../src/equipmentScene.js";
import { parseMinecraftModel } from "../src/modelCore.js";

const ITEM_SOURCE = JSON.stringify({
  elements: [{ from: [7, 0, 7], to: [9, 16, 9], faces: {} }],
  display: {
    thirdperson_righthand: {
      rotation: [1, 2, 3],
      translation: [4, 5, 6],
      scale: [0.5, 0.6, 0.7]
    },
    thirdperson_lefthand: {
      rotation: [-1, -2, -3],
      translation: [-4, 5, 6],
      scale: [0.7, 0.6, 0.5]
    }
  }
});

test("classic player rig is 32 model units tall with 4px arms", () => {
  assert.deepEqual(CLASSIC_PLAYER_DIMENSIONS.head, [8, 8, 8]);
  assert.deepEqual(CLASSIC_PLAYER_DIMENSIONS.arm, [4, 12, 4]);
  const player = buildClassicPlayerGroup();
  const bounds = new THREE.Box3().setFromObject(player);
  assert.equal(bounds.min.y, 0);
  assert.equal(bounds.max.y, 32);
  assert.equal(player.getObjectByName("rightArm").geometry.parameters.width, 4);
});

test("validates supported classic skin sizes and maps legacy mirrored limbs", () => {
  assert.equal(validateSkinDimensions(64, 64).ok, true);
  assert.equal(validateSkinDimensions(64, 32).legacy, true);
  assert.equal(validateSkinDimensions(128, 128).ok, false);
  const modern = skinUvRects(64, 64);
  const legacy = skinUvRects(64, 32);
  assert.deepEqual(modern.head[4], [8, 8, 16, 16]);
  assert.deepEqual(legacy.leftArm[0], legacy.rightArm[1]);
  assert.deepEqual(legacy.leftArm[1], legacy.rightArm[0]);
  assert.deepEqual(legacy.leftLeg[0], legacy.rightLeg[1]);
});

test("uses authored transforms for both hands", () => {
  const parsed = parseMinecraftModel(ITEM_SOURCE);
  const main = resolveEquipmentTransform(parsed, EQUIPMENT_SLOTS.MAIN_HAND);
  const offhand = resolveEquipmentTransform(parsed, EQUIPMENT_SLOTS.OFFHAND);
  assert.equal(main.source, "thirdperson_righthand");
  assert.deepEqual(main.transform.translation, [4, 5, 6]);
  assert.equal(offhand.source, "thirdperson_lefthand");
  assert.deepEqual(offhand.transform.rotation, [-1, 2, 3]);
  assert.deepEqual(offhand.transform.translation, [4, 5, 6]);
  assert.deepEqual(offhand.transform.scale, [0.7, 0.6, 0.5]);
});

test("applies authored rotations with XYZ composition", () => {
  const parsed = parseMinecraftModel(ITEM_SOURCE);
  const scene = buildEquipmentScene({ mainHand: { parsed } });
  const item = scene.getObjectByName("Main hand item");
  assert.equal(item.rotation.order, "XYZ");
  item.updateMatrix();
  const expected = new THREE.Matrix4().compose(
    new THREE.Vector3(4, 5, 6),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(1),
      THREE.MathUtils.degToRad(2),
      THREE.MathUtils.degToRad(3),
      "XYZ"
    )),
    new THREE.Vector3(0.5, 0.6, 0.7)
  );
  assert.ok(item.matrix.equals(expected));
});

test("maps skin rectangles through BoxGeometry canonical UV orientation", () => {
  const texture = new THREE.Texture({ width: 64, height: 64 });
  const player = buildClassicPlayerGroup({
    skinTexture: texture,
    skinDimensions: { width: 64, height: 64 }
  });
  const head = player.getObjectByName("head");
  const uv = head.geometry.getAttribute("uv");
  const group = head.geometry.groups[4];
  const index = head.geometry.getIndex();
  for (let offset = 0; offset < group.count; offset += 1) {
    const vertex = index.getX(group.start + offset);
    assert.ok(uv.getX(vertex) >= 8 / 64 && uv.getX(vertex) <= 16 / 64);
    assert.ok(uv.getY(vertex) >= 48 / 64 && uv.getY(vertex) <= 56 / 64);
  }
});

test("mirrors right-hand transforms for missing offhand context and reports fallback", () => {
  const parsed = parseMinecraftModel(JSON.stringify({
    elements: [],
    display: {
      thirdperson_righthand: { rotation: [10, -20, 30], translation: [2, 4, 6], scale: [1, 2, 3] }
    }
  }));
  const resolved = resolveEquipmentTransform(parsed, EQUIPMENT_SLOTS.OFFHAND);
  assert.equal(resolved.source, "mirrored_thirdperson_righthand");
  assert.deepEqual(resolved.transform, {
    rotation: [10, 20, -30],
    translation: [-2, 4, 6],
    scale: [1, 2, 3]
  });
  assert.match(resolved.issues[0].message, /mirroring/);
});

test("invalid transforms visibly fall back instead of hiding the item", () => {
  const parsed = parseMinecraftModel(JSON.stringify({
    elements: [],
    display: { thirdperson_righthand: { rotation: [0, "bad", 0] } }
  }));
  const resolved = resolveEquipmentTransform(parsed, EQUIPMENT_SLOTS.MAIN_HAND);
  assert.equal(resolved.source, "fallback");
  assert.equal(resolved.issues[0].severity, "error");
});

test("builds one shared scene with main-hand and offhand items simultaneously", () => {
  const parsed = parseMinecraftModel(ITEM_SOURCE);
  const scene = buildEquipmentScene({ mainHand: { parsed }, offhand: { parsed } });
  assert.ok(scene.getObjectByName("Main hand item"));
  assert.ok(scene.getObjectByName("Offhand item"));
  assert.equal(scene.userData.equipmentDiagnostics.length, 2);
});

test("hand mounts use the Java 26.1.2 standing ITEM shoulder chain in model pixels", () => {
  const parsed = parseMinecraftModel(ITEM_SOURCE);
  const scene = buildEquipmentScene({ mainHand: { parsed }, offhand: { parsed } });
  scene.updateMatrixWorld(true);
  for (const [name, x, armName] of [
    ["Main hand mount", -6, "rightArm"],
    ["Offhand mount", 6, "leftArm"]
  ]) {
    const mount = scene.getObjectByName(name);
    const actual = mount.getWorldPosition(new THREE.Vector3());
    const expected = new THREE.Vector3(x, 13.107468826, 4.992282977);
    assert.ok(actual.distanceTo(expected) < 0.00001, `${name}: ${actual.toArray()}`);
    const pivot = scene.getObjectByName(armName).parent;
    assert.equal(mount.parent, pivot, "Item and arm must share their shoulder transform");
    assert.equal(pivot.rotation.x, -Math.PI / 10);
    // Compare orientation separately: ITEM pitch then the hand-layer basis.
    const handFrame = new THREE.Matrix4().makeRotationX(-Math.PI / 10);
    handFrame.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    handFrame.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    const actualRotation = new THREE.Matrix4().extractRotation(mount.matrixWorld);
    actualRotation.elements.forEach((value, index) =>
      assert.ok(Math.abs(value - handFrame.elements[index]) < 0.00001)
    );
  }
});

test("unposed classic arms remain down when their equipment slots are empty", () => {
  const scene = buildEquipmentScene();
  const right = scene.getObjectByName("rightArm");
  assert.equal(right.parent.name, "rightArmPivot");
  assert.equal(right.parent.rotation.x, 0);
  scene.updateMatrixWorld(true);
  assert.deepEqual(right.getWorldPosition(new THREE.Vector3()).toArray(), [-6, 18, 0]);
});

test("missing displays use identity, never a guessed sword transform for shields", () => {
  const parsed = parseMinecraftModel('{"parent":"minecraft:builtin/generated","textures":{"layer0":"item/shield"}}');
  for (const slot of Object.values(EQUIPMENT_SLOTS)) {
    const resolved = resolveEquipmentTransform(parsed, slot);
    assert.deepEqual(resolved.transform, {
      rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1]
    });
    assert.match(resolved.issues[0].message, /identity/);
  }
});

test("explicit offhand display uses left-hand signs exactly once in its item matrix", () => {
  const scene = buildEquipmentScene({ offhand: { parsed: parseMinecraftModel(ITEM_SOURCE) } });
  const item = scene.getObjectByName("Offhand item");
  item.updateMatrix();
  const expected = new THREE.Matrix4().makeTranslation(4, 5, 6)
    .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-1)))
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(2)))
    .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(3)))
    .multiply(new THREE.Matrix4().makeScale(0.7, 0.6, 0.5));
  item.matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-8));
});

test("invalid explicit left-hand display reports an error instead of silently using the right", () => {
  const parsed = parseMinecraftModel(JSON.stringify({
    elements: [],
    display: {
      thirdperson_righthand: { rotation: [0, -90, 55] },
      thirdperson_lefthand: { scale: [1, "invalid", 1] }
    }
  }));
  const resolved = resolveEquipmentTransform(parsed, EQUIPMENT_SLOTS.OFFHAND);
  assert.equal(resolved.issues[0].severity, "error");
  assert.deepEqual(resolved.transform.scale, [1, 1, 1]);
});
