import test from "node:test";
import assert from "node:assert/strict";
import {
  createPreviewSummary,
  createStatusFeedback,
  parseMinecraftModel,
  resolveUploadedTexture,
  textureCandidates
} from "../src/modelCore.js";

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

test("status feedback describes unresolved textures without calling them model errors", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      textures: { layer0: "minecraft:item/acacia_hanging_sign" },
      parent: "minecraft:item/generated"
    }),
    "acacia_hanging_sign.json"
  );

  const summary = createPreviewSummary(parsed);
  const feedback = createStatusFeedback(summary);

  assert.equal(feedback.className, "status status-error");
  assert.match(feedback.message, /required texture files are missing/);
  assert.doesNotMatch(feedback.message, /model JSON errors/);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.status, "fail");
  assert.equal(summary.decision, "revise_asset");
});

test("status feedback describes validation errors separately from texture blockers", () => {
  const parsed = parseMinecraftModel("{", "broken.json");
  const summary = createPreviewSummary(parsed);
  const feedback = createStatusFeedback(summary);

  assert.equal(feedback.className, "status status-error");
  assert.match(feedback.message, /model JSON has validation errors/);
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

test("parses elementless generated item models with layer0 texture", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      parent: "minecraft:item/generated",
      textures: { layer0: "minecraft:item/acacia_hanging_sign" }
    }),
    "acacia_hanging_sign.json"
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.modelKind, "generated_item");
  assert.equal(parsed.elements.length, 0);
  assert.deepEqual(parsed.textureReferences, ["minecraft:item/acacia_hanging_sign"]);

  const summary = createPreviewSummary(parsed, new Set(["minecraft:item/acacia_hanging_sign"]));
  assert.equal(summary.status, "pass_with_warnings");
  assert.equal(summary.decision, "request_user_approval");
});

test("accepts generated item parent aliases", () => {
  for (const parent of ["minecraft:item/generated", "item/generated", "builtin/generated"]) {
    const parsed = parseMinecraftModel(JSON.stringify({ parent, textures: { layer0: "item/stick" } }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.modelKind, "generated_item");
  }
});

test("resolves generated item texture path candidates from common upload layouts", () => {
  const expectedCandidates = [
    "/minecraft:item/acacia_hanging_sign.png",
    "/item/acacia_hanging_sign.png",
    "/textures/item/acacia_hanging_sign.png",
    "/assets/minecraft/textures/item/acacia_hanging_sign.png",
    "/acacia_hanging_sign.png"
  ];

  assert.deepEqual(
    textureCandidates("minecraft:item/acacia_hanging_sign").filter((candidate) => expectedCandidates.includes(candidate)),
    expectedCandidates
  );

  for (const candidate of expectedCandidates.slice(1)) {
    assert.equal(resolveUploadedTexture("minecraft:item/acacia_hanging_sign", new Map([[candidate, candidate]])), candidate);
  }
});

test("uses a particle placeholder warning for elementless particle-only models", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      textures: { particle: "minecraft:block/chest" }
    }),
    "chest.json"
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.modelKind, "particle_placeholder");
  assert.deepEqual(parsed.textureReferences, ["minecraft:block/chest"]);
  assert.ok(parsed.warnings.some((warning) => warning.includes("particle")));

  const summary = createPreviewSummary(parsed);
  assert.equal(summary.status, "pass_with_warnings");
  assert.equal(summary.decision, "request_user_approval");
  assert.deepEqual(summary.unresolvedTextureReferences, ["minecraft:block/chest"]);
  assert.deepEqual(summary.blockers, []);
});
