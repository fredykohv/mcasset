// State/diagnostics helpers for the mcasset-preview canvas.
//
// Reuses the repo's existing validation/report logic (src/assetReport.js,
// src/modelCore.js, src/reviewFeedback.js) instead of re-implementing
// Minecraft model parsing. Those modules only depend on Node builtins (no
// three.js/vite/zod), so importing them into this extension *process* is
// safe. The 3D viewer itself runs in the canvas iframe's browser context,
// not in this Node process: extension.mjs serves src/modelRenderer.js (plus
// "three" and OrbitControls.js) to the iframe as static files, and the
// browser resolves and executes them there. This module never imports
// three.js/modelRenderer.js itself. All filesystem access below reads only
// the explicit `modelPath` / `assetsRoot` / `summaryPath` paths supplied by
// the caller, or texture files already enumerated while indexing that
// explicit `assetsRoot`; it never scans arbitrary directories on its own.


import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateAssetReport, validateAssetFile } from "../../../src/assetReport.js";
import { resolveUploadedTextureKey } from "../../../src/modelCore.js";
import { createReviewPayload, validateReviewInput } from "../../../src/reviewFeedback.js";

/** Resolves a possibly-relative path against the session's working directory. */
export function resolveInputPath(rawPath, workingDirectory) {
  if (!rawPath) {
    return null;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(workingDirectory ?? process.cwd(), rawPath);
}

/**
 * Derives a stable identifier for the asset an instance is showing, based on
 * its resolved input paths rather than the transient `instanceId`. Review
 * decisions are persisted under this key so re-opening the same asset under
 * a new canvas instance (after a reload, restart, or a fresh `open_canvas`
 * call) still finds its prior review.
 */
export function domainKeyFor(input, workingDirectory) {
  const modelPath = resolveInputPath(input.modelPath, workingDirectory);
  const assetsRoot = resolveInputPath(input.assetsRoot, workingDirectory);
  const summaryPath = resolveInputPath(input.summaryPath, workingDirectory);
  const raw = JSON.stringify({ modelPath, assetsRoot, summaryPath });
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Computes diagnostics for an open instance's input. Prefers a live
 * `modelPath` validation (optionally writing report artifacts to `outDir`,
 * mirroring `npm run asset:preview`); falls back to reading an
 * already-generated `summaryPath` report JSON verbatim.
 *
 * When validating a `modelPath`, also returns the underlying `parsed` model
 * (elements/textures/modelKind) and `resourcePackIndex` (when `assetsRoot`
 * was supplied), so the canvas's 3D viewer can render the same parsed model
 * the diagnostics were computed from without re-parsing it. A `summaryPath`
 * report has no parsed model available, so 3D rendering is skipped for that
 * source (diagnostics still display normally).
 */
export async function computeDiagnostics(input, workingDirectory) {
  const modelPath = resolveInputPath(input.modelPath, workingDirectory);
  const assetsRoot = resolveInputPath(input.assetsRoot, workingDirectory);
  const summaryPath = resolveInputPath(input.summaryPath, workingDirectory);
  const outDir = resolveInputPath(input.outDir, workingDirectory);

  try {
    if (modelPath) {
      if (outDir) {
        const { summary, parsed, resourcePackIndex, artifacts } = await generateAssetReport({
          modelPath,
          assetsRoot: assetsRoot ?? undefined,
          outDir
        });
        return { summary, parsed, resourcePackIndex, artifacts, source: "modelPath", error: null };
      }
      const { summary, parsed, resourcePackIndex } = await validateAssetFile({ modelPath, assetsRoot: assetsRoot ?? undefined });
      return { summary, parsed, resourcePackIndex, artifacts: null, source: "modelPath", error: null };
    }

    if (summaryPath) {
      const raw = await readFile(summaryPath, "utf8");
      const summary = JSON.parse(raw);
      return { summary, parsed: null, resourcePackIndex: null, artifacts: null, source: "summaryPath", error: null };
    }

    return {
      summary: null,
      parsed: null,
      resourcePackIndex: null,
      artifacts: null,
      source: null,
      error: "No modelPath or summaryPath was supplied."
    };
  } catch (error) {
    return {
      summary: null,
      parsed: null,
      resourcePackIndex: null,
      artifacts: null,
      source: modelPath ? "modelPath" : "summaryPath",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Builds the `{ reference, path }` manifest the canvas iframe uses to fetch
 * texture bytes for a parsed model's 3D preview: for every already-resolved
 * texture reference the model uses (`parsed.textureReferences`), looks up
 * the matching normalized key in `resourcePackIndex.textures` (built once
 * from the caller's explicit `assetsRoot`) via `resolveUploadedTextureKey`.
 * `path` is `null` when a reference has no matching texture file on disk
 * (the iframe then falls back to a flat-color placeholder, same as the
 * browser previewer). Pure and side-effect-free; does not touch the
 * filesystem itself.
 */
export function buildTextureManifest(parsed, resourcePackIndex) {
  if (!parsed || !resourcePackIndex?.textures) {
    return [];
  }

  return parsed.textureReferences.map((reference) => ({
    reference,
    path: resolveUploadedTextureKey(reference, resourcePackIndex.textures)
  }));
}

function reviewFilePath(workspacePath, domainKey) {
  return path.join(workspacePath, "mcasset-preview", "reviews", `${domainKey}.json`);
}

// Fallback in-memory store used only when the session has no workspacePath
// (e.g. infinite sessions disabled). Reviews recorded this way do not
// survive an extension process restart.
const fallbackReviews = new Map();

export async function loadReview(workspacePath, domainKey) {
  if (workspacePath) {
    try {
      const raw = await readFile(reviewFilePath(workspacePath, domainKey), "utf8");
      return JSON.parse(raw).review ?? null;
    } catch {
      return null;
    }
  }
  return fallbackReviews.get(domainKey)?.review ?? null;
}

export async function saveReview(workspacePath, domainKey, record) {
  if (workspacePath) {
    const file = reviewFilePath(workspacePath, domainKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  fallbackReviews.set(domainKey, record);
}

/**
 * Validates and records a human review decision for an instance, reusing
 * the same `src/reviewFeedback.js` helpers the browser previewer's Human
 * review panel uses so the exported payload shape is identical. Throws a
 * plain `Error` with a user-facing message on invalid input; callers decide
 * how to surface that (HTTP 400 vs. `CanvasError`).
 */
export async function recordReview({ input, workspacePath, domainKey, action, feedback, diagnostics }) {
  const { ok, errors } = validateReviewInput({ action, feedback });
  if (!ok) {
    throw new Error(errors.join(" "));
  }

  const filename = input.modelPath
    ? path.basename(input.modelPath)
    : input.summaryPath
      ? path.basename(input.summaryPath)
      : null;

  const payload = createReviewPayload({
    action,
    feedback,
    filename,
    modelPath: input.modelPath ?? null,
    summary: diagnostics.summary
  });

  await saveReview(workspacePath, domainKey, { input, review: payload, updatedAt: payload.timestamp });
  return payload;
}

/**
 * Builds the JSON body returned by `/api/state` and canvas actions. Includes
 * the parsed model (when available) and a texture manifest so the iframe's
 * 3D viewer can render the same model the diagnostics summary describes,
 * fetching any resolved textures from `/api/texture?path=...`.
 */
export function buildStatePayload({ instanceId, domainKey, input, diagnostics, review }) {
  return {
    instanceId,
    domainKey,
    input,
    summary: diagnostics.summary ?? null,
    artifacts: diagnostics.artifacts ?? null,
    diagnosticsError: diagnostics.error ?? null,
    review: review ?? null,
    parsed: diagnostics.parsed ?? null,
    textureManifest: buildTextureManifest(diagnostics.parsed, diagnostics.resourcePackIndex)
  };
}

/**
 * Looks up the absolute file path for a normalized texture path (a key from
 * `resourcePackIndex.textures`, e.g. `/assets/minecraft/textures/item/...
 * .png`) so `/api/texture` can stream its bytes. Only ever resolves paths
 * that are already keys of an index built from the caller's explicit
 * `assetsRoot` (see `buildResourcePackIndexFromDisk` in src/assetReport.js);
 * never accepts or reads an arbitrary filesystem path supplied by a client.
 */
export function resolveTextureFilePath(resourcePackIndex, normalizedPath) {
  const entry = resourcePackIndex?.textures?.get(normalizedPath);
  return entry?.fullPath ?? null;
}
