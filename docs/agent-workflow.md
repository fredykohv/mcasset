# Agent workflow with mcasset

This document defines the recommended agent loop for generated Minecraft model assets.

## Loop

1. Generate a model JSON asset.
2. Run the CLI or call the equivalent MCP tool:

```bash
npm run asset:preview -- <model.json> --out <output-dir>
```

Or, for MCP-capable agent clients (e.g. GitHub Copilot Desktop) with the mcasset MCP server registered (`npm run mcp`), call the `preview_minecraft_asset` tool with `modelPath`/`outDir` (and optional `assetsRoot`) instead of shelling out. See the README's "MCP server" section and `mcp/mcp.example.json` for setup.

3. Read `<output-dir>/summary.json` (CLI) or the tool result payload (MCP) — both share the same structured fields.
4. Use decision fields:
   - `status: fail` or `decision: revise_asset` -> revise the model and rerun.
   - `status: pass` or `status: pass_with_warnings` with `decision: request_user_approval` -> ask the user to approve.
5. In user-facing messages, attach or reference `<output-dir>/preview.html`.

## How to interpret `summary.json`

- `blockers`, `reasons`, and `suggestedNextSteps` are designed to be machine-actionable.
- `errors` and unresolved texture references are release blockers for agent handoff.
- `warnings` are non-blocking but must be surfaced to the user when requesting approval.

## What mcasset verifies today

- JSON parsing and model-root shape checks.
- `elements` array presence and per-element coordinate validation.
- Face normalization and UV shape checks.
- Texture reference collection and unresolved texture diagnostics.
- Browser-only assets/resource-pack folder context for resolving parent/template model JSON and PNG textures.
- Parent texture inheritance and parent `elements` inheritance when a child model has no own `elements`.
- Structured pass/fail decision output for agent routing.

## What mcasset does not verify automatically

- Subjective visual quality or artistic fit.
- Whether the asset matches user intent beyond deterministic diagnostics.
- Full Minecraft model system coverage (for example transforms, rotations, tinting, UV remapping, full block entity/special renderer fidelity, and full rendering-engine parity).

Use deterministic diagnostics to guide revisions, and keep human approval as the final gate for visual quality and intent alignment.

## Manual browser workflow

1. Load the Minecraft `assets` folder or a resource-pack folder first. Directory upload should include paths like `assets/minecraft/models/block/cube_all.json` and `assets/minecraft/textures/block/stone.png`.
2. Use the **Indexed models** search box to filter by path/filename, then click a result to preview it. Results are capped (200 by default) with a note showing total matches so large packs stay responsive.
3. Alternatively, use **Model JSON (manual upload)** to preview a single file without the folder picker.
4. The previewer resolves parent/template models and textures from the loaded folder when possible.
5. Upload additional PNG textures only when testing loose files or overrides.

Block entity and special renderer fidelity remains backlog; particle-only elementless models still render as warning placeholders. When a basename appears under both `models/item` and `models/block` (e.g. `acacia_hanging_sign`), pick the `item` result to preview the inventory/icon model; the `block` result is particle-only and only gets an approximate placeholder here.

## Copilot canvas extension (in-app preview)

`.github/extensions/mcasset-preview/extension.mjs` is a project-scoped Copilot CLI/Desktop extension that declares a `mcasset-preview` **canvas**. It is discovered automatically by Copilot CLI/Desktop when working in this repository (no install step) and lets an agent open an embedded, human-reviewable preview panel instead of only writing files to disk.

### How the agent uses it

1. Generate or revise the model JSON asset.
2. Open the canvas with `open_canvas`, `canvasId: "mcasset-preview"`, and an `input` of either:
   - `{ "modelPath": "<path to model.json>", "assetsRoot": "<optional resource-pack folder>", "outDir": "<optional dir to also write summary.json/preview.html>" }`, or
   - `{ "summaryPath": "<path to an already-generated summary.json>" }` to display a prior report verbatim without re-validating.
3. The panel renders the same deterministic diagnostics (`status`, `decision`, errors, warnings, unresolved textures, suggested next steps) as the CLI/MCP tools, computed by reusing `src/assetReport.js` / `src/modelCore.js` — no duplicated validation logic.
4. A human clicks **Accept asset** or **Request changes** (with required feedback text) in the panel. The agent can then call the `get_review` action (no input) to poll the latest diagnostics + review status, or `submit_review` (`{ "action": "approved" | "changes_requested", "feedback"?: string }`) to record/inspect a decision programmatically. Both return the same structured payload shape as the browser previewer's Human review panel (`src/reviewFeedback.js`), so an agent that already knows how to consume that payload needs no new parsing logic.
5. Review decisions persist per-asset (keyed by the resolved input paths, not the transient canvas `instanceId`) under the session workspace, so re-opening the same asset in a fresh panel still shows its prior review.

### Current limitations

- **Experimental surface.** Canvas extensions are an experimental part of the Copilot SDK/CLI wire protocol and may change between CLI releases.
- **CLI/Desktop only.** This is not part of the Vite website; it only renders inside a Copilot host that supports canvases (`canvas-renderer` capability). Hosts without that capability simply won't show the canvas in their catalog.
- **No 3D rendering.** The canvas shows structured diagnostics and the review form, not the browser previewer's Three.js model viewer — attach/link the website or `preview.html` alongside it for a visual check.
- **Explicit paths only.** Like the MCP tools, it never scans directories on its own; it only reads the exact `modelPath` / `assetsRoot` / `summaryPath` / `outDir` paths supplied in `input`.
- **Loopback-only server.** Each open instance starts its own `127.0.0.1` HTTP server on an OS-assigned ephemeral port; it is not reachable outside the local machine.
