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

  const manifest = Array.isArray(state.textureManifest) ? state.textureManifest : [];
  const textureIndex = new Map();

  await Promise.all(
    manifest
      .filter((entry) => entry && entry.path)
      .map(async (entry) => {
        try {
          const texture = await loadTextureFromUrl(`/api/texture?path=${encodeURIComponent(entry.path)}`);
          textureIndex.set(entry.path, texture);
        } catch {
          // Leave unresolved. buildModelGroup falls back to a flat-color
          // placeholder for any texture reference with no matching entry,
          // same as the browser previewer.
        }
      })
  );

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
