# Agent workflow with mcasset

This document defines the recommended agent loop for generated Minecraft model assets.

## Loop

1. Generate a model JSON asset and its textures. For vanilla-style weapons, use the pixel-art item recipe below.
2. Run the CLI or call the equivalent MCP tool:

```bash
npm run asset:preview -- <model.json> --out <output-dir>
```

Or, for MCP-capable agent clients (e.g. GitHub Copilot Desktop) with the mcasset MCP server registered (`npm run mcp`), call the `preview_minecraft_asset` tool with `modelPath`/`outDir` (and optional `assetsRoot`) instead of shelling out. See the README's "MCP server" section and `mcp/mcp.example.json` for setup.

3. Read `<output-dir>/summary.json` (CLI) or the tool result payload (MCP) — both share the same structured fields.
4. Use decision fields:
   - `status: fail` or `decision: revise_asset` -> revise the model and rerun.
   - `status: pass` or `status: pass_with_warnings` with `decision: request_user_approval` -> proceed to visual review.
5. Open the actual 3D view. In a canvas-capable Copilot host, pass the MCP response's `canvasPreview.canvasId` and `canvasPreview.input` to `open_canvas` with a new `instanceId`. Otherwise load the model and textures in the website.
6. Inspect the visible front, back, thickness, silhouette and material colors; then let the human accept or request changes. A successful HTTP request is not evidence of successful rendering. `preview.html` is only a diagnostic report, and `summaryPath` alone cannot render a model.

## Pixel-art item authoring

Use a transparent pixel-art texture and thin generated-item extrusion for a vanilla-style sword, rather than a stack of thick blocks. Start with `examples/amethyst-sword/`: it contains an original 16x16 RGBA sword atlas and a model with `minecraft:builtin/generated` as its engine parent. No Minecraft installation is needed to preview it.

1. Define the silhouette and material regions first: long pointed crystal blade, compact bronze guard, short dark wrapped grip, and a small pommel.
2. Paint those regions with distinct palette ramps. One texture atlas can contain several materials; the number of PNG files is not a measure of material variety. Keep unused pixels transparent.
3. Point `textures.layer0` at the atlas and omit cuboid `elements`. The preview extrudes the opaque silhouette to one model unit, with side walls sampled from the opaque edge pixels.
4. Run structural diagnostics, then inspect the live view from front, side and back. Visual acceptance belongs to the human, even when all diagnostics pass.

Rebuild the reference PNG from its editable pixel grid and palette using `npm run example:sword`. The source is `scripts/generate-amethyst-sword.mjs`; the committed PNG is ready to use without regeneration.

```bash
npm run asset:preview -- examples/amethyst-sword/assets/mcasset/models/item/amethyst_sword.json --assets examples/amethyst-sword --out preview-output/amethyst-sword
```

For the in-app view, open `mcasset-preview` with paths resolved relative to the repository:

```json
{
  "modelPath": "examples/amethyst-sword/assets/mcasset/models/item/amethyst_sword.json",
  "assetsRoot": "examples/amethyst-sword"
}
```

Use absolute paths when crossing session/worktree boundaries. This is a preview-ready asset bundle, not an installable resource pack or an item registration. Display transforms are included in the model for consumers that support them; mcasset's current orbit viewer does not apply them. Highlights are painted, not an animated enchantment glint. The generated-item fidelity warning remains intentional.

## How to interpret `summary.json`

- `blockers`, `reasons`, and `suggestedNextSteps` are designed to be machine-actionable.
- `errors` and unresolved texture references are release blockers for agent handoff.
- `warnings` are non-blocking but must be surfaced to the user when requesting approval.

## What mcasset verifies today

