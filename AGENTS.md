# Agent instructions for mcasset

## Product intent

Build a Minecraft asset preview website and an agent-usable feedback tool. The project should help an agent validate generated Minecraft asset files and show the user what the generated asset looks like before asking for approval.

## Current scope

- Start with Minecraft Java Edition block/item model JSON files.
- Render `elements` cuboids in a browser preview.
- Accept optional texture image uploads and map them to model texture references by basename.
- Provide an agent-facing command that validates an asset and writes machine-readable feedback.

## Engineering guidelines

- Keep changes small, testable, and focused on improving preview accuracy or agent feedback.
- Prefer deterministic validation results over vague success messages.
- Do not silently accept malformed asset files; return warnings or errors that an agent can act on.
- Preserve the browser preview and CLI validation workflows when adding features.
- Avoid external services for preview generation; the tool should run locally in development and in agent environments.

## Useful commands

```bash
npm install
npm run dev
npm run build
npm run asset:preview -- ./path/to/model.json --out ./preview-output
```

## Definitions

- **Website**: the user-facing interactive previewer.
- **Agent tool**: scripts and outputs an agent can call to validate generated assets and produce feedback.
- **Preview feedback**: structured errors, warnings, summary metadata, and visual output that support revise/approve decisions.
