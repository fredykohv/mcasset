import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPreviewSummary,
  createResourcePackIndex,
  normalizeResourcePath,
  parseMinecraftModel,
  resolveTextureReference,
  resolveUploadedTexture
} from "./modelCore.js";

/**
 * Recursively walks a directory on disk and returns every file found, each
 * described by a path relative to `root` (prefixed with the root folder's
 * own name so it matches the `<folder>/assets/<namespace>/...` shape the
 * browser folder picker produces via `webkitRelativePath`).
 */
async function walkDirectory(root) {
  const rootName = path.basename(root);
  const files = [];

  async function walk(currentDir, relativeDir) {
    const entries = await readdirSafe(currentDir);
    for (const entry of entries) {
      const entryFullPath = path.join(currentDir, entry.name);
      const entryRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(entryFullPath, entryRelativePath);
      } else if (entry.isFile()) {
        files.push({ fullPath: entryFullPath, relativePath: `${rootName}/${entryRelativePath}` });
      }
    }
  }

  await walk(root, "");
  return files;
}

async function readdirSafe(dir) {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir, { withFileTypes: true });
}

/**
 * Builds an in-memory resource-pack index (models + textures) by scanning an
 * assets folder or resource-pack folder on disk. Reuses `createResourcePackIndex`
 * so model/texture path classification stays identical to the browser previewer.
 *
 * `assetsRoot` may point either at a resource-pack root (containing an `assets/`
 * folder) or directly at an `assets/` folder.
 */
export async function buildResourcePackIndexFromDisk(assetsRoot) {
  const rootStat = await stat(assetsRoot).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`assetsRoot is not a readable directory: ${assetsRoot}`);
  }

  const files = await walkDirectory(assetsRoot);
  const entries = [];

  for (const file of files) {
    if (file.relativePath.toLowerCase().endsWith(".json")) {
      const source = await readFile(file.fullPath, "utf8").catch(() => null);
      if (source !== null) {
        entries.push({ path: file.relativePath, source });
      }
    } else if (file.relativePath.toLowerCase().endsWith(".png")) {
      // Carry the absolute file path alongside the relative one so callers
      // that need to stream the actual image bytes (e.g. the mcasset-preview
      // canvas's 3D viewer) can do so without re-walking the assets folder.
      // `createResourcePackIndex` stores this whole object as the texture
      // map's value (see modelCore.js); existing callers only check
      // truthiness/presence, so this is additive and doesn't change
      // existing diagnostics behavior.
      entries.push({ path: file.relativePath, file: { relativePath: file.relativePath, fullPath: file.fullPath } });
    }
  }

  return createResourcePackIndex(entries);
}

function collectResolvedTextureReferences(parsed, textureIndex) {
  const resolved = new Set();

  for (const texturePath of parsed.textureReferences) {
    if (resolveUploadedTexture(texturePath, textureIndex)) {
      resolved.add(texturePath);
    }
  }

  for (const element of parsed.elements) {
    for (const face of Object.values(element.faces)) {
      if (!face?.texture) {
        continue;
      }

      const texturePath = resolveTextureReference(face.texture, parsed.textures);
      if (resolveUploadedTexture(texturePath, textureIndex)) {
        resolved.add(texturePath);
      }
    }
  }

  return resolved;
}

/**
 * Resolves the normalized `/assets/<namespace>/models/...` path for a model
 * file relative to an assets root, when possible. Falls back to the model's
 * basename when the model lives outside the assets root (parent/template
 * lookups will then rely on filename matching only).
 */
function resolveModelPathForIndex(modelFilePath, assetsRoot) {
  if (!assetsRoot) {
    return path.basename(modelFilePath);
  }

  const relative = path.relative(assetsRoot, modelFilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(modelFilePath);
  }

  return normalizeResourcePath(`${path.basename(assetsRoot)}/${relative}`);
}

/**
 * Validates a Minecraft Java Edition model JSON file and produces the same
 * deterministic summary the CLI and browser previewer use. Optionally
 * resolves parent models and textures from an assets/resource-pack folder on
 * disk. Does not write any files; see `generateAssetReport` for report
 * artifacts.
 */
