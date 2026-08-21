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

Then open the local Vite URL and upload a Minecraft model JSON file. Texture uploads are optional; the previewer falls back to generated colors when matching texture files are not available.

## Agent tool usage

Validate and summarize a generated model:

```bash
npm run asset:preview -- ./path/to/model.json --out ./preview-output
```

The tool writes:

- `summary.json` with structured status/decision fields, actionable reasons, errors/warnings, unresolved texture references, suggested next steps, and an agent decision payload.
- `preview.html` with a self-contained review report that summarizes diagnostics, model metadata, next steps, and an approval prompt for user sign-off.

## Agent workflow for asset generation loops

Use this loop when an agent is producing Minecraft model files:

1. Generate or revise the model JSON asset.
2. Run `npm run asset:preview -- <model.json> --out <dir>`.
3. Read `<dir>/summary.json`.
4. If `status` is `fail` (or `decision` is `revise_asset`), use blockers/reasons/suggested steps to revise the model and rerun.
5. If `status` is `pass` or `pass_with_warnings` (decision `request_user_approval`), ask the user for approval and include warnings when present.
6. Attach or link `<dir>/preview.html` in the user-facing response so the user can review the generated report.

Example:

```bash
npm run asset:preview -- ./assets/generated/oak_table.json --out ./preview-output/oak-table
cat ./preview-output/oak-table/summary.json
```

Decision handling example:

- `fail`: revise asset before requesting approval.
- `pass_with_warnings`: request approval, but explicitly mention warnings.
- `pass`: request approval with the preview report.

## Verification boundaries

mcasset currently provides deterministic checks for JSON/model structure and texture-reference resolution diagnostics. It does not automatically judge subjective visual quality (style, aesthetics, or whether the asset "looks right" for the prompt) and should not be used to auto-approve assets without user review.

## Supported model features

- `elements[].from` / `elements[].to` cuboids
- Elementless generated item sprites for `minecraft:item/generated`, `item/generated`, and `builtin/generated` models with `textures.layer0`
- Elementless particle-only placeholder previews for special block models with `textures.particle`
- Basic per-face texture reference resolution
- Model-level `textures`
- Warnings for malformed or out-of-bounds coordinates

Uploaded item textures can be matched by basename or common resource-pack paths such as `item/name.png`, `textures/item/name.png`, and `assets/minecraft/textures/item/name.png`.

Advanced Minecraft features such as full parent model inheritance, generated item pixel extrusion/thickness, block-entity and special-renderer emulation, display transforms, rotations, tinting, UV remapping, and resource-pack-wide texture resolution are intentionally left for future iterations.