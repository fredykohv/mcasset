import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildStatePayload,
  buildTextureManifest,
  computeDiagnostics,
  domainKeyFor,
  loadReview,
  recordReview,
  resolveInputPath,
  resolveTextureFilePath,
  saveReview
} from "../.github/extensions/mcasset-preview/state.mjs";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "mcasset-canvas-test-"));
}

const VALID_MODEL = JSON.stringify({
  textures: { all: "block/stone" },
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        north: { texture: "#all" },
        south: { texture: "#all" },
        east: { texture: "#all" },
        west: { texture: "#all" },
        up: { texture: "#all" },
        down: { texture: "#all" }
      }
    }
  ]
});

test("resolveInputPath returns null for falsy input and resolves relative paths against workingDirectory", () => {
  assert.equal(resolveInputPath(null, "/tmp"), null);
  assert.equal(resolveInputPath("/abs/path.json", "/tmp"), "/abs/path.json");
  assert.equal(resolveInputPath("model.json", "/tmp/project"), path.join("/tmp/project", "model.json"));
});

test("domainKeyFor is stable for identical input and differs when paths change", () => {
  const keyA = domainKeyFor({ modelPath: "a.json" }, "/tmp");
  const keyB = domainKeyFor({ modelPath: "a.json" }, "/tmp");
  const keyC = domainKeyFor({ modelPath: "b.json" }, "/tmp");
  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
});

test("computeDiagnostics reports an error when neither modelPath nor summaryPath is supplied", async () => {
  const diagnostics = await computeDiagnostics({}, process.cwd());
  assert.equal(diagnostics.summary, null);
  assert.match(diagnostics.error, /No modelPath or summaryPath/);
});