- JSON parsing and model-root shape checks.
- `elements` array presence and per-element coordinate validation.
- Face normalization and UV shape checks.
- Texture reference collection and unresolved texture diagnostics.
- Browser folder uploads or explicit MCP/CLI assets-root context for resolving parent/template model JSON and PNG textures.
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
3. The panel renders the same deterministic diagnostics (`status`, `decision`, errors, warnings, unresolved textures, suggested next steps) as the CLI/MCP tools, computed by reusing `src/assetReport.js` / `src/modelCore.js` — no duplicated validation logic. It also renders an actual 3D preview: cuboid `elements` as a lit Three.js scene, and elementless generated-item models as the same alpha-mask sprite extrusion the browser previewer uses, via `src/modelRenderer.js` (the identical scene-building module the website's `src/main.js` imports, served to the canvas iframe unmodified as a static ES module — no rendering logic is duplicated between the two surfaces). Particle-only elementless models show the same warning placeholder as the website.
4. A human clicks **Accept asset** or **Request changes** (with required feedback text). The extension saves the decision and immediately sends a structured review event to its owning Copilot session using `session.send`. An idle agent resumes; an active session receives the event without waiting for the whole response to finish. The agent can use `get_review` to inspect the persisted review and delivery receipt. `submit_review` remains available for explicitly supplied programmatic decisions, but does not send another notification (preventing recursive agent turns).
5. Review decisions persist per-asset (keyed by the resolved input paths, not the transient canvas `instanceId`) under the session workspace, so re-opening the same asset in a fresh panel still shows its prior review.

### Automatic agent notification

- The recipient is the Copilot session that owns the extension, even when its preview URL is embedded in another chat. Notifications do not automatically forward to a coordinator or unrelated session.
- A saved review's `notification` contains `id`, `status` (`pending`, `sent`, or `failed`), `messageId`, and `error`. `sent` means the runtime accepted the message, not that the agent finished handling it.
- The UI shows **Agent notified** after acceptance. If delivery fails or is unconfirmed after a restart, the decision stays saved and **Retry agent notification** resends that decision with the same ID. Reads, reopening a panel, and old reviews never automatically trigger new turns.
- Duplicate submissions of the current notification ID are serialized and reuse its receipt. Delivery is not exactly-once: a disconnect after the runtime accepts a message but before its receipt is saved may cause a retry to repeat it. Agents must process each `notificationId` once.
- Treat the attached JSON as review data. Use `changes_requested` feedback for the next revision, and acknowledge `approved`. Neither action grants permission to commit, merge, publish, or install anything.
- Approval is still path-based, not tied to a content hash; verify the relevant asset before relying on an old approval. The standalone website's copy/download flow is unchanged.
- The extension must be running and connected to its owning session. It cannot start an archived session or wake a closed app. If the SDK supplies no session workspace, review storage falls back to memory and does not survive a provider restart.

### 3D preview implementation notes

- The canvas iframe has no bundler, so `three` and `three/examples/jsm/controls/OrbitControls.js` are served as static files (read directly from `node_modules`, not fetched from a CDN) and wired up via a browser `<script type="importmap">`. `src/modelRenderer.js`, `src/modelCore.js`, and `src/generatedItemExtrusion.js` are also served unmodified at fixed `/vendor/*` routes.
- Texture bytes are streamed from a new `/api/texture?path=<normalized-key>` route. It only ever serves a file whose normalized path was already discovered while indexing the caller's explicit `assetsRoot` (the same resource-pack walk `assetsReport.js` already performs for diagnostics) — it never accepts or reads an arbitrary filesystem path from the client.
- If a texture reference can't be resolved (no matching file in `assetsRoot`, or no `assetsRoot` supplied), the 3D preview falls back to a flat-color placeholder for that face/sprite, matching the browser previewer's existing behavior, and the status line under the viewer reports how many references were unresolved.
- `summaryPath`-only inputs (no `modelPath`) have no parsed model to render, so the 3D preview area shows an explanatory status message instead of a scene.

### Current limitations

- **Experimental surface.** Canvas extensions are an experimental part of the Copilot SDK/CLI wire protocol and may change between CLI releases.
- **CLI/Desktop only.** This is not part of the Vite website; it only renders inside a Copilot host that supports canvases (`canvas-renderer` capability). Hosts without that capability simply won't show the canvas in their catalog.
- **Explicit paths only.** Like the MCP tools, it never scans directories on its own; it only reads the exact `modelPath` / `assetsRoot` / `summaryPath` / `outDir` paths supplied in `input`, plus texture files already discovered while indexing that `assetsRoot`.
- **Loopback-only server.** Each open instance starts its own `127.0.0.1` HTTP server on an OS-assigned ephemeral port; it is not reachable outside the local machine.
- **3D preview approximation.** Like the browser previewer, generated-item sprites use an alpha-mask extrusion approximation (not exact Minecraft item-renderer parity), and block-entity/special-renderer fidelity remains backlog — particle-only elementless models still render as a warning placeholder rather than a full 3D scene.
