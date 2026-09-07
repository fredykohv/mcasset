import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcAssetServer } from "../mcp/server.mjs";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "mcasset-mcp-test-"));
}

async function connectedClient() {
  const server = createMcAssetServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcasset-test-client", version: "0.0.1" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client };
}

test("lists validate_minecraft_asset and preview_minecraft_asset tools with input schemas", async () => {
  const { client, server } = await connectedClient();

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, ["preview_minecraft_asset", "validate_minecraft_asset"]);

  const validateTool = tools.find((tool) => tool.name === "validate_minecraft_asset");
  assert.ok(validateTool.inputSchema.properties.modelPath);
  assert.ok(validateTool.description.toLowerCase().includes("minecraft"));

  const previewTool = tools.find((tool) => tool.name === "preview_minecraft_asset");
  assert.ok(previewTool.inputSchema.properties.modelPath);
  assert.ok(previewTool.inputSchema.properties.outDir);
  assert.deepEqual(previewTool.inputSchema.required.sort(), ["modelPath", "outDir"]);

  await client.close();
  await server.close();
});

test("validate_minecraft_asset returns a structured pass_with_warnings summary for a resolvable model", async () => {
  const { client, server } = await connectedClient();
  const dir = await makeTempDir();
  const assetsRoot = path.join(dir, "assets");
  await mkdir(path.join(assetsRoot, "minecraft", "textures", "item"), { recursive: true });
  await writeFile(path.join(assetsRoot, "minecraft", "textures", "item", "example.png"), "fake-png-bytes");

  const modelPath = path.join(dir, "generated.json");
  await writeFile(
    modelPath,
    JSON.stringify({
      parent: "minecraft:item/generated",
      textures: { layer0: "minecraft:item/example" }
    })
  );

  const result = await client.callTool({
    name: "validate_minecraft_asset",
    arguments: { modelPath, assetsRoot }
  });

  assert.equal(result.isError, undefined);
  const summary = JSON.parse(result.content[0].text);
  assert.equal(summary.status, "pass_with_warnings");
  assert.equal(summary.decision, "request_user_approval");
  assert.equal(summary.modelKind, "generated_item");

  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test("validate_minecraft_asset surfaces a clear tool error for a missing model path", async () => {
  const { client, server } = await connectedClient();

  const result = await client.callTool({
    name: "validate_minecraft_asset",
    arguments: { modelPath: "/nonexistent/does-not-exist.json" }
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /does not point to a readable file/);

  await client.close();
  await server.close();
});

test("validate_minecraft_asset rejects calls missing the required modelPath argument", async () => {
  const { client, server } = await connectedClient();

  const result = await client.callTool({
    name: "validate_minecraft_asset",
    arguments: { assetsRoot: "/tmp" }
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /modelPath/);

  await client.close();
  await server.close();
});

test("preview_minecraft_asset writes report artifacts and returns their absolute paths", async () => {
  const { client, server } = await connectedClient();
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

  const result = await client.callTool({
    name: "preview_minecraft_asset",
    arguments: { modelPath, outDir }
  });

  assert.equal(result.isError, undefined);
  const summary = JSON.parse(result.content[0].text);
  assert.equal(summary.status, "fail");
  assert.equal(summary.decision, "revise_asset");
  assert.ok(path.isAbsolute(summary.artifacts.summaryPath));
  assert.ok(summary.artifacts.summaryPath.endsWith("summary.json"));
  assert.ok(summary.artifacts.previewPath.endsWith("preview.html"));

  const { readFile } = await import("node:fs/promises");
  await assert.doesNotReject(() => readFile(summary.artifacts.summaryPath, "utf8"));
  await assert.doesNotReject(() => readFile(summary.artifacts.previewPath, "utf8"));

  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test("preview_minecraft_asset surfaces a tool error without writing artifacts for an unreadable assetsRoot", async () => {
  const { client, server } = await connectedClient();
  const dir = await makeTempDir();
  const modelPath = path.join(dir, "model.json");
  await writeFile(modelPath, JSON.stringify({ elements: [] }));
  const outDir = path.join(dir, "out");

  const result = await client.callTool({
    name: "preview_minecraft_asset",
    arguments: { modelPath, assetsRoot: path.join(dir, "missing-assets"), outDir }
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.match(payload.message, /assetsRoot is not a readable directory/);

  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test("preview tool hands off explicit absolute inputs to the real canvas, not the HTML report", async (t) => {
  const { client, server } = await connectedClient();
  const dir = await makeTempDir();
  t.after(async () => {
    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const modelPath = "examples/amethyst-sword/assets/mcasset/models/item/amethyst_sword.json";
  const assetsRoot = "examples/amethyst-sword";
  const outDir = path.relative(process.cwd(), dir);
  for (const assets of [undefined, assetsRoot]) {
    const result = await client.callTool({
      name: "preview_minecraft_asset",
      arguments: { modelPath, outDir, ...(assets ? { assetsRoot: assets } : {}) }
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(payload.canvasPreview, {
      canvasId: "mcasset-preview",
      input: {
        modelPath: path.resolve(modelPath),
        outDir: path.resolve(outDir),
        ...(assets ? { assetsRoot: path.resolve(assets) } : {})
      }
    });
    if (assets) {
      assert.match(payload.suggestedNextSteps.join(" "), /mcasset-preview/);
      assert.match(payload.suggestedNextSteps.join(" "), /diagnostic report, not a 3D preview/);
    }
  }
});
