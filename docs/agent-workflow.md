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
- Structured pass/fail decision output for agent routing.

## What mcasset does not verify automatically

- Subjective visual quality or artistic fit.
- Whether the asset matches user intent beyond deterministic diagnostics.
- Full Minecraft model system coverage (for example parent inheritance, transforms, rotations, tinting, and full resource-pack graph behavior).

Use deterministic diagnostics to guide revisions, and keep human approval as the final gate for visual quality and intent alignment.
