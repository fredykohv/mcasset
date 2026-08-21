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

- `summary.json` with validation status, warnings, element counts, and texture references.
- `preview.html` with a human-readable report that can be attached to an agent run or linked from a workflow.

## Supported model features

- `elements[].from` / `elements[].to` cuboids
- Basic per-face texture reference resolution
- Model-level `textures`
- Warnings for malformed or out-of-bounds coordinates

Advanced Minecraft features such as parent model inheritance, display transforms, rotations, tinting, UV remapping, and resource-pack-wide texture resolution are intentionally left for future iterations.