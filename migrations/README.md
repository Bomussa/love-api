# Legacy migrations (non-authoritative)

This directory is intentionally kept as a placeholder.

Historical SQL migration files were archived under `legacy/migrations/` and are **non-authoritative**.

## Source of truth
Use only `supabase/migrations/` for all new schema deployments.
See `docs/DB_SOURCE_OF_TRUTH.md` for execution rules and the official database contract.

## Documentation rule
Do not add any non-SQL files to `supabase/migrations/`.
Keep only approved migration files with the `.sql` extension in that directory.
