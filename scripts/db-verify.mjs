import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verifyDatabase } from '../lib/db/verify.mjs';

// Intentionally no dotenv and no application/service-role credentials.
if (process.env.CI) {
  console.error('FAIL: db:verify is owner-operated and disabled in CI.');
  process.exit(1);
}
if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER) {
  console.error('FAIL: explicitly set PGHOST, PGDATABASE, PGUSER (and PGPASSWORD or PGPASSFILE). See docs/MIGRATIONS.md.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(new URL('../lib/db/manifest.json', import.meta.url), 'utf8'));
const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const sql = `begin transaction isolation level repeatable read read only;
select json_build_object(
  'migrations', (select coalesce(json_agg(version), '[]') from supabase_migrations.schema_migrations),
  'columns', (select coalesce(json_agg(table_name || '.' || column_name), '[]') from information_schema.columns where table_schema = 'public'),
  'functions', (select coalesce(json_agg(json_build_object(
    'signature', p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')',
    'security_definer', p.prosecdef,
    'public', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
  )), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
);
rollback;`;
console.log(`Checking explicit target ${process.env.PGHOST}/${process.env.PGDATABASE} (read-only)`);
const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000', PGCONNECT_TIMEOUT: '10', PGSSLMODE: process.env.PGSSLMODE || 'verify-full' },
});
if (result.error || result.status !== 0) {
  // Do not echo connection errors: libpq may include sensitive connection data.
  console.error('FAIL: read-only query failed. Check psql installation, connection/TLS settings, catalog permissions, and migration history table. No changes were made.');
  process.exit(1);
}
try {
  const failures = verifyDatabase(manifest, files, JSON.parse(result.stdout));
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  if (failures.length) process.exitCode = 1;
  else console.log(`PASS: ${files.length} migrations, expected RPC signatures/security/grants and columns verified.`);
} catch {
  console.error('FAIL: database returned an invalid verification snapshot.');
  process.exitCode = 1;
}
