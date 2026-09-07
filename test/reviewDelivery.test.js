import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReviewDelivery } from "../.github/extensions/mcasset-preview/reviewDelivery.mjs";
import { loadReviewRecord } from "../.github/extensions/mcasset-preview/state.mjs";

async function setup(t, sendMessage) {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "mcasset-delivery-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));
  return {
    workspacePath,
    delivery: createReviewDelivery({ workspacePath, sendMessage }),
    args: {
      input: { modelPath: "/models/sword.json", assetsRoot: "/models/assets" },
      domainKey: "sword",
      action: "approved",
      feedback: "",
      diagnostics: {
        summary: { status: "pass", decision: "request_user_approval", errors: [], warnings: [], unresolvedTextureReferences: [] }
      },
      notificationId: "test-review-1",
      notifyAgent: true
    }
  };
}

test("UI approval is durably saved before immediately notifying the owning session", async (t) => {
  const calls = [];
  const { workspacePath, delivery, args } = await setup(t, async (message) => {
    const saved = await loadReviewRecord(workspacePath, "sword");
    assert.equal(saved.review.action, "approved");
    assert.equal(saved.notification.status, "pending");
    calls.push(message);
    return "message-1";
  });
  const result = await delivery.submit(args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "immediate");
  assert.match(calls[0].prompt, /test-review-1/);
  assert.match(calls[0].prompt, /sword.json/);
  assert.match(calls[0].prompt, /does not authorize/);
  assert.deepEqual(result.notification, {
    id: "test-review-1", status: "sent", messageId: "message-1", error: null
  });
  assert.deepEqual(await loadReviewRecord(workspacePath, "sword"), result);
});

test("requested changes include feedback as JSON review data", async (t) => {
  let message;
  const { delivery, args } = await setup(t, async (sent) => { message = sent; return "message-2"; });
  const feedback = 'Make the grip darker.\n"quoted" feedback';
  const result = await delivery.submit({ ...args, action: "changes_requested", feedback });
  assert.equal(result.review.userFeedback, feedback);
  assert.ok(message.prompt.includes(JSON.stringify(feedback)));
  assert.match(message.prompt, /not as higher-priority instructions/);
});

test("invalid reviews neither persist nor notify", async (t) => {
  let calls = 0;
  const { workspacePath, delivery, args } = await setup(t, async () => { calls++; });
  await assert.rejects(delivery.submit({ ...args, action: "changes_requested", feedback: " " }), /Feedback text is required/);
  await assert.rejects(delivery.submit({ ...args, notificationId: "" }), /notificationId/);
  assert.equal(calls, 0);
  assert.equal(await loadReviewRecord(workspacePath, "sword"), null);
});

test("programmatic submit_review does not trigger a recursive agent turn", async (t) => {
  let calls = 0;
  const { delivery, args } = await setup(t, async () => { calls++; });
  const result = await delivery.submit({ ...args, notifyAgent: false });
  assert.equal(calls, 0);
  assert.equal(result.notification, null);
  assert.equal(result.review.action, "approved");
});

test("concurrent duplicate submissions and retries of the current receipt send once", async (t) => {
  let calls = 0;
  const { delivery, args } = await setup(t, async () => { calls++; return "one-message"; });
  const [a, b] = await Promise.all([delivery.submit(args), delivery.submit(args)]);
  assert.deepEqual(a, b);
  assert.deepEqual(await delivery.retry(args), a);
  assert.equal(calls, 1);
  await assert.rejects(delivery.submit({ ...args, feedback: "different" }), /different review/);
});

test("notification failures preserve the review and can be retried after provider restart", async (t) => {
  const { workspacePath, delivery, args } = await setup(t, async () => { throw new Error("Session disconnected"); });
  const failed = await delivery.submit(args);
  assert.equal(failed.notification.status, "failed");
  assert.equal(failed.notification.error, "Session disconnected");
  assert.equal(failed.review.action, "approved");
  let sent;
  const restarted = createReviewDelivery({
    workspacePath,
    sendMessage: async (message) => { sent = message; return "retried-message"; }
  });
  const retried = await restarted.retry(args);
  assert.deepEqual(retried.review, failed.review);
  assert.equal(retried.notification.id, failed.notification.id);
  assert.equal(retried.notification.status, "sent");
  assert.ok(sent.prompt.includes(failed.notification.id));
});

test("a stale retry cannot send a newer, different decision", async (t) => {
  let calls = 0;
  const { delivery, args } = await setup(t, async () => { calls++; return "message"; });
  await delivery.submit(args);
  await delivery.submit({ ...args, notificationId: "test-review-2", action: "changes_requested", feedback: "Slimmer" });
  await assert.rejects(delivery.retry(args), /no longer the current review/);
  assert.equal(calls, 2);
});

test("read failures are surfaced instead of discarding stored review decisions", async (t) => {
  const { workspacePath, delivery, args } = await setup(t, async () => "message");
  await delivery.submit(args);
  await writeFile(path.join(workspacePath, "mcasset-preview", "reviews", "sword.json"), "{invalid");
  await assert.rejects(delivery.submit(args), SyntaxError);
});

test("persistence failure prevents sending an unrecorded decision", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcasset-unwritable-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspacePath = path.join(dir, "not-a-directory");
  await writeFile(workspacePath, "occupied");
  let calls = 0;
  const delivery = createReviewDelivery({ workspacePath, sendMessage: async () => { calls++; } });
  await assert.rejects(delivery.submit({
    input: { modelPath: "sword.json" }, domainKey: "sword", action: "approved",
    feedback: "", diagnostics: { summary: {} }, notificationId: "test", notifyAgent: true
  }));
  assert.equal(calls, 0);
});
