/**
 * Pure helpers for the human-in-the-loop review feedback loop.
 *
 * The browser previewer renders a review panel (Accept / Request changes +
 * feedback textarea) once a model is loaded. These helpers build and
 * validate the structured JSON payload that panel exports, independent of
 * any DOM so they can be unit tested with Node's test runner.
 */

export const REVIEW_ACTIONS = Object.freeze({
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested"
});

/**
 * Validates a proposed review action + feedback text combination before a
 * payload is built. Returns `{ ok, errors }` so the UI can surface a clear
 * message instead of silently accepting an empty revision request.
 */
export function validateReviewInput({ action, feedback }) {
  const errors = [];
  const trimmedFeedback = typeof feedback === "string" ? feedback.trim() : "";

  if (action !== REVIEW_ACTIONS.APPROVED && action !== REVIEW_ACTIONS.CHANGES_REQUESTED) {
    errors.push(`action must be "${REVIEW_ACTIONS.APPROVED}" or "${REVIEW_ACTIONS.CHANGES_REQUESTED}".`);
  }

  if (action === REVIEW_ACTIONS.CHANGES_REQUESTED && trimmedFeedback.length === 0) {
    errors.push("Feedback text is required when requesting changes so the agent knows what to revise.");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Builds the structured, agent-consumable review payload. `summary` is the
 * deterministic `createPreviewSummary` result (or `null` when unavailable);
 * only a stable subset of it is embedded so the payload stays small and
 * predictable for an agent to parse.
 */
export function createReviewPayload({
  action,
  feedback = "",
  filename = null,
  modelPath = null,
  summary = null,
  timestamp = new Date().toISOString()
}) {
  const { ok, errors } = validateReviewInput({ action, feedback });
  if (!ok) {
    throw new Error(`Invalid review input: ${errors.join(" ")}`);
  }

  return {
    action,
    userFeedback: typeof feedback === "string" ? feedback.trim() : "",
    model: {
      filename: filename ?? null,
      modelPath: modelPath ?? null
    },
    validation: summarizeValidationForPayload(summary),
    timestamp
  };
}

/**
 * Reduces a full `createPreviewSummary` result down to the stable fields an
 * agent needs to correlate the human decision with the deterministic
 * validation outcome, without embedding the entire (larger) summary object.
 */
export function summarizeValidationForPayload(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    status: summary.status ?? null,
    decision: summary.decision ?? null,
    errors: Array.isArray(summary.errors) ? summary.errors : [],
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
    unresolvedTextureReferences: Array.isArray(summary.unresolvedTextureReferences)
      ? summary.unresolvedTextureReferences
      : []
  };
}

/**
 * Serializes a review payload for display/download/copy in the UI.
 */
export function serializeReviewPayload(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
