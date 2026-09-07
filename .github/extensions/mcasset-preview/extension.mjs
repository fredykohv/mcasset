// Extension: mcasset-preview
//
// Project-scoped canvas that lets an agent open an embedded preview of a
// Minecraft asset (model JSON) inside the app, showing the same
// deterministic diagnostics as `npm run asset:preview` / the MCP tools, an
// actual 3D preview of the parsed model (cuboid elements or generated-item
// sprites), and letting a human Accept the asset or Request changes with
// feedback text. The review decision is returned to the agent as the same
// structured JSON payload the browser previewer's "Human review" panel
// produces (`src/reviewFeedback.js`), so both surfaces stay consistent.
//
// This extension does not change the existing website or MCP server; it
// only reuses their pure validation/report and rendering logic
// (`src/assetReport.js`, `src/modelCore.js`, `src/modelRenderer.js`,
// `src/generatedItemExtrusion.js`, `src/reviewFeedback.js`) from a new,
// additive surface. `src/modelRenderer.js` (the Three.js scene builder) is
// served unmodified to the canvas iframe as a static ES module
// (`vendorAssets.mjs`) rather than duplicated -- this Node process itself
// never imports three.js.
//
// See docs/agent-workflow.md for the full workflow and current limitations.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { renderPage } from "./render.mjs";
import {
  buildStatePayload,
  computeDiagnostics,
  domainKeyFor,
  loadReviewRecord,
  resolveTextureFilePath
} from "./state.mjs";
import { isVendorRoute, serveVendorAsset } from "./vendorAssets.mjs";
import { createReviewDelivery, ReviewInputError } from "./reviewDelivery.mjs";
import { readReviewRequest } from "./reviewHttp.mjs";


// Canvas open input: either `modelPath` (validated live, optionally writing
// report artifacts to `outDir`) or `summaryPath` (an already-generated
// summary.json read verbatim) must be supplied. `assetsRoot` is only used
// for parent-model/texture resolution when `modelPath` is given.
const OPEN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    modelPath: {
      type: "string",
      description: "Path to a Minecraft Java Edition model JSON file to validate and preview. Required unless summaryPath is supplied."
    },
    assetsRoot: {
      type: "string",
      description: "Optional path to an assets/resource-pack folder used to resolve parent models and textures for modelPath."
    },
    summaryPath: {
      type: "string",
      description: "Path to an existing summary.json (from npm run asset:preview or an MCP tool call) to display verbatim instead of re-validating modelPath."
    },
    outDir: {
      type: "string",
      description: "Optional directory to write summary.json/preview.html artifacts into (only used together with modelPath), mirroring npm run asset:preview."
    }
  },
  anyOf: [{ required: ["modelPath"] }, { required: ["summaryPath"] }],
  additionalProperties: false
};

const SUBMIT_REVIEW_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["approved", "changes_requested"],
      description: "The human review decision to record for the asset currently shown in this canvas instance."
    },
    feedback: {
      type: "string",
      description: "Feedback text for the agent. Required (non-empty) when action is \"changes_requested\"; optional for \"approved\"."
    }
  },
  required: ["action"],
  additionalProperties: false
};

// instanceId -> { server, url, input, workingDirectory, domainKey }
const instances = new Map();

