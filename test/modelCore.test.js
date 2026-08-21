import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewSummary, parseMinecraftModel, resolveUploadedTexture } from "../src/modelCore.js";

test("resolves uploaded textures from common resource-pack path variants", () => {
  const index = new Map([
    ["/assets/minecraft/textures/block/stone.png", "a"],
    ["/textures/block/dirt.png", "b"],
    ["/block/oak_planks.png", "c"],
    ["/stone.png", "d"]
  ]);

  assert.equal(resolveUploadedTexture("minecraft:block/stone", index), "a");
  assert.equal(resolveUploadedTexture("textures/block/dirt", index), "b");
  assert.equal(resolveUploadedTexture("block/oak_planks", index), "c");
  assert.equal(resolveUploadedTexture("stone", index), "d");
});

test("includes unresolved texture references in preview summary diagnostics", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      textures: { side: "block/stone" },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            north: { texture: "#side" },
            south: { texture: "#missing" }
          }
        }
      ]
    }),
    "stone.json"
  );

  const summary = createPreviewSummary(parsed, new Set(["block/stone"]));
  assert.deepEqual(summary.unresolvedTextureReferences, ["#missing"]);
  assert.equal(summary.status, "fail");
  assert.equal(summary.decision, "revise_asset");
  assert.equal(summary.agentGuidance.recommendedAction, "revise_asset");
  assert.ok(summary.blockers.some((blocker) => blocker.code === "unresolved-texture-reference"));
  assert.ok(summary.suggestedNextSteps.some((step) => step.includes("Provide texture files")));
});

test("marks clean model summaries as ready for user approval", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      textures: { side: "block/stone" },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            north: { texture: "#side" }
          }
        }
      ]
    }),
    "stone.json"
  );
  const summary = createPreviewSummary(parsed, new Set(["block/stone"]));
  assert.equal(summary.status, "pass");
  assert.equal(summary.decision, "request_user_approval");
  assert.equal(summary.agentGuidance.recommendedAction, "request_user_approval");
});

test("normalizes valid face uv values and warns on invalid uv arrays", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            north: { texture: "#t0", uv: [0, 0, 16, 16] },
            south: { texture: "#t1", uv: [0, 0, 16] }
          }
        }
      ]
    })
  );

  assert.deepEqual(parsed.elements[0].faces.north.uv, [0, 0, 16, 16]);
  assert.equal(parsed.elements[0].faces.south.uv, null);
  assert.ok(parsed.warnings.some((warning) => warning.includes("uv must be an array of four finite numbers")));
});
