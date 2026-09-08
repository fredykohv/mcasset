// Bootstraps the mcasset-preview canvas's 3D viewer. Served at /app.js by
// extension.mjs (see vendorAssets.mjs) and loaded as a plain ES module by
// the canvas iframe -- there is no bundler in this iframe. Imports
// src/modelRenderer.js (served unmodified at /vendor/modelRenderer.js), the
// exact same module the browser previewer (src/main.js) uses, so the 3D
// scene-building logic lives in one place instead of being duplicated
// between the website and this canvas. Model parsing/diagnostics are never
// redone here -- they arrive pre-computed in the /api/state payload.

import * as THREE from "three";
import { buildModelGroup, createViewer, loadTextureFromUrl } from "./vendor/modelRenderer.js";
import { buildEquipmentScene } from "./vendor/equipmentScene.js";

/** Creates the Three.js viewer bound to the given <canvas> element. */
export function initViewer(canvas) {
  return createViewer(canvas);
}

/**
 * Renders (or re-renders) the 3D preview for a `/api/state` payload.
 * `state.parsed` (elements/textures/modelKind) comes from the same
 * `parseMinecraftModel` call the diagnostics summary was built from -- no
 * re-parsing happens client-side. Any texture references the model uses are
 * fetched from `/api/texture?path=...` per `state.textureManifest` entries
 * before the scene is built; entries with no resolvable file fall back to a
 * flat-color placeholder, matching the browser previewer's behavior for
 * unresolved textures. Calls `onStatus(message)` with a short human-readable
 * summary of what was rendered (or why nothing was).
 */
export async function renderModel(viewer, state, onStatus) {
  const setStatus = typeof onStatus === "function" ? onStatus : () => {};

  if (!state?.parsed) {
    viewer.setModelGroup(new THREE.Group());
    setStatus(
      state?.diagnosticsError
        ? "No 3D preview: diagnostics failed to load."
        : "3D preview requires a modelPath input; a summaryPath-only report has no parsed model to render."
    );
    return;
  }

  const loadManifest = async (manifest, slot) => {
    const textureIndex = new Map();
    await Promise.all(
      manifest
      .filter((entry) => entry && entry.path)
      .map(async (entry) => {
        try {
          const texture = await loadTextureFromUrl(
            `/api/texture?slot=${slot}&path=${encodeURIComponent(entry.path)}`
          );
          textureIndex.set(entry.path, texture);
        } catch (error) {
          setStatus(`Texture load failed for ${entry.reference}: ${error.message}`);
        }
      })
    );
    return textureIndex;
  };

  const manifest = Array.isArray(state.textureManifest) ? state.textureManifest : [];
  const textureIndex = await loadManifest(manifest, "main");

  if (state.equipment?.sceneMode === "equipment") {
    const offhandManifest = state.equipment.offhand?.textureManifest ?? [];
    const offhandTextures = await loadManifest(offhandManifest, "offhand");
    let skinTexture = null;
    if (state.equipment.skin?.available) {
      skinTexture = await loadTextureFromUrl("/api/skin");
    }
    const group = buildEquipmentScene({
      mainHand: { parsed: state.parsed, textureIndex },
      offhand: state.equipment.offhand
        ? { parsed: state.equipment.offhand.parsed, textureIndex: offhandTextures }
        : null,
      skinTexture,
      skinDimensions: state.equipment.skin
    });
    viewer.setModelGroup(group);
    viewer.frameGroup(group, { view: "three-quarter" });
    const issues = group.userData.equipmentDiagnostics.flatMap((entry) =>
      entry.issues.map((issue) => `${entry.slot}: ${issue.message}`)
    );
    const errors = state.equipment.errors ?? [];
    const offhandSummary = state.equipment.offhand?.summary;
    const notes = [
      state.equipment.skin ? "Local classic skin loaded." : "Neutral mannequin shown.",
      "Standing equipped pose (Java 26.1.2 hand transforms; idle bob frozen).",
      state.equipment.offhand ? "Both equipment slots rendered." : "Offhand is empty.",
      ...(offhandSummary
        ? [
            `Offhand validation: ${offhandSummary.status}.`,
            ...offhandSummary.errors,
            ...offhandSummary.warnings,
            ...offhandSummary.unresolvedTextureReferences.map((reference) =>
              `Offhand unresolved texture: ${reference}`
            )
          ]
        : []),
      ...issues,
      ...errors
    ];
    setStatus(notes.join(" "));
    return;
  }

  const group = buildModelGroup(state.parsed, { textureIndex });
  viewer.setModelGroup(group);

  const unresolvedCount = manifest.filter((entry) => !entry?.path).length;
  const unresolvedNote = unresolvedCount
    ? ` ${unresolvedCount} texture reference(s) unresolved (flat color/placeholder shown).`
    : "";

  if (state.parsed.modelKind === "cuboid") {
    setStatus(`${state.parsed.elements.length} cuboid element(s) rendered.${unresolvedNote}`);
  } else if (state.parsed.modelKind === "generated_item") {
    setStatus(`Generated-item sprite preview.${unresolvedNote}`);
  } else if (state.parsed.modelKind === "particle_placeholder") {
    setStatus(`Particle-only placeholder preview (block-entity fidelity is out of scope).${unresolvedNote}`);
  } else {
    setStatus(`Preview mode: ${state.parsed.modelKind}.${unresolvedNote}`);
  }
}
