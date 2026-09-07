# mcasset

Minecraft 3D Asset Preview is a browser-based previewer and agent feedback tool for generated Minecraft asset files.

The first supported target is Java Edition block/item model JSON files. The previewer lets a user or coding agent load a model, attach texture image files, validate the model shape, and inspect a 3D preview before the asset is committed or handed back to a user.

## Current goals

- Provide a website for interactive Minecraft asset previews.
- Provide a CLI-style tool that agents can run against generated asset files.
- Surface validation feedback clearly enough for an agent to decide whether to revise an asset.
- Make generated previews easy to share with a user for human approval.

## Quick start

```bash
npm install
npm run dev
```

Then open the local Vite URL. Load the Minecraft `assets` folder or resource-pack root first. The previewer indexes `assets/<namespace>/models/**/*.json` and `assets/<namespace>/textures/**/*.png` so parent/template models and textures can resolve from the loaded folder.

Once a folder is loaded, an **Indexed models** panel appears: search by path or filename and click a result to preview it — no filesystem picker needed. Each result shows its category and name (e.g. `item / acacia_hanging_sign`) plus its full indexed path, so same-named models in different categories (e.g. `models/item/acacia_hanging_sign.json` vs `models/block/acacia_hanging_sign.json`) are never ambiguous. When a basename exists in more than one category, the matching results show a hint: `models/item` files are inventory/icon models suited to this previewer, while `models/block` files with the same name may rely on a block-entity or special renderer and will only get an approximate placeholder preview here. With thousands of indexed models, the list is capped (200 results by default) and the note below the list tells you how many total matches exist so you can refine your search further.

You can still upload a single model JSON without a folder using the **Model JSON (manual upload)** field. Additional texture uploads remain available for quick tests or overrides. If the summary shows `Unresolved textures` as anything other than `None`, load the containing assets/resource-pack folder or upload the listed texture file.

For local vanilla testing, select the folder that contains `assets/minecraft/...`, for example a Minecraft version assets extraction with paths such as `assets/minecraft/models/block/cube_all.json` and `assets/minecraft/textures/block/stone.png`.

### Try the pixel-art sword

Load the included `examples/amethyst-sword` folder and select `item / amethyst_sword`. This original 16x16 example has a pale-purple crystal blade, bronze guard, dark wrapped grip, and thin alpha-based extrusion instead of thick cuboids. All material regions are painted in one transparent atlas; no installed Minecraft textures are needed.

For Copilot's in-app canvas, supply `modelPath: "examples/amethyst-sword/assets/mcasset/models/item/amethyst_sword.json"` and `assetsRoot: "examples/amethyst-sword"`. Use absolute paths if the canvas runs in another workspace. To edit/regenerate the atlas, see the [pixel-art authoring recipe](docs/agent-workflow.md#pixel-art-item-authoring).

## Agent tool usage

Validate and summarize a generated model:

```bash
npm run asset:preview -- ./path/to/model.json --out ./preview-output
```

The tool writes:

- `summary.json` with structured status/decision fields, actionable reasons, errors/warnings, unresolved texture references, suggested next steps, and an agent decision payload.
- `preview.html` with a self-contained diagnostic report. It is not a rendered 3D preview; visual approval requires the interactive canvas or website.

## MCP server (Copilot Desktop / MCP-capable agent clients)

For agent clients that integrate over the Model Context Protocol (e.g. GitHub Copilot Desktop), mcasset ships a local stdio MCP server that exposes the same validation/preview logic as programmatic tools, instead of requiring the agent to shell out to `npm run asset:preview`.

Start it directly with:

```bash
npm run mcp
```

This runs `mcp/server.mjs`, which speaks MCP over stdio and exposes two tools:

- `validate_minecraft_asset` — validates a model JSON file at an explicit `modelPath` (optionally resolving `parent` models/textures against an explicit `assetsRoot`) and returns the structured diagnostic summary described above. Writes no files.
- `preview_minecraft_asset` — same validation, plus writes `summary.json`/`preview.html` to an explicit `outDir` and returns their absolute paths alongside the summary. Its `canvasPreview` field supplies the canvas ID and absolute inputs to open the actual in-app preview in a supporting Copilot host; the MCP call itself does not open a canvas.

Both tools require explicit paths from the caller; the server never scans arbitrary home/root directories, never shells out, and never executes model file contents.

To register the server with an MCP-capable client, see `mcp/mcp.example.json` for an example `mcpServers` entry. The exact settings file or UI location for registering MCP servers varies by app and version — consult your client's MCP documentation for where to add it.

Example agent workflow over MCP:

1. Agent calls `preview_minecraft_asset` with `modelPath` (and `assetsRoot` if parent/texture resolution is needed) and an `outDir`.
2. Agent reads the returned `status`/`decision`/`blockers`/`suggestedNextSteps` fields directly from the tool result (no file parsing required).
3. If `status` is `fail`, the agent revises the model and calls the tool again.
4. If `status` is `pass` or `pass_with_warnings`, the agent opens the returned `canvasPreview` through the host's `open_canvas` tool (adding a new `instanceId`), or loads the model and textures in the website, for human visual approval.

