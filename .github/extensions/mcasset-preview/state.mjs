// State/diagnostics helpers for the mcasset-preview canvas.
//
// Reuses the repo's existing validation/report logic (src/assetReport.js,
// src/reviewFeedback.js) instead of re-implementing Minecraft model parsing.
// Those modules only depend on Node builtins (no three.js/vite/zod), so
// importing them from an extension process is safe -- unlike the browser
// previewer's rendering code, which pulls in npm dependencies this extension
// deliberately avoids. All filesystem access below reads only the explicit
// `modelPath` / `assetsRoot` / `summaryPath` paths supplied by the caller; it
// never scans arbitrary directories on its own.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateAssetReport, validateAssetFile } from "../../../src/assetReport.js";
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
 */
export async function computeDiagnostics(input, workingDirectory) {
  const modelPath = resolveInputPath(input.modelPath, workingDirectory);
  const assetsRoot = resolveInputPath(input.assetsRoot, workingDirectory);
  const summaryPath = resolveInputPath(input.summaryPath, workingDirectory);
  const outDir = resolveInputPath(input.outDir, workingDirectory);

  try {
    if (modelPath) {
      if (outDir) {
        const { summary, artifacts } = await generateAssetReport({ modelPath, assetsRoot: assetsRoot ?? undefined, outDir });
        return { summary, artifacts, source: "modelPath", error: null };
      }
      const { summary } = await validateAssetFile({ modelPath, assetsRoot: assetsRoot ?? undefined });
      return { summary, artifacts: null, source: "modelPath", error: null };
    }

    if (summaryPath) {
      const raw = await readFile(summaryPath, "utf8");
      const summary = JSON.parse(raw);
      return { summary, artifacts: null, source: "summaryPath", error: null };
    }

    return { summary: null, artifacts: null, source: null, error: "No modelPath or summaryPath was supplied." };
  } catch (error) {
    return {
      summary: null,
      artifacts: null,
      source: modelPath ? "modelPath" : "summaryPath",
      error: error instanceof Error ? error.message : String(error)
    };
  }
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

/** Builds the JSON body returned by `/api/state` and canvas actions. */
export function buildStatePayload({ instanceId, domainKey, input, diagnostics, review }) {
  return {
    instanceId,
    domainKey,
    input,
    summary: diagnostics.summary ?? null,
    artifacts: diagnostics.artifacts ?? null,
    diagnosticsError: diagnostics.error ?? null,
    review: review ?? null
  };
}
