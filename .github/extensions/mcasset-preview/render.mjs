// Self-contained HTML/CSS/JS for the mcasset-preview canvas iframe.
//
// Diagnostics and the Human review panel are dependency-free: no bundler, no
// CDN scripts, no framework. The 3D preview is the one exception -- it loads
// three.js and this repo's own src/modelRenderer.js as plain ES modules,
// served locally by this extension's own loopback server (never a CDN or a
// bundler run at extension runtime) and wired together via an
// <script type="importmap">. The page fetches its own state from the
// loopback server (`/api/state`) and posts review decisions back to it
// (`/api/review`); it never talks to the CLI/runtime directly. Styling
// follows the app's canvas theme-token contract (semantic CSS variables with
// plain fallbacks) documented by the create-canvas skill.

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJsString(value) {
  return JSON.stringify(String(value));
}

/**
 * Renders the single HTML document served for every open canvas instance.
 * All dynamic content is loaded client-side via fetch(); `instanceId` is the
 * only value baked into the page itself (used to label API requests and to
 * show the user which panel they are looking at).
 */
export function renderPage({ instanceId }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mcasset preview</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 20px;
        background: var(--background-color-default, #0b1118);
        color: var(--text-color-default, #e5eef7);
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--text-body-medium, 14px);
        line-height: var(--leading-body-medium, 20px);
      }
      main { max-width: 760px; margin: 0 auto; }
      h1 {
        font-family: var(--font-sans-display, var(--font-sans, sans-serif));
        font-size: var(--text-title-large, 20px);
        font-weight: var(--font-weight-semibold, 600);
        margin: 0 0 4px;
      }
      .subtitle { color: var(--text-color-muted, #8aa0b2); margin: 0 0 16px; word-break: break-all; }
      .card {
        background: var(--background-color-default, #111a26);
        border: 1px solid var(--border-color-default, #243244);
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 16px;
      }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 8px 10px; border-bottom: 1px solid var(--border-color-default, #243244); text-align: left; vertical-align: top; }
      th { width: 200px; color: var(--text-color-muted, #8aa0b2); font-weight: 500; }
      .status-pass { color: #3fb950; }
      .status-pass_with_warnings { color: #d29922; }
      .status-fail { color: #f85149; }
      ul, ol { margin: 6px 0 0; padding-left: 20px; }
      textarea {
        width: 100%;
        min-height: 72px;
        background: var(--background-color-default, #0b1118);
        color: var(--text-color-default, #e5eef7);
        border: 1px solid var(--border-color-default, #243244);
        border-radius: 8px;
        padding: 8px;
        font-family: inherit;
        font-size: inherit;
        resize: vertical;
      }
      .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      button {
        border: 1px solid var(--border-color-default, #243244);
        background: var(--background-color-default, #1a2531);
        color: var(--text-color-default, #e5eef7);
        border-radius: 8px;
        padding: 8px 14px;
        font-size: inherit;
        cursor: pointer;
      }
      button.primary { background: #2f6f4f; border-color: #2f6f4f; color: #fff; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      button:hover:not(:disabled) { filter: brightness(1.1); }
      .error-banner {
        background: rgba(248, 81, 73, 0.12);
        border: 1px solid #f85149;
        color: #f85149;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 16px;
      }
      .review-summary { font-size: var(--text-body-medium, 14px); }
      .review-summary pre {
        background: var(--background-color-default, #0b1118);
        border: 1px solid var(--border-color-default, #243244);
        border-radius: 8px;
        padding: 10px;
        overflow: auto;
        max-height: 220px;
      }
      .muted { color: var(--text-color-muted, #8aa0b2); }
      .pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border-color-default, #243244);
        font-size: 12px;
      }
      .viewer-wrap {
        width: 100%;
        height: 360px;
        border: 1px solid var(--border-color-default, #243244);
        border-radius: 8px;
        overflow: hidden;
        background: #101820;
      }
      #viewer-canvas { width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <main>
      <h1>Minecraft asset preview</h1>
      <p class="subtitle" id="subtitle">Loading diagnostics&hellip;</p>

      <div id="error-banner" class="error-banner" style="display:none;"></div>

      <section class="card" id="viewer-card">
        <h2 style="margin-top:0;">3D preview</h2>
        <div class="viewer-wrap">
          <canvas id="viewer-canvas"></canvas>
        </div>
        <div class="actions">
          <button type="button" data-view="three-quarter">Three-quarter</button>
          <button type="button" data-view="front">Front</button>
          <button type="button" data-view="side">Side</button>
          <button type="button" data-view="back">Back</button>
        </div>
        <p class="muted" id="viewer-status">Loading 3D preview&hellip;</p>
      </section>

      <section class="card" id="diagnostics-card">
        <p class="muted">Fetching diagnostics&hellip;</p>
      </section>

      <section class="card" id="review-card">
        <h2 style="margin-top:0;">Human review</h2>
        <p class="muted">Submitting a decision notifies the Copilot session that opened this preview. An idle agent resumes; no commit, merge, or installation is authorized.</p>
        <p class="muted" id="review-status">No review recorded yet.</p>
        <p class="muted" id="notification-status" role="status"></p>
        <textarea id="feedback" placeholder="Feedback for the agent (required when requesting changes)"></textarea>
        <div class="actions">
          <button class="primary" id="approve-btn" type="button">Accept current preview</button>
          <button id="changes-btn" type="button">Request changes</button>
          <button id="refresh-btn" type="button">Refresh diagnostics</button>
          <button id="retry-notification-btn" type="button" hidden>Retry agent notification</button>
        </div>
        <div id="review-result" class="review-summary" style="margin-top:14px;"></div>
      </section>
    </main>

    <script type="importmap">
      {
        "imports": {
          "three": "/vendor/three.module.js",
          "three/examples/jsm/controls/OrbitControls.js": "/vendor/OrbitControls.js"
        }
      }
    </script>
    <script type="module">
      import { initViewer, renderModel } from "/app.js";

      const instanceId = ${escapeJsString(instanceId)};
      const viewer = initViewer(document.getElementById("viewer-canvas"));
      let submission = null;
      let notificationId = null;
      let submitting = false;

      document.querySelectorAll("[data-view]").forEach((button) => {
        button.addEventListener("click", () => viewer.frameGroup(undefined, { view: button.dataset.view }));
      });

      function setViewerStatus(message) {
        document.getElementById("viewer-status").textContent = message;
      }

      function statusClass(status) {
        return status ? "status-" + status : "";
      }

      function renderList(items) {
        if (!items || items.length === 0) return '<p class="muted">None</p>';
        return "<ul>" + items.map((i) => "<li>" + escapeHtml(String(i)) + "</li>").join("") + "</ul>";
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function renderDiagnostics(state) {
        const banner = document.getElementById("error-banner");
        const subtitle = document.getElementById("subtitle");
        const card = document.getElementById("diagnostics-card");

        const label = state.input.modelPath || state.input.summaryPath || "(no path supplied)";
        subtitle.textContent = state.equipment
          ? "Equipment scene (primary: main hand): " + label
          : "Asset-only preview: " + label;

        if (state.diagnosticsError) {
          banner.style.display = "block";
          banner.textContent = "Could not load diagnostics: " + state.diagnosticsError;
        } else {
          banner.style.display = "none";
          banner.textContent = "";
        }

        const summary = state.summary;
        if (!summary) {
          card.innerHTML = '<p class="muted">No diagnostics available yet.</p>';
          return;
        }

        card.innerHTML =
          '<table><tbody>' +
          '<tr><th>Status</th><td><span class="' + statusClass(summary.status) + '">' + escapeHtml(summary.status ?? "unknown") + '</span></td></tr>' +
          '<tr><th>Decision</th><td>' + escapeHtml(summary.decision ?? "unknown") + '</td></tr>' +
          '<tr><th>File</th><td>' + escapeHtml(summary.filename ?? "") + '</td></tr>' +
          '<tr><th>Preview mode</th><td>' + escapeHtml(summary.modelKind ?? "") + '</td></tr>' +
          '<tr><th>Elements</th><td>' + escapeHtml(summary.elementCount ?? 0) + '</td></tr>' +
          '<tr><th>Textures</th><td>' + escapeHtml(summary.textureCount ?? 0) + '</td></tr>' +
          '<tr><th>Unresolved textures</th><td>' + renderList(summary.unresolvedTextureReferences) + '</td></tr>' +
          '<tr><th>Errors</th><td>' + renderList(summary.errors) + '</td></tr>' +
          '<tr><th>Warnings</th><td>' + renderList(summary.warnings) + '</td></tr>' +
          (state.equipment
            ? '<tr><th>Equipment scene errors</th><td>' + renderList(state.equipment.errors) + '</td></tr>' +
              '<tr><th>Offhand</th><td>' + escapeHtml(state.input.offhandModelPath || "Empty") + '</td></tr>' +
              '<tr><th>Offhand status</th><td>' + escapeHtml(state.equipment.offhand?.summary?.status || "Not loaded") + '</td></tr>' +
              '<tr><th>Offhand errors</th><td>' + renderList(state.equipment.offhand?.summary?.errors) + '</td></tr>' +
              '<tr><th>Offhand warnings</th><td>' + renderList(state.equipment.offhand?.summary?.warnings) + '</td></tr>' +
              '<tr><th>Offhand unresolved textures</th><td>' + renderList(state.equipment.offhand?.summary?.unresolvedTextureReferences) + '</td></tr>' +
              '<tr><th>Skin</th><td>' + escapeHtml(state.input.skinPath || "Neutral mannequin") + '</td></tr>'
            : '') +
          '<tr><th>Suggested next steps</th><td>' + renderList(summary.suggestedNextSteps) + '</td></tr>' +
          '</tbody></table>';
      }

      function renderReview(state) {
        const statusEl = document.getElementById("review-status");
        const resultEl = document.getElementById("review-result");
        const review = state.review;
        const notification = state.notification;
        notificationId = notification?.id ?? null;
        const retryBtn = document.getElementById("retry-notification-btn");
        retryBtn.hidden = !notification || notification.status === "sent";
        document.getElementById("notification-status").textContent =
          notification?.status === "sent" ? "Agent notified. Its response appears in the owning Copilot session." :
          notification?.status === "failed" ? "Review saved, but the agent was not notified: " + notification.error :
          notification?.status === "pending" ? "Review saved; delivery is unconfirmed. Retry agent notification." :
          review ? "This review has no automatic notification record." : "";

        if (!review) {
          statusEl.innerHTML = '<span class="pill">No review recorded yet</span>';
          resultEl.innerHTML = "";
          return;
        }

        statusEl.innerHTML =
          '<span class="pill">' + escapeHtml(review.action) + '</span> recorded at ' +
          escapeHtml(review.timestamp);
        resultEl.innerHTML =
          '<pre>' + escapeHtml(JSON.stringify(review, null, 2)) + '</pre>' +
          '<div class="actions">' +
          '<button type="button" id="copy-btn">Copy JSON</button>' +
          '<button type="button" id="download-btn">Download JSON</button>' +
          '</div>';

        const copyBtn = document.getElementById("copy-btn");
        if (copyBtn) {
          copyBtn.addEventListener("click", () => {
            navigator.clipboard?.writeText(JSON.stringify(review, null, 2)).catch(() => {});
          });
        }
        const downloadBtn = document.getElementById("download-btn");
        if (downloadBtn) {
          downloadBtn.addEventListener("click", () => {
            const blob = new Blob([JSON.stringify(review, null, 2) + "\\n"], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "mcasset-review.json";
            a.click();
            URL.revokeObjectURL(url);
          });
        }
      }

      async function loadState() {
        const res = await fetch("/api/state");
        if (!res.ok) throw new Error("Could not load preview state (HTTP " + res.status + ").");
        const state = await res.json();
        submission = null;
        renderDiagnostics(state);
        renderReview(state);
        await renderModel(viewer, state, setViewerStatus).catch((error) => {
          setViewerStatus("3D preview failed: " + error.message);
        });
        return state;
      }

      async function submitReview(action) {
        const feedback = document.getElementById("feedback").value;
        const key = JSON.stringify({ action, feedback });
        if (!submission || submission.key !== key) {
          submission = { key, notificationId: crypto.randomUUID() };
        }
        await postReview("/api/review", { action, feedback, notificationId: submission.notificationId });
      }

      async function postReview(url, payload) {
        if (submitting) return;
        submitting = true;
        const buttons = ["approve-btn", "changes-btn", "retry-notification-btn", "refresh-btn"].map(id => document.getElementById(id));
        buttons.forEach(button => button.disabled = true);
        const banner = document.getElementById("error-banner");
        banner.style.display = "none";
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const body = await res.json();
          if (body.review) {
            renderDiagnostics(body);
            renderReview(body);
          }
          if (!res.ok) {
            throw new Error(body.error || "Could not confirm review delivery.");
          }
        } catch (error) {
          banner.style.display = "block";
          banner.textContent = error.message + " You can retry the submission; its notification ID is reused.";
        } finally {
          submitting = false;
          buttons.forEach(button => button.disabled = false);
        }
      }

      document.getElementById("approve-btn").addEventListener("click", () => submitReview("approved"));
      document.getElementById("changes-btn").addEventListener("click", () => submitReview("changes_requested"));
      document.getElementById("retry-notification-btn").addEventListener("click", () =>
        postReview("/api/review/notify", { notificationId }));
      document.getElementById("refresh-btn").addEventListener("click", () => loadState().catch(showLoadError));

      function showLoadError(error) {
        const banner = document.getElementById("error-banner");
        banner.style.display = "block";
        banner.textContent = "Failed to load state: " + error.message;
      }
      loadState().catch(showLoadError);
    </script>
  </body>
</html>`;
}

export { escapeHtml };