The MCP tools and the browser previewer serve different purposes: the MCP tools give an agent fast, structured, non-visual diagnostics it can act on programmatically, while the browser website remains the human-facing visual review surface for the actual 3D preview.

## Copilot canvas extension (Copilot CLI / Desktop)

For Copilot CLI/Desktop hosts that support canvases, `.github/extensions/mcasset-preview/extension.mjs` is a project-scoped extension that lets an agent open an in-app **Minecraft asset preview** canvas: it shows the same deterministic diagnostics as the CLI/MCP tools, an actual 3D preview (cuboid elements or generated-item sprites, rendered by the same `src/modelRenderer.js` module the website uses) plus a Human review panel (Accept asset / Request changes), and returns the review as the same structured JSON payload `src/reviewFeedback.js` produces. It is discovered automatically in this repo — no separate install step. See `docs/agent-workflow.md`'s "Copilot canvas extension (in-app preview)" section for the open-input shape, actions (`get_review`, `submit_review`), 3D preview implementation notes, and current limitations (experimental surface, loopback-only server).

## Agent workflow for asset generation loops

Use this loop when an agent is producing Minecraft model files:

1. Generate or revise the model JSON asset.
2. Run `npm run asset:preview -- <model.json> --out <dir>`.
3. Read `<dir>/summary.json`.
4. If `status` is `fail` (or `decision` is `revise_asset`), use blockers/reasons/suggested steps to revise the model and rerun.
5. If `status` is `pass` or `pass_with_warnings`, inspect the actual 3D canvas/website view before requesting human approval; include warnings when present.
6. Share the diagnostic report as supporting information, not as a replacement for the visible model.

Example:

```bash
npm run asset:preview -- ./assets/generated/oak_table.json --out ./preview-output/oak-table
cat ./preview-output/oak-table/summary.json
```

Decision handling example:

- `fail`: revise asset before requesting approval.
- `pass_with_warnings`: request approval, but explicitly mention warnings.
- `pass`: request approval with the interactive preview; structural validity alone says nothing about artistic fit.

## Human-in-the-loop review

Once a model preview loads (from the folder browser or manual upload), a **Human review** panel appears below the summary. It lets a user:

- **Accept asset** — records an approval decision immediately (feedback text is optional).
- **Request changes** — requires feedback text describing what should change before it will record a revision request.

Every decision is captured as a structured JSON payload (not just visible UI text) containing:

```json
{
  "action": "approved",
  "userFeedback": "Looks great",
  "model": { "filename": "oak_table.json", "modelPath": "minecraft/models/item/oak_table.json" },
  "validation": { "status": "pass", "decision": "request_user_approval", "errors": [], "warnings": [], "unresolvedTextureReferences": [] },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

The panel shows the JSON payload with **Copy JSON** and **Download JSON** buttons so a user can hand it to an agent without any backend, account, or database — everything stays client-side in the browser.

Loading a different model (via the model browser, manual upload, or a newly loaded folder resolving the current file) clears the prior decision and feedback text, so a stale approval can never be mistaken for approval of a different model.

### How an agent should consume the exported payload

1. Ask the user to run the review in the browser previewer and share the exported JSON (paste, copy, or attach the downloaded file).
2. Read `action`: `"approved"` means proceed; `"changes_requested"` means treat `userFeedback` as required revision instructions.
3. Cross-reference `validation.status`/`validation.decision` with the human's `action` — a human can still request changes even when deterministic validation passed (e.g. for subjective/visual reasons), and this payload lets the agent tell the two apart.
4. Use `model.filename`/`model.modelPath` and `timestamp` to confirm the payload matches the asset revision under discussion before acting on it.



mcasset currently provides deterministic checks for JSON/model structure and texture-reference resolution diagnostics. It does not automatically judge subjective visual quality (style, aesthetics, or whether the asset "looks right" for the prompt) and should not be used to auto-approve assets without user review.

## Supported model features

- `elements[].from` / `elements[].to` cuboids
- Elementless generated item sprite extrusion for `minecraft:item/generated`, `item/generated`, and `builtin/generated` models with `textures.layer0`
- Elementless particle-only placeholder previews for special block models with `textures.particle`
- Parent/template lookup from a loaded assets/resource-pack folder
- Inherited parent textures and parent `elements` when the child has none
- Basic per-face texture reference resolution
- Model-level `textures`
- Warnings for malformed or out-of-bounds coordinates

Uploaded item textures can be matched by basename or common resource-pack paths such as `item/name.png`, `textures/item/name.png`, and `assets/minecraft/textures/item/name.png`.

Generated item previews now approximate thickness by extruding opaque texture pixels from `layer0` alpha, but this remains a preview approximation and not exact Minecraft item renderer parity (display transforms, lighting behavior, and other renderer details still differ).

Advanced Minecraft features such as block-entity and special-renderer emulation, display transforms, rotations, tinting, UV remapping, and full Minecraft rendering-engine parity are intentionally left for future iterations.