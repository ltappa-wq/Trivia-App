// Pure comparison logic, shared by the owner CLI and offline tests.
export function verifyDatabase(manifest, files, snapshot) {
  const failures = [];
  for (const file of files) {
    if (!manifest[file]) failures.push(`Missing manifest entry: ${file}`);
    if (!snapshot.migrations.includes(file.split('_')[0])) failures.push(`Missing migration: ${file}`);
  }
  for (const file of Object.keys(manifest)) {
    if (!files.includes(file)) failures.push(`Manifest has no migration file: ${file}`);
    for (const column of manifest[file].columns) {
      if (!snapshot.columns.includes(column)) failures.push(`Missing column: public.${column}`);
    }
    for (const expected of manifest[file].functions) {
      const actual = snapshot.functions.find(f => f.signature === expected.signature);
      if (!actual) { failures.push(`Missing function: public.${expected.signature}`); continue; }
      if (!actual.security_definer) failures.push(`Wrong security: public.${expected.signature} must be SECURITY DEFINER`);
      if (expected.access !== 'client' && (actual.anon || actual.authenticated || actual.public)) {
        failures.push(`Wrong grants: public.${expected.signature} exposes EXECUTE to clients/PUBLIC`);
      }
      if (expected.access === 'service' && !actual.service_role) failures.push(`Wrong grants: public.${expected.signature} missing service_role EXECUTE`);
      if (expected.access === 'client' && (!actual.anon || !actual.authenticated)) failures.push(`Wrong grants: public.${expected.signature} missing client EXECUTE`);
    }
  }
  return failures;
}
