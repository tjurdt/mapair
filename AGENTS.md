# Mapair Agent Guide

Mapair is a shared geographic memory and travel-history application. Before changing code, inspect the existing behavior and the relevant documentation under `docs/`.

## Domain invariants

- A **Place** is the shared geographic entity and owns location-level metadata.
- A **Visit** is one dated occurrence at a Place. A Place may have repeated Visits.
- A **Trip** groups Visits; it does not own or duplicate Places.
- Preserve all legacy Place-level fallbacks and mirrored fields unless a separately validated data migration explicitly removes them.

## Change rules

- Keep changes scoped to the requested behavior. Do not alter unrelated behavior while refactoring.
- Treat mobile UX as a first-class requirement and validate desktop and mobile behavior.
- Preserve current Firebase paths, filtering semantics, map behavior, stay semantics, and Visit ordering unless the task explicitly changes them.
- Prefer small, reversible changes with focused validation.
- Once build, test, lint, or type-check systems exist, run all relevant checks before finishing.

See `docs/PRODUCT.md`, `docs/CURRENT_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/MIGRATION_PLAN.md` for detailed context.

## Repository safety

- Do not deploy to production unless explicitly requested.
- Do not modify production Firebase data as part of development or testing.
- Do not commit, push, merge, reset, or change branches unless explicitly requested.
- Perform substantial work on a dedicated branch, not directly on `main`.