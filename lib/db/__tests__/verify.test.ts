import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json';
// The CLI shares this dependency-free module with offline tests.
import { verifyDatabase } from '../verify.mjs';

const directory = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
const functions = Object.values(manifest).flatMap(m => m.functions);
const healthy = () => ({
  migrations: files.map(f => f.split('_')[0]),
  columns: Object.values(manifest).flatMap(m => m.columns),
  functions: functions.map(f => ({ signature: f.signature, security_definer: true,
    public: false, anon: f.access === 'client', authenticated: f.access === 'client', service_role: true })),
});
describe('database verification', () => {
  it('requires an explicit manifest update for every migration file', () => {
    expect(Object.keys(manifest).sort()).toEqual(files);
  });
  it('covers every declared public function signature by name', () => {
    const names = functions.map(f => f.signature.split('(')[0]);
    for (const file of files) {
      const sql = readFileSync(new URL(file, directory), 'utf8');
      for (const m of sql.matchAll(/create or replace function public\.(\w+)/g)) expect(names).toContain(m[1]);
    }
  });
  it('accepts a complete schema', () => expect(verifyDatabase(manifest, files, healthy())).toEqual([]));
  it('lists missing migrations, columns and exact signatures', () => {
    const snapshot = healthy();
    snapshot.migrations = [];
    snapshot.columns = [];
    snapshot.functions = [];
    const errors = verifyDatabase(manifest, files, snapshot);
    expect(errors).toContain('Missing migration: 0017_stale_data_cleanup.sql');
    expect(errors).toContain('Missing column: public.games.ended_at');
    expect(errors).toContain('Missing function: public.cleanup_stale_data(boolean)');
  });
  it.each(['public', 'anon', 'authenticated'] as const)('rejects write EXECUTE exposed to %s', role => {
    const snapshot = healthy();
    snapshot.functions.find(f => f.signature === 'cleanup_stale_data(boolean)')![role] = true;
    expect(verifyDatabase(manifest, files, snapshot)).toContain('Wrong grants: public.cleanup_stale_data(boolean) exposes EXECUTE to clients/PUBLIC');
  });
  it('rejects missing service grants and invoker security', () => {
    const snapshot = healthy();
    const rpc = snapshot.functions.find(f => f.signature === 'cleanup_stale_data(boolean)')!;
    rpc.service_role = false;
    rpc.security_definer = false;
    expect(verifyDatabase(manifest, files, snapshot)).toHaveLength(2);
  });
  it('rejects missing client grants and unmanifested files', () => {
    const snapshot = healthy();
    snapshot.functions.find(f => f.signature === 'hydrate_game_state(text)')!.anon = false;
    const errors = verifyDatabase(manifest, [...files, '0018_future.sql'], snapshot);
    expect(errors).toContain('Missing manifest entry: 0018_future.sql');
    expect(errors).toContain('Wrong grants: public.hydrate_game_state(text) missing client EXECUTE');
  });
});
