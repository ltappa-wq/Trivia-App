# Supabase migration runbook

The owner applies production migrations manually, never CI or an agent. Do not
use production credentials for development or automated tests. **Apply a PR's
migration before or immediately after deploying that PR.** Prefer before deploy
when the new app requires the new schema; coordinate any incompatible change.

## Preparation and order

Use the release checkout containing the PR's migrations. Read its migration SQL
and deployment notes, confirm the target project in the Supabase dashboard, and
confirm a usable backup/restore plan before production changes. Apply files in
`supabase/migrations/` by ascending filename number, starting with `0001` for a
new project. The current sequence ends at `0013_atomic_game_writes.sql`. Apply
only files not already successfully applied; do not edit historical migrations.

## Supabase CLI (preferred)

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
on the owner's machine. From the repository root, initialize local CLI config
with `supabase init` if `supabase/config.toml` is absent (a local/CI config is now tracked here); keep generated configuration and linking metadata local.
Then authenticate and explicitly select the intended project:

```sh
supabase login
supabase link --project-ref <project-ref>
supabase migration list
supabase db push --dry-run
```

Replace `<project-ref>` with the dashboard's project reference. Enter credentials
at the CLI prompts; do not put them in committed files. Check the linked project
and review the local/remote migration list: a local version without a remote
entry is pending. Investigate unexpected remote-only versions or gaps before
continuing. The dry run previews which files would run.

When the owner is ready to apply the reviewed set:

```sh
supabase db push
supabase migration list
```

These commands target the linked project. The CLI records applied versions in
`supabase_migrations.schema_migrations`. Command syntax and behavior were checked
against the official references for [link](https://supabase.com/docs/reference/cli/supabase-link),
[migration list](https://supabase.com/docs/reference/cli/supabase-migration-list),
and [db push](https://supabase.com/docs/reference/cli/supabase-db-push).

## SQL Editor fallback

In the intended project's dashboard SQL Editor, paste each pending file's entire
contents and run it **one file at a time, in numbered order**. Confirm success
before the next file and record the filename and result in the release notes.
Do not paste the whole directory together or rerun files blindly.

SQL Editor execution does not automatically create CLI migration-history entries.
Before switching to CLI deployment, compare the actual schema with each file and
reconcile only fully applied versions using
`supabase migration repair <version> --status applied` (for example, version
`0013`). Then recheck `supabase migration list` and `supabase db push --dry-run`.
[Repair changes history only](https://supabase.com/docs/reference/cli/supabase-migration-repair);
it does not execute SQL or fix an incomplete schema.

## Verify

Confirm all intended versions are applied, then inspect public functions in SQL
Editor with this read-only query:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'resolve_token', 'hydrate_game_state', 'list_open_challenges',
    'reveal_answer', 'answer_distribution', 'adjust_player_score',
    'check_rate_limit', 'list_category_suggestions', 'commit_answer',
    'create_challenge_and_pause', 'resolve_challenge'
  )
order by p.proname, arguments;
```

Through migration `0013`, expect all eleven names above. Compare signatures,
security-definer settings and execute grants with their latest migration
definitions, especially the service-role-only atomic write RPCs in `0013`.
Presence alone does not prove correct authorization or behavior. Smoke-test host
setup, player join, answering, review and challenge resolution after deployment.
A `npm run db:verify` script is coming later; it does not exist yet.

## If a migration fails partway

Stop applying later files and pause the dependent app deployment. Save the error
and filename, inspect the database and migration history, and determine whether
the failed execution rolled back or left changes committed; do not assume either.
Compare every statement in that file with the actual schema/data before retrying.

If fully rolled back, fix the cause and retry the pending file. If partially
applied, have the owner/developer prepare a reviewed recovery that safely completes
or reverses the partial changes, or restore the backup when appropriate. Do not
edit shipped migrations, reset production, or mark an incomplete migration as
applied just to clear an error. Only reconcile history after the full migration's
effects are verified; then resume in order and repeat verification.
