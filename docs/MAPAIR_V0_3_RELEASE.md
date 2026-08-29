# Mapair v0.3 release checklist

Do not run this workflow until the release branch, migration report, and production rules have been approved.

1. Review `release/mapair-v0.3-no-space`; confirm CI/tests/build pass and no backup or credentials are tracked. Firestore emulator tests require JDK 21 or newer.
2. Export and inspect the rules currently deployed to `mapping-505208`. Reconcile them with `firestore.no-space.rules`; do not blindly replace unknown production rules.
3. Configure Firebase Admin application-default credentials locally. Do not place a credential file in this repository.
4. Dry-run: `node scripts/migrate-no-space-v1.mjs --project mapping-505208 --source-space us`.
5. Review every count, warning, and blocker. Stop if any Visit or Trip has no valid participant, or if counts do not match the legacy history.
6. Apply only after approval: `node scripts/migrate-no-space-v1.mjs --project mapping-505208 --source-space us --apply --confirm MAPAIR_NO_SPACE_V1`. The tool must report a verified file under `migration-backups/` before it writes anything.
7. Verify sampled `places`, `visits`, `trips`, `users`, day orders, legacy imports, `appConfig/defaults`, and `migrations/no-space-v1` in Firestore. Confirm `spaces/us` is unchanged.
8. In a coordinated release window, deploy the reconciled No-Space rules, merge the reviewed branch, and let the normal GitHub Pages release complete. Do not deploy the isolated candidate without the rules review in step 2.
9. Verify the live site says “我的足跡” and has only “去過 / 行程”, with no Space switcher.
10. Smoke-test desktop and mobile: login, existing history, map and geography, Visit editing, personal rating and 回憶, read-only 舊版共同記錄, Trip color and 同行者 defaults, personal same-day ordering, and date/Trip/同行者/category/region filters.
11. Keep `spaces/us` and the verified local backup untouched for rollback. Never upload or commit `migration-backups/`.
