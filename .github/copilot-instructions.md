# Copilot instructions

This repository builds a Minecraft asset preview website and an agent feedback tool. Prioritize preview correctness, clear validation, and outputs that an automated coding agent can use to revise generated assets.

When changing the project:

- Keep `AGENTS.md` aligned with major workflow or architecture changes.
- Preserve `npm run build` and `npm run asset:preview`.
- Surface errors and warnings explicitly instead of hiding invalid Minecraft model data.
- Prefer local, reproducible workflows over hosted services.
