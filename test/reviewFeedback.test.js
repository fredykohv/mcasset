import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_ACTIONS,
  createReviewPayload,
  serializeReviewPayload,
  summarizeValidationForPayload,
  validateReviewInput
} from "../src/reviewFeedback.js";

test("validateReviewInput rejects unknown actions", () => {
  const result = validateReviewInput({ action: "maybe", feedback: "" });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /action must be/);
});

test("validateReviewInput allows approval without feedback text", () => {
  const result = validateReviewInput({ action: REVIEW_ACTIONS.APPROVED, feedback: "" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateReviewInput requires non-empty feedback for changes_requested", () => {
  const empty = validateReviewInput({ action: REVIEW_ACTIONS.CHANGES_REQUESTED, feedback: "   " });
  assert.equal(empty.ok, false);
  assert.match(empty.errors[0], /Feedback text is required/);

  const filled = validateReviewInput({ action: REVIEW_ACTIONS.CHANGES_REQUESTED, feedback: "Make it bigger" });
  assert.equal(filled.ok, true);
});

test("createReviewPayload throws for invalid input instead of silently succeeding", () => {
  assert.throws(
    () => createReviewPayload({ action: REVIEW_ACTIONS.CHANGES_REQUESTED, feedback: "" }),
    /Invalid review input/
  );
});

test("createReviewPayload builds a structured approval payload", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";
  const payload = createReviewPayload({
    action: REVIEW_ACTIONS.APPROVED,
    feedback: "  Looks great  ",
    filename: "oak_table.json",
    modelPath: "minecraft/models/item/oak_table.json",
    summary: {
      status: "pass",
      decision: "request_user_approval",
      errors: [],
      warnings: ["some warning"],
      unresolvedTextureReferences: []
    },
    timestamp
  });

  assert.deepEqual(payload, {
    action: "approved",
    userFeedback: "Looks great",
    model: {
      filename: "oak_table.json",
      modelPath: "minecraft/models/item/oak_table.json"
    },
    context: { mode: "asset" },
    validation: {
      status: "pass",
      decision: "request_user_approval",
      errors: [],
      warnings: ["some warning"],
      unresolvedTextureReferences: []
    },
    timestamp
  });
});

test("createReviewPayload identifies an equipment scene separately from asset-only review", () => {
  const context = {
    mode: "equipment",
    primaryAsset: "main_hand",
    mainHand: { modelPath: "sword.json" },
    offhand: { modelPath: "shield.json" },
    skin: { filename: "local-skin.png" }
  };
  const payload = createReviewPayload({
    action: REVIEW_ACTIONS.APPROVED,
    filename: "sword.json",
    modelPath: "sword.json",
    context
  });
  assert.deepEqual(payload.context, context);
});

test("createReviewPayload builds a structured changes_requested payload", () => {
  const payload = createReviewPayload({
    action: REVIEW_ACTIONS.CHANGES_REQUESTED,
    feedback: "Texture is upside down",
    filename: "oak_table.json",
    modelPath: null,
    summary: null,
    timestamp: "2024-01-01T00:00:00.000Z"
  });

  assert.equal(payload.action, "changes_requested");
  assert.equal(payload.userFeedback, "Texture is upside down");
  assert.equal(payload.model.modelPath, null);
  assert.equal(payload.validation, null);
});

test("createReviewPayload defaults timestamp to an ISO string when omitted", () => {
  const payload = createReviewPayload({ action: REVIEW_ACTIONS.APPROVED, feedback: "" });
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("summarizeValidationForPayload returns null for missing summary", () => {
  assert.equal(summarizeValidationForPayload(null), null);
  assert.equal(summarizeValidationForPayload(undefined), null);
});

test("summarizeValidationForPayload defaults array fields defensively", () => {
  const result = summarizeValidationForPayload({ status: "fail", decision: "revise_asset" });
  assert.deepEqual(result, {
    status: "fail",
    decision: "revise_asset",
    errors: [],
    warnings: [],
    unresolvedTextureReferences: []
  });
});

test("serializeReviewPayload produces pretty JSON ending in a newline", () => {
  const payload = createReviewPayload({
    action: REVIEW_ACTIONS.APPROVED,
    feedback: "",
    timestamp: "2024-01-01T00:00:00.000Z"
  });
  const serialized = serializeReviewPayload(payload);
  assert.ok(serialized.endsWith("\n"));
  assert.deepEqual(JSON.parse(serialized), payload);
});