function instanceOrThrow(instanceId) {
  const entry = instances.get(instanceId);
  if (!entry) {
    throw new CanvasError("instance_not_found", `No open mcasset-preview canvas instance for instanceId "${instanceId}". Open the canvas first.`);
  }
  return entry;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

/** Builds the current `/api/state` payload for an instance, on demand. */
async function currentState(entry) {
  const diagnostics = await computeDiagnostics(entry.input, entry.workingDirectory);
  // Cached so the burst of /api/texture requests the iframe makes right
  // after fetching /api/state can reuse the same resourcePackIndex instead
  // of re-walking assetsRoot once per texture.
  entry.lastDiagnostics = diagnostics;
  const record = await loadReviewRecord(session.workspacePath, entry.domainKey);
  return buildStatePayload({
    instanceId: entry.instanceId,
    domainKey: entry.domainKey,
    input: entry.input,
    diagnostics,
    review: record?.review,
    notification: record?.notification
  });
}

/**
 * Serves texture bytes for the canvas iframe's 3D viewer. `normalizedPath`
 * must be a key already present in the current instance's
 * `resourcePackIndex.textures` (built once from the caller's explicit
 * `assetsRoot`); this never reads a caller-supplied filesystem path
 * directly, only files this extension already enumerated while indexing
 * that assetsRoot.
 */
async function serveTexture(entry, normalizedPath, res) {
  const diagnostics = entry.lastDiagnostics ?? (await computeDiagnostics(entry.input, entry.workingDirectory));
  const fullPath = resolveTextureFilePath(diagnostics.resourcePackIndex, normalizedPath);
  if (!fullPath) {
    sendJson(res, 404, { error: `No indexed texture file for "${normalizedPath}".` });
    return;
  }

  try {
    const bytes = await readFile(fullPath);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length });
    res.end(bytes);
  } catch (error) {
    sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function startServer(instanceId) {
  const server = createServer((req, res) => {
    handleRequest(instanceId, req, res).catch((error) => {
      sendJson(res, error.statusCode ?? 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  // Port 0 = let the OS pick a free ephemeral port. Bind to loopback only —
  // the host only ever embeds loopback URLs.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function handleRequest(instanceId, req, res) {
  const entry = instances.get(instanceId);
  if (!entry) {
    sendJson(res, 404, { error: "Canvas instance is no longer open." });
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/") {
    const html = renderPage({ instanceId });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && isVendorRoute(url.pathname)) {
    const asset = await serveVendorAsset(url.pathname);
    res.writeHead(200, { "Content-Type": asset.contentType });
    res.end(asset.body);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, await currentState(entry));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/texture") {
    const texturePath = url.searchParams.get("path");
    if (!texturePath) {
      sendJson(res, 400, { error: "Query parameter \"path\" is required." });
      return;
    }
    await serveTexture(entry, texturePath, res);
    return;
  }

  if (req.method === "POST" && ["/api/review", "/api/review/notify"].includes(url.pathname)) {
    const body = await readReviewRequest(req, entry.url);
    const diagnostics = await computeDiagnostics(entry.input, entry.workingDirectory);
    const record = url.pathname === "/api/review/notify"
      ? await delivery.retry({ domainKey: entry.domainKey, notificationId: body.notificationId })
      : await delivery.submit({
        domainKey: entry.domainKey,
        input: entry.input,
        action: body.action,
        feedback: body.feedback ?? "",
        diagnostics,
        notificationId: body.notificationId,
        notifyAgent: true
      });
    const failed = record.notification?.status === "failed";
    sendJson(res, failed ? 502 : 200, {
      ...buildStatePayload({
        instanceId: entry.instanceId, domainKey: entry.domainKey, input: entry.input,
        diagnostics, review: record.review, notification: record.notification
      }),
      ...(failed ? { error: `Review saved, but the agent was not notified: ${record.notification.error}` } : {})
    });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

async function openInstance(ctx) {
  const input = ctx.input && typeof ctx.input === "object" ? ctx.input : {};
  const workingDirectory = ctx.session?.workingDirectory;
  const domainKey = domainKeyFor(input, workingDirectory);

  let entry = instances.get(ctx.instanceId);
  if (!entry) {
    const serverEntry = await startServer(ctx.instanceId);
    entry = { instanceId: ctx.instanceId, ...serverEntry };
    instances.set(ctx.instanceId, entry);
  }
  // Re-opens (focus, or a rehydrate after extensions_reload) may carry a
  // fresher input/workingDirectory than the entry we already have; refresh
  // them so /api/state and canvas actions reflect the latest open() call.
  entry.input = input;
  entry.workingDirectory = workingDirectory;
  entry.domainKey = domainKey;

  const label = input.modelPath || input.summaryPath;
  await session.log(`mcasset-preview: opened instance "${ctx.instanceId}"${label ? ` for ${label}` : ""}.`, { ephemeral: true });

  return {
    title: label ? `Asset preview: ${label}` : "Minecraft asset preview",
    url: entry.url
  };
}

async function closeInstance(ctx) {
  const entry = instances.get(ctx.instanceId);
  if (entry) {
    instances.delete(ctx.instanceId);
    await new Promise((resolve) => entry.server.close(() => resolve()));
  }
}

async function getReviewAction(ctx) {
  const entry = instanceOrThrow(ctx.instanceId);
  return currentState(entry);
}

async function submitReviewAction(ctx) {
  const entry = instanceOrThrow(ctx.instanceId);
  const input = ctx.input && typeof ctx.input === "object" ? ctx.input : {};
  const diagnostics = await computeDiagnostics(entry.input, entry.workingDirectory);

  try {
    // Agent-originated writes stay pull-only to avoid self-triggering turns.
    const record = await delivery.submit({
      input: entry.input,
      domainKey: entry.domainKey,
      action: input.action,
      feedback: input.feedback ?? "",
      diagnostics
    });
    return buildStatePayload({
      instanceId: entry.instanceId,
      domainKey: entry.domainKey,
      input: entry.input,
      diagnostics,
      review: record.review,
      notification: record.notification
    });
  } catch (error) {
    throw new CanvasError(
      error instanceof ReviewInputError ? "invalid_review_input" : "review_save_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

const session = await joinSession({
  canvases: [
    createCanvas({
      id: "mcasset-preview",
      displayName: "Minecraft asset preview",
      description:
        "Preview diagnostics for a generated Minecraft model JSON file and collect a human Accept/Request-changes review with feedback text.",
      inputSchema: OPEN_INPUT_SCHEMA,
      actions: [
        {
          name: "get_review",
          description:
            "Fetch the current diagnostics and human review status (if any) for an open mcasset-preview canvas instance.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          handler: getReviewAction
        },
        {
          name: "submit_review",
          description:
            "Record an explicitly supplied review decision and return it. This agent action does not send a notification; the preview UI buttons notify the owning session automatically.",
          inputSchema: SUBMIT_REVIEW_INPUT_SCHEMA,
          handler: submitReviewAction
        }
      ],
      open: openInstance,
      onClose: closeInstance
    })
  ]
});

const delivery = createReviewDelivery({
  workspacePath: session.workspacePath,
  sendMessage: (message) => session.send(message)
});
