# Supabase migration runbook

The owner applies production migrations manually, never CI or an agent. Do not
use production credentials for development or automated tests. **Apply a PR's
migration before merging/deploying that PR.** Coordinate any incompatible change.

## Preparation and order

Use the release checkout containing the PR's migrations. Read its migration SQL
and deployment notes, confirm the target project in the Supabase dashboard, and
confirm a usable backup/restore plan before production changes. Apply files in
`supabase/migrations/` by ascending filename number, starting with `0001` for a
new project. The current sequence ends at `0017_stale_data_cleanup.sql`. Apply
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

Run the owner-operated verifier from the release checkout after applying migrations.
It reads migration history directly from `supabase_migrations.schema_migrations`
(the same history used by `supabase migration list --linked`) and compares it
with every local migration filename. It also checks exact public RPC signatures,
SECURITY DEFINER, effective anon/authenticated/service_role EXECUTE privileges,
PUBLIC grants, and the key columns in `lib/db/manifest.json`. Missing objects and
wrong grants print individually with `FAIL`; any failure exits nonzero.

Install PostgreSQL's `psql` locally. Explicitly select the target using libpq
connection settings from the dashboard **Connect** panel (direct or session
pooler connection, not the API URL). Supply secrets through your local password
file (`chmod 600`) or a shell-entered `PGPASSWORD`, never committed files or
command-line URLs. For example, after exporting the appropriate credentials:

```sh
export PGHOST=<database-host>
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=<database-user>
export PGPASSFILE=<absolute-path-to-local-password-file>
npm run db:verify
```

The script does not load `.env`, use application service-role credentials, link
projects, repair history, or apply SQL migrations. It refuses CI execution, requires
explicit host/database/user, disables psql startup files and password prompts,
and uses a read-only repeatable-read transaction with timeouts. TLS defaults to
`verify-full`; configure the appropriate trusted CA using `PGSSLROOTCERT` when
needed. For an isolated local database only, `PGSSLMODE=disable` is supported.
Use a catalog-readable database role: schema history and information_schema
column visibility must be available. Connection/catalog errors fail closed with
a generic message to avoid printing secrets. The owner may select production for
this read-only check; agents and CI must never use production credentials.

Maintain the manifest whenever adding migrations (including empty entries for
constraint/index-only migrations). List current signatures and key columns at
their latest defining migration; the offline unit suite rejects migration files
without manifest entries. This verifies presence and authorization, not function
bodies, index definitions, data integrity, or game behavior. Continue the host,
join, answering, review and challenge smoke checks after deployment.

## 0017: retention and scheduled cleanup

Apply **before merge/deploy**, as the database owner (`postgres`), with a usable
backup. This migration is additive and compatible with the currently deployed
app. No app/API secrets or HTTP scheduler are needed.

Before applying, enable **pg_cron** in the dashboard's Integrations → Cron (or
Database → Extensions). Migration 0017 also runs
`create extension if not exists pg_cron`; if the extension cannot be enabled,
stop and resolve that prerequisite rather than silently omitting scheduling.
See Supabase's [Cron install guide](https://supabase.com/docs/guides/cron/install)
and [SQL scheduling examples](https://supabase.com/docs/guides/cron/quickstart).
The migration schedules `buzzr-stale-data-cleanup` every 15 minutes. Scheduling
and execution use the database owner; owners retain privileged access even though
the RPC is revoked from PUBLIC, anon and authenticated and granted to service_role.
No anonymous/user token can invoke cleanup.

Policy is expressed as named constants in `cleanup_stale_data`:

| Constant | Default |
| --- | --- |
| `c_lobby_retention` | 24 hours since last persisted activity |
| `c_ended_retention` | 7 days since ending |
| `c_rate_retention` | 24 hours since hit |
| `c_game_batch_size` | 100 games total per invocation |
| `c_rate_batch_size` | 1,000 rate-limit rows per invocation |

Adjust these through a reviewed follow-up migration replacing the function.
Active games are never candidates, regardless of age. Reads/reconnects alone do
not count as lobby activity; game writes, player joins/changes, suggestions, and
question generation do. Existing lobbies get a fresh activity timestamp, and
existing ended games get a fresh end timestamp at migration time because their
historical times are unknown. They receive the full retention grace period.

All eight historical foreign keys cascade: questions/players → games;
answers/challenges → both questions and players (0001); category_suggestions →
both games and players (0012). No other FK appears in 0001–0016. Cleanup deletes
only games and rate_limit_hits directly; the durable question_bank is untouched.
Caps bound root rows, not cascaded child rows (a game can have many players).
Concurrent runs skip locked candidates. Dry runs take row locks until the
transaction ends, so keep manual transactions short. Returned counts include
root rows and each child table, describing that invocation's selected batch,
not the entire backlog; concurrent child changes can affect the child counts.

Verify in the intended project's SQL Editor as the owner:

```sql
select public.cleanup_stale_data(); -- defaults to dry run: no deletes
select jobid, jobname, schedule, command, username, active
from cron.job where jobname = 'buzzr-stale-data-cleanup';
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'buzzr-stale-data-cleanup')
order by start_time desc limit 20;
```

Expect exactly one active job owned by postgres, schedule `*/15 * * * *`, command
`select public.cleanup_stale_data(false);`, and successful runs after the first
scheduled interval. Verify the next dry-run counts fall once a backlog is being
drained. Watch run duration and backlog; increase frequency or reviewed batch
caps if arrivals exceed throughput. Supabase does not prune cron run history by
default: manage its separate retention in the dashboard/owner maintenance policy.

For a manual destructive batch, the owner explicitly runs
`select public.cleanup_stale_data(false);`. To stop scheduling:
`select cron.unschedule('buzzr-stale-data-cleanup');`. Unscheduling removes the job,
not data/functions; calling it with an absent name errors. The migration checks
for an existing job by name and current owner before unscheduling by id, then
schedules one replacement, so its scheduling block is idempotent for that owner.
Do not rerun historical migrations blindly; reuse only the reviewed scheduling
block if restoring the job. Jobs belonging to other database users are separate:
inspect and remove any unexpected duplicates as the owner. Supabase documents
[unscheduling by name](https://supabase.com/docs/guides/cron/quickstart).

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

## Offline and isolated database tests

`npm test` includes manifest-completeness, verifier failure cases and cleanup SQL
contract checks; it never connects to Supabase. For database behavior verification,
use an empty, disposable development PostgreSQL/Supabase database with migrations
applied and pg_cron enabled, then run:

```sh
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/0017_cleanup.sql
```

This test requires an empty games/rate-limit dataset and rolls back its fixtures.
It checks dry runs, active-game preservation, durable bank preservation, both batch
caps, end-time retention, recent lobby joins, child cascades, RPC grants and the
cron job. Never run this fixture script against a live project.

Known historical fresh-install caveat: current 0001 creates hashed player tokens,
while 0009 still references the retired `players.token` column during conversion.
Existing migrated projects are unaffected; a fresh replay needs an owner-reviewed
historical-schema bootstrap/recovery. Do not edit or repair shipped history blindly.
0017 validation used a legacy column only in a disposable test fixture to replay
0009; the repository's historical migrations remain unchanged.
