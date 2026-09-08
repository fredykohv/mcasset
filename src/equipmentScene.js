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

const DEFAULT_RIGHT_HAND_TRANSFORM = Object.freeze({
  rotation: [0, -90, 55],
  translation: [0, 4, 0.5],
  scale: [0.85, 0.85, 0.85]
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

function mirrorRightTransform(transform) {
  return {
    rotation: [transform.rotation[0], -transform.rotation[1], -transform.rotation[2]],
    translation: [-transform.translation[0], transform.translation[1], transform.translation[2]],
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
  const display = parsed?.model?.display;
  const right = normalizeDisplayTransform(display?.thirdperson_righthand);
  const left = normalizeDisplayTransform(display?.thirdperson_lefthand);
  const issues = [];

  if (slot === EQUIPMENT_SLOTS.MAIN_HAND) {
    if (right) {
      return { transform: right, source: "thirdperson_righthand", issues };
    }
    issues.push({
      severity: display?.thirdperson_righthand === undefined ? "warning" : "error",
      message: display?.thirdperson_righthand === undefined
        ? "Missing display.thirdperson_righthand; using the documented vanilla handheld fallback."
        : "Invalid display.thirdperson_righthand; expected finite rotation/translation/scale vectors, so the fallback is shown."
    });
    return { transform: cloneTransform(DEFAULT_RIGHT_HAND_TRANSFORM), source: "fallback", issues };
  }

  if (left) {
    return { transform: left, source: "thirdperson_lefthand", issues };
  }
  if (right) {
    issues.push({
      severity: "warning",
      message: "Missing display.thirdperson_lefthand; mirroring the authored right-hand transform for this static preview."
    });
    return { transform: mirrorRightTransform(right), source: "mirrored_thirdperson_righthand", issues };
  }
  issues.push({
    severity: display?.thirdperson_lefthand === undefined ? "warning" : "error",
    message: display?.thirdperson_lefthand === undefined
      ? "Missing hand display transforms; using the mirrored vanilla handheld fallback for offhand."
      : "Invalid display.thirdperson_lefthand; expected finite rotation/translation/scale vectors, so the fallback is shown."
  });
  return {
    transform: mirrorRightTransform(DEFAULT_RIGHT_HAND_TRANSFORM),
    source: "mirrored_fallback",
    issues
  };
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
    group.add(createPart(name, definition, material, rects?.[name], skinDimensions, mirrorLegacyLimb));
  });
  return group;
}

export function applyDisplayTransform(group, transform) {
  group.position.set(...transform.translation);
  group.scale.set(...transform.scale);
  group.rotation.order = "XYZ";
  group.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad));
}

function addEquipment(root, slot, equipment, diagnostics) {
  if (!equipment?.parsed) {
    return;
  }
  const mount = new THREE.Group();
  mount.name = slot === EQUIPMENT_SLOTS.MAIN_HAND ? "Main hand mount" : "Offhand mount";
  mount.position.set(slot === EQUIPMENT_SLOTS.MAIN_HAND ? -6 : 6, 12, 0);

  const item = buildModelGroup(equipment.parsed, { textureIndex: equipment.textureIndex ?? new Map() });
  item.name = slot === EQUIPMENT_SLOTS.MAIN_HAND ? "Main hand item" : "Offhand item";
  const resolved = resolveEquipmentTransform(equipment.parsed, slot);
  applyDisplayTransform(item, resolved.transform);
  mount.add(item);
  root.add(mount);
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
  group.add(buildClassicPlayerGroup({ skinTexture, skinDimensions }));
  const diagnostics = [];
  addEquipment(group, EQUIPMENT_SLOTS.MAIN_HAND, mainHand, diagnostics);
  addEquipment(group, EQUIPMENT_SLOTS.OFFHAND, offhand, diagnostics);
  group.userData.equipmentDiagnostics = diagnostics;
  return group;
}
