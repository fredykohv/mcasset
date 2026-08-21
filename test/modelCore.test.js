import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewSummary, parseMinecraftModel, textureBasename } from "../src/modelCore.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const fixtureDir = path.join(__dirname, "fixtures");

async function readFixture(name) {
  return readFile(path.join(fixtureDir, name), "utf8");
}

test("parseMinecraftModel accepts a simple cube and extracts texture references", async () => {
  const parsed = parseMinecraftModel(await readFixture("simple-cube.json"), "simple-cube.json");
  const summary = createPreviewSummary(parsed);

  assert.equal(parsed.ok, true);
  assert.equal(summary.elementCount, 1);
  assert.equal(summary.textureCount, 1);
  assert.deepEqual(summary.textureReferences, ["block/stone"]);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
});

test("parseMinecraftModel reports invalid JSON as an error", async () => {
  const parsed = parseMinecraftModel(await readFixture("invalid-json.json"), "invalid-json.json");
  const summary = createPreviewSummary(parsed);

  assert.equal(parsed.ok, false);
  assert.equal(summary.elementCount, 0);
  assert.equal(summary.textureCount, 0);
  assert.match(summary.errors[0], /^Invalid JSON:/);
});

test("parseMinecraftModel reports a missing elements array", async () => {
  const parsed = parseMinecraftModel(await readFixture("missing-elements.json"), "missing-elements.json");
  const summary = createPreviewSummary(parsed);

  assert.equal(parsed.ok, false);
  assert.equal(summary.elementCount, 0);
  assert.deepEqual(summary.errors, ["Model must include an `elements` array."]);
});

test("parseMinecraftModel warns for out-of-bounds and malformed coordinates", async () => {
  const parsed = parseMinecraftModel(await readFixture("malformed-coordinates.json"), "malformed-coordinates.json");
  const summary = createPreviewSummary(parsed);

  assert.equal(parsed.ok, true);
  assert.equal(summary.elementCount, 1);
  assert.deepEqual(summary.textureReferences, ["block/oak_planks", "block/stone"]);
  assert.ok(
    summary.warnings.includes("Element 0 extends outside the standard 0..16 Minecraft model bounds.")
  );
  assert.ok(summary.warnings.includes("elements[1].from must be an array of three finite numbers."));
  assert.ok(summary.warnings.includes("Element 1 is missing valid from/to coordinates and was skipped."));
});

test("textureBasename normalizes texture identifiers and file paths", () => {
  assert.equal(textureBasename("#all"), "all");
  assert.equal(textureBasename("minecraft:block/oak_planks.png"), "oak_planks");
  assert.equal(textureBasename("block/stone"), "stone");
  assert.equal(textureBasename(null), "");
});

test("preview asset CLI writes summary and preview files for a valid fixture", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "mcasset-preview-"));

  try {
    await execFileAsync(process.execPath, [
      path.join(rootDir, "scripts/preview-asset.mjs"),
      path.join(fixtureDir, "simple-cube.json"),
      "--out",
      outDir
    ]);

    const summaryPath = path.join(outDir, "summary.json");
    const previewPath = path.join(outDir, "preview.html");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));

    assert.equal(summary.ok, true);
    assert.equal(summary.elementCount, 1);
    assert.deepEqual(summary.textureReferences, ["block/stone"]);
    assert.equal((await stat(previewPath)).isFile(), true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
