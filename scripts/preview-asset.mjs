#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPreviewSummary, parseMinecraftModel } from "../src/modelCore.js";

const args = process.argv.slice(2);
const inputPath = args[0];
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : "preview-output";

if (!inputPath) {
  console.error("Usage: npm run asset:preview -- <model.json> --out <output-dir>");
  process.exit(2);
}

const source = await readFile(inputPath, "utf8");
const parsed = parseMinecraftModel(source, path.basename(inputPath));
const summary = createPreviewSummary(parsed);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outDir, "preview.html"), renderReport(summary));

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);

function renderReport(summary) {
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
        <p>Does this preview fit the requested Minecraft asset well enough to approve, or should the asset be revised?</p>
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
