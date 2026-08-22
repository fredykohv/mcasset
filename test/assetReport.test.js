import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateAssetReport, validateAssetFile } from "../src/assetReport.js";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "mcasset-test-"));
}

test("validateAssetFile rejects a missing model path", async () => {
  const dir = await makeTempDir();
  await assert.rejects(
    () => validateAssetFile({ modelPath: path.join(dir, "missing.json") }),
    /does not point to a readable file/
  );
  await rm(dir, { recursive: true, force: true });
});

test("validateAssetFile rejects a modelPath argument that is missing entirely", async () => {
  await assert.rejects(() => validateAssetFile({}), /modelPath is required/);
});

test("validateAssetFile rejects an assetsRoot that is not a directory", async () => {
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "model.json");
  await writeFile(modelPath, JSON.stringify({ elements: [] }));
  const notADir = path.join(dir, "not-a-dir.txt");
  await writeFile(notADir, "x");

  await assert.rejects(
    () => validateAssetFile({ modelPath, assetsRoot: notADir }),
    /assetsRoot is not a readable directory/
  );

  await rm(dir, { recursive: true, force: true });
});

test("validateAssetFile reports fail status with reasons for invalid JSON", async () => {
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "broken.json");
  await writeFile(modelPath, "{ not valid json");

  const { summary } = await validateAssetFile({ modelPath });

  assert.equal(summary.status, "fail");
  assert.equal(summary.decision, "revise_asset");
  assert.ok(summary.errors.some((message) => message.includes("Invalid JSON")));

  await rm(dir, { recursive: true, force: true });
});

test("validateAssetFile resolves parent models and textures from an assets root on disk", async () => {
  const dir = await makeTempDir();
  const assetsRoot = path.join(dir, "assets");
  const namespaceDir = path.join(assetsRoot, "minecraft");

  await mkdir(path.join(namespaceDir, "models", "block"), { recursive: true });
  await mkdir(path.join(namespaceDir, "textures", "block"), { recursive: true });

  await writeFile(
    path.join(namespaceDir, "models", "block", "cube_all.json"),
    JSON.stringify({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }]
    })
  );
  await writeFile(path.join(namespaceDir, "textures", "block", "stone.png"), "fake-png-bytes");

  const modelPath = path.join(dir, "generated_stone.json");
  await writeFile(
    modelPath,
    JSON.stringify({
      parent: "minecraft:block/cube_all",
      textures: { all: "minecraft:block/stone" }
    })
  );

  const { summary } = await validateAssetFile({ modelPath, assetsRoot });

  assert.equal(summary.status, "pass");
  assert.equal(summary.decision, "request_user_approval");
  assert.deepEqual(summary.unresolvedTextureReferences, []);
  assert.deepEqual(summary.metadata.parentChain, ["/assets/minecraft/models/block/cube_all.json"]);

  await rm(dir, { recursive: true, force: true });
});

test("validateAssetFile flags an unresolved texture reference when no assets root is given", async () => {
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "model.json");
  await writeFile(
    modelPath,
    JSON.stringify({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
      textures: { all: "minecraft:block/stone" }
    })
  );

  const { summary } = await validateAssetFile({ modelPath });

  assert.equal(summary.status, "fail");
  assert.deepEqual(summary.unresolvedTextureReferences, ["minecraft:block/stone"]);

  await rm(dir, { recursive: true, force: true });
});

test("generateAssetReport writes summary.json and preview.html artifacts", async () => {
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "model.json");
  await writeFile(
    modelPath,
    JSON.stringify({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
      textures: { all: "minecraft:block/stone" }
    })
  );
  const outDir = path.join(dir, "out");

  const { summary, artifacts } = await generateAssetReport({ modelPath, outDir });

  assert.equal(summary.status, "fail");
  assert.ok(artifacts.summaryPath.endsWith("summary.json"));
  assert.ok(artifacts.previewPath.endsWith("preview.html"));

  const { readFile } = await import("node:fs/promises");
  const writtenSummary = JSON.parse(await readFile(artifacts.summaryPath, "utf8"));
  assert.equal(writtenSummary.status, "fail");

  const previewHtml = await readFile(artifacts.previewPath, "utf8");
  assert.ok(previewHtml.includes("Minecraft asset preview report"));

  await rm(dir, { recursive: true, force: true });
});

test("generateAssetReport does not write artifacts when outDir is omitted", async () => {
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "model.json");
  await writeFile(modelPath, JSON.stringify({ elements: [] }));

  const { artifacts } = await generateAssetReport({ modelPath });

  assert.deepEqual(artifacts, {});

  await rm(dir, { recursive: true, force: true });
});
