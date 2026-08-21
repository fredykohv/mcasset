import test from "node:test";
import assert from "node:assert/strict";
import {
  createResourcePackIndex,
  createPreviewSummary,
  createStatusFeedback,
  modelReferenceCandidates,
  normalizeResourcePath,
  parseMinecraftModel,
  resolveTextureReference,
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

test("resolves chained texture variables through inherited texture maps", () => {
  assert.equal(
    resolveTextureReference("#particle", { particle: "#all", all: "minecraft:block/stone" }),
    "minecraft:block/stone"
  );
  assert.equal(resolveTextureReference("#missing", { all: "minecraft:block/stone" }), "#missing");
});

test("normalizes resource-pack paths from selected folders", () => {
  assert.equal(
    normalizeResourcePath("26.1.2/assets/minecraft/models/block/cube_all.json"),
    "/assets/minecraft/models/block/cube_all.json"
  );
  assert.equal(
    normalizeResourcePath("\\resource-pack\\assets\\minecraft\\textures\\block\\stone.png"),
    "/assets/minecraft/textures/block/stone.png"
  );
});

test("indexes model JSON and PNG texture files from resource-pack paths", () => {
  const index = createResourcePackIndex([
    { path: "pack/assets/minecraft/models/block/cube_all.json", source: "{}" },
    { path: "pack/assets/minecraft/models/item/acacia_hanging_sign.json", source: "{}" },
    { path: "pack/assets/minecraft/textures/block/stone.png", texture: "stone" },
    { path: "pack/assets/minecraft/textures/item/acacia_hanging_sign.png", texture: "sign" },
    { path: "pack/assets/minecraft/lang/en_us.json", source: "{}" }
  ]);

  assert.deepEqual([...index.models.keys()].sort(), [
    "/assets/minecraft/models/block/cube_all.json",
    "/assets/minecraft/models/item/acacia_hanging_sign.json"
  ]);
  assert.deepEqual([...index.textures.keys()].sort(), [
    "/assets/minecraft/textures/block/stone.png",
    "/assets/minecraft/textures/item/acacia_hanging_sign.png"
  ]);
});

test("builds parent model path candidates for namespaced, shorthand, and relative ids", () => {
  assert.deepEqual(modelReferenceCandidates("minecraft:block/cube_all"), [
    "/assets/minecraft/models/block/cube_all.json"
  ]);
  assert.ok(modelReferenceCandidates("block/cube_all").includes("/assets/minecraft/models/block/cube_all.json"));
  assert.ok(
    modelReferenceCandidates("cube_all", "/assets/minecraft/models/block/stone.json").includes(
      "/assets/minecraft/models/block/cube_all.json"
    )
  );
});

test("resolves parent models and inherits textures and elements", () => {
  const resourcePackIndex = createResourcePackIndex([
    {
      path: "assets/minecraft/models/block/cube_all.json",
      source: JSON.stringify({
        textures: { all: "minecraft:block/template_stone", particle: "#all" },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              north: { texture: "#all" },
              south: { texture: "#all" }
            }
          }
        ]
      })
    }
  ]);

  const parsed = parseMinecraftModel(
    JSON.stringify({
      parent: "minecraft:block/cube_all",
      textures: { all: "minecraft:block/stone" }
    }),
    "stone.json",
    { modelPath: "/assets/minecraft/models/block/stone.json", resourcePackIndex }
  );

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.parentChain, ["/assets/minecraft/models/block/cube_all.json"]);
  assert.equal(parsed.elements.length, 1);
  assert.deepEqual(parsed.textures, { all: "minecraft:block/stone", particle: "#all" });
  assert.deepEqual(parsed.textureReferences, ["minecraft:block/stone"]);
});

test("warns when a parent model cannot be resolved from folder context", () => {
  const parsed = parseMinecraftModel(
    JSON.stringify({
      parent: "minecraft:block/missing_template",
      textures: { all: "minecraft:block/stone" }
    }),
    "stone.json",
    {
      modelPath: "/assets/minecraft/models/block/stone.json",
      resourcePackIndex: createResourcePackIndex([])
    }
  );

  assert.equal(parsed.ok, false);
  assert.ok(parsed.warnings.some((warning) => warning.includes("Parent model could not be resolved")));
  assert.ok(parsed.errors.some((error) => error.includes("elements")));
});

test("reports parent model cycles as validation errors", () => {
  const resourcePackIndex = createResourcePackIndex([
    {
      path: "assets/minecraft/models/block/a.json",
      source: JSON.stringify({ parent: "minecraft:block/b", textures: { all: "block/stone" } })
    },
    {
      path: "assets/minecraft/models/block/b.json",
      source: JSON.stringify({ parent: "minecraft:block/a" })
    }
  ]);

  const parsed = parseMinecraftModel(
    JSON.stringify({ parent: "minecraft:block/b" }),
    "a.json",
    { modelPath: "/assets/minecraft/models/block/a.json", resourcePackIndex }
  );

  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((error) => error.includes("Parent model cycle detected")));
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

test("resolves namespaced texture candidates from loaded resource-pack folders", () => {
  const texture = "modded";
  const index = new Map([["/assets/example/textures/block/copper_panel.png", texture]]);

  assert.equal(resolveUploadedTexture("example:block/copper_panel", index), texture);
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
