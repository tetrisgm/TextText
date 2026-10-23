import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function selectSigningIdentity(listing, requested = '') {
  const identities = [...listing.matchAll(/^\s*\d+\) ([A-Fa-f0-9]{40}) "([^"]+)"/gm)]
    .map(([, hash, name]) => ({ hash, name }));
  const matches = requested
    ? identities.filter(({ hash, name }) => hash.toLowerCase() === requested.toLowerCase() || name === requested)
    : identities.filter(({ name }) => name.includes('Apple Development')).slice(0, 1);
  if (matches.length !== 1) throw new Error('Signing preflight requires one existing signing identity; the requested identity is missing or ambiguous.');
  return matches[0].hash;
}

export function signingPreflight(evidence, requested = '', execute = execFileSync, source = '/usr/bin/true') {
  const identity = selectSigningIdentity(execute('security', ['find-identity', '-p', 'codesigning', '-v'], { encoding: 'utf8' }), requested);
  const directory = join(evidence, 'signing-preflight');
  mkdirSync(directory); // Never reuse or overwrite evidence from an earlier probe.
  const probe = join(directory, 'true');
  copyFileSync(source, probe, constants.COPYFILE_EXCL);
  try {
    // Exercise the existing private key with the same options as build-app.sh.
    // Do not execute the probe, unlock a keychain, or remove retained evidence.
    execute('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, probe], { encoding: 'utf8', timeout: 30000 });
    execute('codesign', ['--verify', '--strict', probe], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    throw new Error(`Signing readiness failed before release gates; retained probe: ${probe}\n${error.stderr?.toString() || error.message}`, { cause: error });
  }
  return identity;
}
