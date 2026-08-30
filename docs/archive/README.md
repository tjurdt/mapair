# Archived design documents

These documents are **historical**. They describe work that is either finished
or abandoned, and they do **not** describe the current architecture.

| Document | Status |
| --- | --- |
| `MULTI_USER_DESIGN.md` | **Abandoned.** Proposed a multi-user `spaces/{spaceId}` product with Memberships, invitations, and a Personal Space switcher (Phases 1–6). Superseded by the No-Space architecture (`../NO_SPACE_CORE.md`). The supporting modules `src/spaces.js` and `src/space-membership.js` have been deleted. |
| `MULTI_USER_MIGRATION_PLAN.md` | **Abandoned.** The reversible migration plan for the design above. Not executed. |
| `baseline/` | **Historical.** Stage 0 behaviour baseline and manual smoke-test findings captured before the Vite/ES-module migration. Enduring fragility items are tracked in `../CURRENT_ARCHITECTURE.md`. |

For the current system see:

- `../CURRENT_ARCHITECTURE.md` — how the running client is built
- `../NO_SPACE_CORE.md` — the domain model, Firestore paths, and data contract
- `../DATA_MODEL.md` — projected Place/Visit/Trip shape and legacy read-compatibility rules
- `../PRODUCT.md` — user-facing product behaviour
