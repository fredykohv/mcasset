import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
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

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function minimalSkinPng(width = 64, height = 64) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
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

test("domainKeyFor is stable for identical input and differs when paths change", async () => {
  const keyA = await domainKeyFor({ modelPath: "a.json" }, "/tmp");
  const keyB = await domainKeyFor({ modelPath: "a.json" }, "/tmp");
  const keyC = await domainKeyFor({ modelPath: "b.json" }, "/tmp");
  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
  assert.notEqual(
    await domainKeyFor({ modelPath: "a.json" }, "/tmp"),
    await domainKeyFor({ modelPath: "a.json", sceneMode: "equipment", offhandModelPath: "shield.json" }, "/tmp")
  );
});

test("domainKeyFor changes when reviewed file contents change in place", async () => {
  const dir = await makeTempDir();
  try {
    const modelPath = path.join(dir, "model.json");
    await writeFile(modelPath, "{\"elements\":[]}");
    const first = await domainKeyFor({ modelPath }, dir);
    await writeFile(modelPath, "{\"elements\":[{}]}");
    const second = await domainKeyFor({ modelPath }, dir);
    assert.notEqual(first, second);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeDiagnostics validates both equipment slots and an explicit classic skin", async () => {
  const dir = await makeTempDir();
  try {
    const modelPath = path.join(dir, "sword.json");
    const offhandModelPath = path.join(dir, "shield.json");
    const skinPath = path.join(dir, "steve.png");
    await writeFile(modelPath, VALID_MODEL);
    await writeFile(offhandModelPath, VALID_MODEL);
    await writeFile(skinPath, minimalSkinPng());

    const diagnostics = await computeDiagnostics({
      modelPath,
      sceneMode: "equipment",
      offhandModelPath,
      skinPath
    }, process.cwd());
    assert.equal(diagnostics.error, null);
    assert.equal(diagnostics.equipment.offhand.summary.filename, "shield.json");
    assert.deepEqual(diagnostics.equipment.skin, { path: skinPath, width: 64, height: 64 });
    assert.deepEqual(diagnostics.equipment.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeDiagnostics surfaces invalid equipment inputs without hiding the primary asset", async () => {
  const dir = await makeTempDir();
  try {
    const modelPath = path.join(dir, "sword.json");
    const skinPath = path.join(dir, "skin.png");
    await writeFile(modelPath, VALID_MODEL);
    await writeFile(skinPath, "not-png");
    const diagnostics = await computeDiagnostics({
      modelPath,
      sceneMode: "equipment",
      offhandModelPath: path.join(dir, "missing.json"),
      skinPath
    }, process.cwd());
    assert.equal(diagnostics.summary.filename, "sword.json");
    assert.equal(diagnostics.equipment.offhand, null);
    assert.ok(diagnostics.equipment.errors.some((error) => error.startsWith("Offhand:")));
    assert.ok(diagnostics.equipment.errors.some((error) => error.includes("PNG")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    notification: null,
    parsed: null,
    textureManifest: [],
    equipment: null
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
