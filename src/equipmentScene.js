import * as THREE from "three";
import { buildModelGroup } from "./modelRenderer.js";
import { validateSkinDimensions } from "./playerSkin.js";

export { validateSkinDimensions } from "./playerSkin.js";

export const CLASSIC_PLAYER_DIMENSIONS = Object.freeze({
  width: 16,
  height: 32,
  depth: 4,
  head: [8, 8, 8],
  torso: [8, 12, 4],
  arm: [4, 12, 4],
  leg: [4, 12, 4]
});

export const EQUIPMENT_SLOTS = Object.freeze({
  MAIN_HAND: "main_hand",
  OFFHAND: "offhand"
});

const IDENTITY_DISPLAY_TRANSFORM = Object.freeze({
  rotation: [0, 0, 0],
  translation: [0, 0, 0],
  scale: [1, 1, 1]
});

const PARTS = Object.freeze({
  head: { size: [8, 8, 8], position: [0, 28, 0] },
  torso: { size: [8, 12, 4], position: [0, 18, 0] },
  rightArm: { size: [4, 12, 4], position: [-6, 18, 0] },
  leftArm: { size: [4, 12, 4], position: [6, 18, 0] },
  rightLeg: { size: [4, 12, 4], position: [-2, 6, 0] },
  leftLeg: { size: [4, 12, 4], position: [2, 6, 0] }
});

const SKIN_RECTS_64 = Object.freeze({
  head: [[0, 8, 8, 16], [16, 8, 24, 16], [8, 0, 16, 8], [16, 0, 24, 8], [8, 8, 16, 16], [24, 8, 32, 16]],
  torso: [[16, 20, 20, 32], [28, 20, 32, 32], [20, 16, 28, 20], [28, 16, 36, 20], [20, 20, 28, 32], [32, 20, 40, 32]],
  rightArm: [[40, 20, 44, 32], [48, 20, 52, 32], [44, 16, 48, 20], [48, 16, 52, 20], [44, 20, 48, 32], [52, 20, 56, 32]],
  leftArm: [[32, 52, 36, 64], [40, 52, 44, 64], [36, 48, 40, 52], [40, 48, 44, 52], [36, 52, 40, 64], [44, 52, 48, 64]],
  rightLeg: [[0, 20, 4, 32], [8, 20, 12, 32], [4, 16, 8, 20], [8, 16, 12, 20], [4, 20, 8, 32], [12, 20, 16, 32]],
  leftLeg: [[16, 52, 20, 64], [24, 52, 28, 64], [20, 48, 24, 52], [24, 48, 28, 52], [20, 52, 24, 64], [28, 52, 32, 64]]
});

export function skinUvRects(width, height) {
  const validation = validateSkinDimensions(width, height);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  if (!validation.legacy) {
    return SKIN_RECTS_64;
  }
  return {
    ...SKIN_RECTS_64,
    leftArm: [
      SKIN_RECTS_64.rightArm[1],
      SKIN_RECTS_64.rightArm[0],
      ...SKIN_RECTS_64.rightArm.slice(2)
    ],
    leftLeg: [
      SKIN_RECTS_64.rightLeg[1],
      SKIN_RECTS_64.rightLeg[0],
      ...SKIN_RECTS_64.rightLeg.slice(2)
    ]
  };
}

function cloneTransform(transform) {
  return {
    rotation: [...transform.rotation],
    translation: [...transform.translation],
    scale: [...transform.scale]
  };
}

function mirrorHandTransform(transform) {
  const negate = (value) => value === 0 ? 0 : -value;
  return {
    rotation: [transform.rotation[0], negate(transform.rotation[1]), negate(transform.rotation[2])],
    translation: [negate(transform.translation[0]), transform.translation[1], transform.translation[2]],
    scale: [...transform.scale]
  };
}

function normalizeDisplayTransform(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rotation = value.rotation ?? [0, 0, 0];
  const translation = value.translation ?? [0, 0, 0];
  const scale = value.scale ?? [1, 1, 1];
  if (![rotation, translation, scale].every((vector) =>
    Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)
  )) {
    return null;
  }
  return { rotation: [...rotation], translation: [...translation], scale: [...scale] };
}

export function resolveEquipmentTransform(parsed, slot) {
  if (!Object.values(EQUIPMENT_SLOTS).includes(slot)) {
    throw new Error(`Unknown equipment slot: ${slot}`);
  }
  const display = parsed?.model?.display;
  const issues = [];
  const isLeft = slot === EQUIPMENT_SLOTS.OFFHAND;
  const context = isLeft ? "thirdperson_lefthand" : "thirdperson_righthand";
  let selected = display?.[context];
  let source = context;
  if (isLeft && selected === undefined && display?.thirdperson_righthand !== undefined) {
    selected = display.thirdperson_righthand;
    source = "mirrored_thirdperson_righthand";
    issues.push({ severity: "warning", message: "Missing display.thirdperson_lefthand; using the right-hand display entry and Minecraft's left-hand mirroring." });
  }
  let transform = normalizeDisplayTransform(selected);
  if (!transform) {
    issues.push({
      severity: selected === undefined ? "warning" : "error",
      message: selected === undefined
        ? `Missing display.${context}; using Minecraft's identity display transform, not a guessed weapon preset. Author this item's hand display for the intended grip.`
        : `Invalid display.${context}; expected finite rotation/translation/scale vectors. An identity display transform is shown.`
    });
    transform = cloneTransform(IDENTITY_DISPLAY_TRANSFORM);
    source = "fallback";
  }
  return { transform: isLeft ? mirrorHandTransform(transform) : transform, source, issues };
}

