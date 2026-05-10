# KVDatabaseAdapter Migration Checklist

## Goal
Migrate all consumers from `KVDatabaseAdapter` to supported data-access modules (Supabase clients / purpose-built modules) without breaking legacy flows.

## 1) Discovery and Inventory
- [ ] Enumerate all imports of `lib/db.js` and all usages of `db.query`, `getClient().query`, and `queryLegacyTolerant`.
- [ ] Classify each call site as **read** or **write** SQL usage.
- [ ] Mark all call sites currently depending on empty-read fallback behavior.

## 2) Risk Assessment and Planning
- [ ] Assign owner and priority for each call site.
- [ ] Capture required module replacement (`lib/supabase*.js`, `lib/unified-storage.js`, or endpoint-specific data layer).
- [ ] Define rollback path per endpoint before replacing data access.

## 3) Incremental Replacement
- [ ] Replace write paths first (must not rely on empty reads).
- [ ] Replace read paths with explicit supported query modules.
- [ ] Remove temporary tolerant calls (`queryLegacyTolerant`) once endpoint is migrated.

## 4) Verification
- [ ] Add/adjust unit tests per migrated endpoint.
- [ ] Run contracts and smoke checks before deployment:
  - `npm run test:unit`
  - `npm run test:contracts`
  - `npm run test:smoke`
- [ ] Confirm telemetry no longer logs legacy adapter events for migrated endpoints.

## 5) Decommissioning
- [ ] Remove remaining `KVDatabaseAdapter` imports.
- [ ] Delete legacy tolerant wrapper usages.
- [ ] Retire adapter once no consumers remain and telemetry confirms zero usage.
