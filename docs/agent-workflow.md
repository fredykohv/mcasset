# Agent workflow with mcasset

This document defines the recommended agent loop for generated Minecraft model assets.

## Loop

1. Generate a model JSON asset.
2. Run:

```bash
npm run asset:preview -- <model.json> --out <output-dir>
```

3. Read `<output-dir>/summary.json`.
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