test("computeDiagnostics validates a modelPath and reuses src/assetReport.js diagnostics", async () => {
  const dir = await makeTempDir();
  try {
    const modelPath = path.join(dir, "model.json");
    await writeFile(modelPath, VALID_MODEL);

    const diagnostics = await computeDiagnostics({ modelPath }, process.cwd());
    assert.equal(diagnostics.error, null);
    assert.equal(diagnostics.artifacts, null);
    assert.equal(diagnostics.summary.filename, "model.json");
    assert.equal(diagnostics.summary.elementCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeDiagnostics writes report artifacts when outDir is supplied alongside modelPath", async () => {
  const dir = await makeTempDir();
  try {
    const modelPath = path.join(dir, "model.json");
    const outDir = path.join(dir, "out");
    await writeFile(modelPath, VALID_MODEL);

    const diagnostics = await computeDiagnostics({ modelPath, outDir }, process.cwd());
    assert.equal(diagnostics.error, null);
    assert.equal(diagnostics.artifacts.summaryPath, path.join(outDir, "summary.json"));
    assert.equal(diagnostics.artifacts.previewPath, path.join(outDir, "preview.html"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeDiagnostics reads an existing summaryPath verbatim without re-validating", async () => {
  const dir = await makeTempDir();
  try {
    const summaryPath = path.join(dir, "summary.json");
    const fakeSummary = { status: "pass", decision: "request_user_approval", filename: "whatever.json" };
    await writeFile(summaryPath, JSON.stringify(fakeSummary));

    const diagnostics = await computeDiagnostics({ summaryPath }, process.cwd());
    assert.equal(diagnostics.error, null);
    assert.equal(diagnostics.source, "summaryPath");
    assert.deepEqual(diagnostics.summary, fakeSummary);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeDiagnostics surfaces a readable error for a missing modelPath", async () => {
  const dir = await makeTempDir();
  try {
    const diagnostics = await computeDiagnostics({ modelPath: path.join(dir, "missing.json") }, process.cwd());
    assert.equal(diagnostics.summary, null);
    assert.match(diagnostics.error, /does not point to a readable file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordReview rejects changes_requested without feedback and does not persist anything", async () => {
  const dir = await makeTempDir();
  try {
    await assert.rejects(
      () =>
        recordReview({
          input: {},
          workspacePath: dir,
          domainKey: "key1",
          action: "changes_requested",
          feedback: "",
          diagnostics: { summary: null }
        }),
      /Feedback text is required/
    );
    assert.equal(await loadReview(dir, "key1"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordReview persists an approval under workspacePath and loadReview reads it back", async () => {
  const dir = await makeTempDir();
  try {
    const diagnostics = { summary: { status: "pass", decision: "request_user_approval", errors: [], warnings: [], unresolvedTextureReferences: [] } };
    const payload = await recordReview({
      input: { modelPath: "/models/oak_table.json" },
      workspacePath: dir,
      domainKey: "oak-table",
      action: "approved",
      feedback: "",
      diagnostics
    });

    assert.equal(payload.action, "approved");
    assert.equal(payload.model.filename, "oak_table.json");

    const reloaded = await loadReview(dir, "oak-table");
    assert.deepEqual(reloaded, payload);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadReview falls back to the in-memory store when workspacePath is not available", async () => {
  const domainKey = `fallback-${Date.now()}`;
  assert.equal(await loadReview(null, domainKey), null);

  await saveReview(null, domainKey, { review: { action: "approved", timestamp: "now" } });
  const loaded = await loadReview(null, domainKey);
  assert.equal(loaded.action, "approved");
});

test("buildStatePayload shapes the combined diagnostics/review response", () => {
  const payload = buildStatePayload({
    instanceId: "inst-1",
    domainKey: "key-1",
    input: { modelPath: "a.json" },
    diagnostics: { summary: { status: "pass" }, artifacts: null, error: null },
    review: null
  });

  assert.deepEqual(payload, {
    instanceId: "inst-1",
    domainKey: "key-1",
    input: { modelPath: "a.json" },
    summary: { status: "pass" },
    artifacts: null,
    diagnosticsError: null,
    review: null,
    parsed: null,
    textureManifest: []
  });
});

test("buildStatePayload passes through parsed model data and builds a texture manifest", () => {
  const parsed = {
    modelKind: "cuboid",
    textureReferences: ["block/stone", "block/missing"],
    elements: []
  };
  const stoneKey = "/assets/minecraft/textures/block/stone.png";
  const resourcePackIndex = {
    textures: new Map([[stoneKey, { relativePath: "assets/minecraft/textures/block/stone.png", fullPath: "/tmp/x/block/stone.png" }]])
  };

  const payload = buildStatePayload({
    instanceId: "inst-1",
    domainKey: "key-1",
    input: { modelPath: "a.json" },
    diagnostics: { summary: { status: "pass" }, artifacts: null, error: null, parsed, resourcePackIndex },
    review: null
  });

  assert.deepEqual(payload.parsed, parsed);
  assert.deepEqual(payload.textureManifest, [
    { reference: "block/stone", path: stoneKey },
    { reference: "block/missing", path: null }
  ]);
});


test("buildTextureManifest resolves each parsed texture reference against the resource pack index", () => {
  const stoneKey = "/assets/minecraft/textures/block/stone.png";
  const resourcePackIndex = {
    textures: new Map([[stoneKey, { relativePath: "assets/minecraft/textures/block/stone.png", fullPath: "/tmp/x/block/stone.png" }]])
  };
  const parsed = { textureReferences: ["block/stone", "block/unresolved"] };

  assert.deepEqual(buildTextureManifest(parsed, resourcePackIndex), [
    { reference: "block/stone", path: stoneKey },
    { reference: "block/unresolved", path: null }
  ]);
});

test("buildTextureManifest returns an empty array when parsed or resourcePackIndex is missing", () => {
  assert.deepEqual(buildTextureManifest(null, null), []);
  assert.deepEqual(buildTextureManifest({ textureReferences: ["a"] }, null), []);
});

test("resolveTextureFilePath returns the indexed file's fullPath, or null if unresolved", () => {
  const stoneKey = "/assets/minecraft/textures/block/stone.png";
  const resourcePackIndex = {
    textures: new Map([[stoneKey, { relativePath: "assets/minecraft/textures/block/stone.png", fullPath: "/tmp/x/block/stone.png" }]])
  };

  assert.equal(resolveTextureFilePath(resourcePackIndex, stoneKey), "/tmp/x/block/stone.png");
  assert.equal(resolveTextureFilePath(resourcePackIndex, "/assets/minecraft/textures/block/missing.png"), null);
  assert.equal(resolveTextureFilePath(null, stoneKey), null);
});
