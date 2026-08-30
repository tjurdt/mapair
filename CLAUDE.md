# Mapair Claude Code Instructions

Read `AGENTS.md` before substantial work. Its repository safety rules are mandatory.

## Workflow

- GitHub is the source of truth.
- Work only on the current feature branch.
- Never change branches unless explicitly instructed.
- Never commit, push, merge, deploy, reset, revert, or modify git history unless explicitly instructed.
- Never access or mutate production Firebase data during development.
- Never weaken LOCAL TEST fail-closed safeguards.
- Prefer additive and reversible migrations.
- Preserve legacy compatibility until its documented migration phase removes it.

## Architecture

The client runs the **No-Space** architecture (top-level `users` / `visits` /
`places` / `trips` / contributions / day orders). Before substantial work, read:

- `docs/NO_SPACE_CORE.md` — domain model, Firestore paths, data contract
- `docs/CURRENT_ARCHITECTURE.md` — how the running client is built
- `docs/DATA_MODEL.md` — projected shape + legacy read-compatibility rules

The `spaces/{spaceId}` multi-user design was abandoned; its docs are in
`docs/archive/` and its modules (`src/spaces.js`, `src/space-membership.js`) are
deleted. Do not reintroduce that model or assume legacy `spaces/us` data
represents the target. Legacy read-compat (`visitedOn`, `who`/`whoMode`,
dormant `status:"wishlist"`) must be preserved until the migration removes it.

## Validation

For relevant changes, run existing Node assertions, fixture validation, build, and:

git diff --check
git status --short

Report remaining manual checks clearly.

## Current development principle

Do not silently migrate or rewrite production-shaped legacy data merely because the app opens.