export async function validateAssetFile({ modelPath, assetsRoot }) {
  if (!modelPath || typeof modelPath !== "string") {
    throw new Error("modelPath is required.");
  }

  const modelStat = await stat(modelPath).catch(() => null);
  if (!modelStat || !modelStat.isFile()) {
    throw new Error(`modelPath does not point to a readable file: ${modelPath}`);
  }

  const resourcePackIndex = assetsRoot ? await buildResourcePackIndexFromDisk(assetsRoot) : undefined;
  const source = await readFile(modelPath, "utf8");
  const filename = path.basename(modelPath);
  const normalizedModelPath = resolveModelPathForIndex(modelPath, assetsRoot);

  const parsed = parseMinecraftModel(source, filename, {
    modelPath: normalizedModelPath,
    resourcePackIndex
  });

  const textureIndex = resourcePackIndex?.textures ?? new Map();
  const resolvedTextureReferences = collectResolvedTextureReferences(parsed, textureIndex);
  const summary = createPreviewSummary(parsed, resolvedTextureReferences);

  return { parsed, summary, resourcePackIndex: resourcePackIndex ?? null };
}

/**
 * Validates a model and, when `outDir` is provided, writes `summary.json`
 * and a self-contained `preview.html` report, mirroring
 * `npm run asset:preview`. Returns the summary plus any written artifact
 * paths so callers (CLI or MCP tools) can present or link to the report.
 */
export async function generateAssetReport({ modelPath, assetsRoot, outDir }) {
  const { summary, parsed, resourcePackIndex } = await validateAssetFile({ modelPath, assetsRoot });

  const artifacts = {};

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    const summaryPath = path.join(outDir, "summary.json");
    const previewPath = path.join(outDir, "preview.html");
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(previewPath, renderReport(summary));
    artifacts.summaryPath = summaryPath;
    artifacts.previewPath = previewPath;
  }

  return { summary, parsed, resourcePackIndex, artifacts };
}

export function renderReport(summary) {
  const rows = [
    ["Status", summary.status],
    ["Decision", summary.decision],
    ["File", summary.filename],
    ["Preview mode", summary.modelKind],
    ["Elements", summary.elementCount],
    ["Textures", summary.textureCount],
    ["Texture references", summary.textureReferences.join(", ") || "None"],
    ["Unresolved texture references", summary.unresolvedTextureReferences.join(", ") || "None"],
    ["Errors", summary.errors.join(" | ") || "None"],
    ["Warnings", summary.warnings.join(" | ") || "None"]
  ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Minecraft asset preview report</title>
    <style>
      body { margin: 0; padding: 32px; background: #0b1118; color: #e5eef7; font-family: system-ui, sans-serif; }
      main { max-width: 840px; margin: 0 auto; }
      h1 { margin-top: 0; }
      table { width: 100%; border-collapse: collapse; background: #111a26; border-radius: 16px; overflow: hidden; }
      th, td { padding: 14px 16px; border-bottom: 1px solid #243244; text-align: left; vertical-align: top; }
      th { width: 220px; color: #8aa0b2; }
      .status-pass { color: #86efac; }
      .status-pass_with_warnings { color: #fcd34d; }
      .status-fail { color: #fca5a5; }
      pre { background: #111a26; padding: 16px; border-radius: 12px; overflow: auto; border: 1px solid #243244; }
      .section { margin-top: 24px; }
      .approval { margin-top: 24px; padding: 16px; border-radius: 12px; background: #111a26; border: 1px solid #243244; }
    </style>
  </head>
  <body>
    <main>
      <h1>Minecraft asset preview report</h1>
      <p>This is a diagnostic report, not a 3D preview. Open the model and textures in the mcasset-preview Copilot canvas or the website for visual review.</p>
      <p class="status-${summary.status}">${summary.status === "fail" ? "The model failed deterministic checks." : summary.status === "pass_with_warnings" ? "The model passed checks with warnings." : "The model passed deterministic checks."}</p>
      <table>
        <tbody>
          ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`).join("\n")}
        </tbody>
      </table>
      <section class="section">
        <h2>Actionable reasons</h2>
        <ul>${summary.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("\n")}</ul>
      </section>
      <section class="section">
        <h2>Suggested next steps</h2>
        <ol>${summary.suggestedNextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("\n")}</ol>
      </section>
      <section class="approval">
        <h2>Approval prompt</h2>
        <p>After inspecting the interactive 3D view, does the asset match the requested silhouette, proportions, and materials? Structural checks alone do not establish visual quality.</p>
      </section>
      <section class="section">
        <h2>Agent decision payload</h2>
        <pre>${escapeHtml(JSON.stringify(summary.agentGuidance, null, 2))}</pre>
      </section>
    </main>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