function setFaceUvs(geometry, rects, width, height, mirrorU = false) {
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  geometry.groups.forEach((group) => {
    const [x0, y0, x1, y1] = rects[group.materialIndex];
    const left = x0 / width;
    const right = x1 / width;
    const bottom = 1 - y1 / height;
    const top = 1 - y0 / height;
    const vertexIndices = [...new Set(
      Array.from({ length: group.count }, (_, offset) => index.getX(group.start + offset))
    )];
    vertexIndices.forEach((vertexIndex) => {
      const sourceU = mirrorU ? 1 - uv.getX(vertexIndex) : uv.getX(vertexIndex);
      const sourceV = uv.getY(vertexIndex);
      uv.setXY(
        vertexIndex,
        left + sourceU * (right - left),
        bottom + sourceV * (top - bottom)
      );
    });
  });
  uv.needsUpdate = true;
}

function createPart(name, definition, material, uvRects, skinDimensions, mirrorU = false) {
  const geometry = new THREE.BoxGeometry(...definition.size);
  if (uvRects && skinDimensions) {
    setFaceUvs(geometry, uvRects, skinDimensions.width, skinDimensions.height, mirrorU);
  }
  const mesh = new THREE.Mesh(geometry, Array(6).fill(material));
  mesh.name = name;
  mesh.position.set(...definition.position);
  return mesh;
}

export function buildClassicPlayerGroup({ skinTexture = null, skinDimensions = null } = {}) {
  const group = new THREE.Group();
  group.name = skinTexture ? "Classic Steve player rig" : "Neutral classic player mannequin";
  let rects = null;
  if (skinTexture) {
    const validation = validateSkinDimensions(skinDimensions?.width, skinDimensions?.height);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    rects = skinUvRects(validation.width, validation.height);
    skinTexture.magFilter = THREE.NearestFilter;
    skinTexture.minFilter = THREE.NearestFilter;
  }
  const material = skinTexture
    ? new THREE.MeshBasicMaterial({ map: skinTexture })
    : new THREE.MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.9 });

  Object.entries(PARTS).forEach(([name, definition]) => {
    const mirrorLegacyLimb =
      skinDimensions?.height === 32 && (name === "leftArm" || name === "leftLeg");
    const part = createPart(name, definition, material, rects?.[name], skinDimensions, mirrorLegacyLimb);
    if (name === "rightArm" || name === "leftArm") {
      const sign = name === "rightArm" ? -1 : 1;
      const pivot = new THREE.Group();
      pivot.name = `${name}Pivot`;
      pivot.position.set(sign * 5, 22, 0);
      part.position.set(sign, -4, 0);
      pivot.add(part);
      group.add(pivot);
    } else {
      group.add(part);
    }
  });
  return group;
}

export function applyDisplayTransform(group, transform) {
  group.position.set(...transform.translation);
  group.scale.set(...transform.scale);
  group.rotation.order = "XYZ";
  group.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad));
}

function addEquipment(player, slot, equipment, diagnostics) {
  if (!equipment?.parsed) {
    return;
  }
  const isRight = slot === EQUIPMENT_SLOTS.MAIN_HAND;
  const shoulder = player.getObjectByName(isRight ? "rightArmPivot" : "leftArmPivot");
  // Java 26.1.2 standing ArmPose.ITEM, with idle bob deliberately frozen.
  shoulder.rotation.x = -Math.PI / 10;
  const mount = new THREE.Group();
  mount.name = slot === EQUIPMENT_SLOTS.MAIN_HAND ? "Main hand mount" : "Offhand mount";
  // ItemInHandLayer expressed in our feet-at-zero, +Y-up, +Z-forward pixels.
  // Geometry already has its -8 centering; don't apply that a second time.
  mount.position.set(isRight ? -1 : 1, -10, 2);
  mount.rotation.set(Math.PI / 2, Math.PI, 0, "XYZ");

  const item = buildModelGroup(equipment.parsed, { textureIndex: equipment.textureIndex ?? new Map() });
  item.name = slot === EQUIPMENT_SLOTS.MAIN_HAND ? "Main hand item" : "Offhand item";
  const resolved = resolveEquipmentTransform(equipment.parsed, slot);
  applyDisplayTransform(item, resolved.transform);
  mount.add(item);
  shoulder.add(mount);
  diagnostics.push({ slot, transformSource: resolved.source, issues: resolved.issues });
}

export function buildEquipmentScene({
  mainHand = null,
  offhand = null,
  skinTexture = null,
  skinDimensions = null
} = {}) {
  const group = new THREE.Group();
  group.name = "Classic player equipment preview";
  const player = buildClassicPlayerGroup({ skinTexture, skinDimensions });
  group.add(player);
  const diagnostics = [];
  addEquipment(player, EQUIPMENT_SLOTS.MAIN_HAND, mainHand, diagnostics);
  addEquipment(player, EQUIPMENT_SLOTS.OFFHAND, offhand, diagnostics);
  group.userData.equipmentDiagnostics = diagnostics;
  return group;
}
