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

Before multi-user work, read:

- `docs/MULTI_USER_DESIGN.md`
- `docs/MULTI_USER_MIGRATION_PLAN.md`
- `docs/DATA_MODEL.md`
- `docs/CURRENT_ARCHITECTURE.md`

Do not assume current legacy behavior represents the target architecture.

## Validation

For relevant changes, run existing Node assertions, fixture validation, build, and:

git diff --check
git status --short

Report remaining manual checks clearly.

## Current development principle

Do not silently migrate or rewrite production-shaped legacy data merely because the app opens.