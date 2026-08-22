# Agent instructions for mcasset

## Product intent

Build a Minecraft asset preview website and an agent-usable feedback tool. The project should help an agent validate generated Minecraft asset files and show the user what the generated asset looks like before asking for approval.

## Current scope

- Start with Minecraft Java Edition block/item model JSON files.
- Render `elements` cuboids in a browser preview.
- Render elementless generated item models with `textures.layer0` as transparent sprite previews.
- Show a warning placeholder for elementless particle-only block models; block-entity and special-renderer fidelity remains backlog.
- Accept a loaded Minecraft `assets` folder or resource-pack folder as browser context for parent/template model and texture resolution.
- After a folder is loaded, provide an in-browser searchable model list so a user can select an indexed model without reopening the filesystem picker.
- When a model basename exists under both `models/item` and `models/block`, show the category and full path for each result and a hint clarifying that item models are inventory/icon previews while block models with the same name may need special block-entity rendering.
- Accept optional texture image uploads and map them to model texture references by basename or resource-pack path.
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

## Agent feedback loop (required workflow)

When you are generating or revising Minecraft model assets, use this loop:

1. Generate or update the model JSON file.
2. Run `npm run asset:preview -- <model.json> --out <dir>`.
3. Read `<dir>/summary.json` and branch on `status` / `decision`.
4. If `status` is `fail` (or decision is `revise_asset`), revise the asset to resolve blockers, then rerun the command.
5. If `status` is `pass` or `pass_with_warnings` (decision `request_user_approval`), present the results to the user and ask for approval.
6. In user-facing responses, attach or link `<dir>/preview.html` so approval is based on the generated report.

Interpretation rules:

- Treat `summary.json` as deterministic structural/texture diagnostics with actionable blockers, reasons, and suggested steps.
- Do not claim automatic approval based on subjective visual quality; this tool does not judge style, artistic quality, or semantic fit with a prompt.
- Always surface warnings when status is `pass_with_warnings` so the user can decide if they are acceptable.

## Definitions

- **Website**: the user-facing interactive previewer.
- **Agent tool**: scripts and outputs an agent can call to validate generated assets and produce feedback.
- **Preview feedback**: structured errors, warnings, summary metadata, and visual output that support revise/approve decisions.
