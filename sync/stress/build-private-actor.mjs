// Human-invoked private build only. Fixed existing build commands; no installs,
// releases, network/account configuration, persistent hooks or scheduled jobs.
import { readFileSync, copyFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, preparePristineSource, verifySourceTree, artifactHashes, fixedArtifactPaths, createOnlyJSON, sealArtifacts, wrapperHashes } from './artifact-source.mjs';
export function requireLocalPrivateDatabase(environment = process.env) {
  let hostname;
  try { hostname = new URL(environment.DATABASE_URL).hostname; } catch { /* Never expose connection details. */ }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) throw new Error('Private Mac build gates require an inherited local PostgreSQL connection');
}
export function buildPrivateActor(config) {
  const { repository, ref, destination, role } = config;
  if (!isAbsolute(repository) || !isAbsolute(destination) || typeof ref !== 'string'
    || !/^(mac|pc)-(app|web|cli)$/.test(role) || !role.startsWith(process.platform === 'darwin' ? 'mac-' : 'pc-')) throw new Error('Explicit existing repository/ref, fresh absolute destination and matching physical role required');
  if (config.sidecar !== undefined && !isAbsolute(config.sidecar)) throw new Error('Sidecar must be an explicit absolute path');
  if (role === 'mac-app' && config.macEdition === 'store-local' && !config.sidecar) throw new Error('Store actor requires an explicit sandbox-readable sidecar outside the signed app');
  if (role === 'mac-app') requireLocalPrivateDatabase();
  const prepared = preparePristineSource(repository, ref, destination), { sourceRoot } = prepared;
  const steps = [];
  const run = (id, program, args, env) => { command(program, args, sourceRoot, { env: env ?? process.env }); steps.push({ id, status: 'passed' }); };
  try {
    const wrappers = wrapperHashes(sourceRoot);
    if (process.platform === 'win32') run('locked-npm', 'cmd.exe', ['/d', '/s', '/c', 'npx --yes npm@11.10.0 ci --ignore-scripts']);
    else run('locked-npm', 'npx', ['--yes', 'npm@11.10.0', 'ci', '--ignore-scripts']);
    if (role === 'pc-app') {
      if (!isAbsolute(config.dotnet ?? '') || resolve(config.dotnet).toLowerCase() !== resolve(fixedArtifactPaths(role, sourceRoot).hostRuntime).toLowerCase()) throw new Error('Existing absolute private dotnet SDK path required');
      run('shared-ui', process.execPath, ['windows/scripts/build-ui.mjs']);
      run('private-native-actor', config.dotnet, ['build', 'windows/TextText.LiveAcceptance/TextText.LiveAcceptance.csproj', '--configuration', 'Release', '--output', join(sourceRoot, 'windows/build/stress-actor')]);
    } else if (role === 'mac-app') {
      if (!['standalone', 'store-local'].includes(config.macEdition) || !process.env.TEXTTEXT_SIGN_ID) throw new Error('Explicit Mac edition and existing TEXTTEXT_SIGN_ID environment required');
      const store = config.macEdition === 'store-local';
      const env = { ...process.env, TEXTTEXT_LOCAL_DATABASE_INHERITED: '1', ...(store ? { TEXTTEXT_STORE_LOCAL: '1', TEXTTEXT_STORE: '1' } : { TEXTTEXT_LOCAL_DEVELOPMENT_BUILD: '1' }) };
      // Reuse only existing provisioning metadata at its established names.
      // This copies no account tokens, keys or Keychain data.
      const profiles = join(repository, 'mac/profiles'), destinationProfiles = join(sourceRoot, 'mac/profiles');
      const existingProfiles = (existsSync(profiles) ? readdirSync(profiles, { withFileTypes: true }) : []).filter(entry => entry.isFile() && /^TextText_[A-Za-z0-9_]+\.provisionprofile$/.test(entry.name));
      if (existingProfiles.length > 32) throw new Error('Signing profile inventory outside bound');
      mkdirSync(destinationProfiles, { recursive: true });
      for (const profile of existingProfiles) copyFileSync(join(profiles, profile.name), join(destinationProfiles, profile.name));
      run('fresh-signed-app', 'bash', [store ? 'mac/scripts/build-store.sh' : 'mac/scripts/build-app.sh'], env);
      const args = ['build', '--jobs', '2', '-c', 'release', '--triple', 'arm64-apple-macosx14.0', '--package-path', 'mac', '--disable-automatic-resolution', '-Xswiftc', '-DTEXTTEXT_STRESS_ACTOR', '--product', 'TextTextApp'];
      const bin = withPreservedPackageResolution(sourceRoot, () => {
        run('private-native-actor', 'swift', args, env);
        return command('swift', ['build', '-c', 'release', '--triple', 'arm64-apple-macosx14.0', '--package-path', 'mac', '--show-bin-path'], sourceRoot, { capture: true, env });
      });
      const app = join(sourceRoot, 'mac/build/TextText.app'), entitlements = join(destination, 'actor.entitlements');
      const xml = command('codesign', ['-d', '--entitlements', ':-', app], sourceRoot, { capture: true });
      if (!xml.includes('<plist')) throw new Error('Existing app signing entitlements unavailable');
      // Entitlements are public capability metadata, never credentials.
      createOnlyJSON(join(destination, 'signing-metadata.json'), { schemaVersion: 1, edition: config.macEdition });
      writeFileSync(entitlements, xml, { flag: 'wx', mode: 0o600 });
      copyFileSync(join(bin, 'TextTextApp'), join(app, 'Contents/MacOS/TextText'));
      if (!store && !command('otool', ['-l', join(app, 'Contents/MacOS/TextText')], sourceRoot, { capture: true }).includes('path @executable_path/../Frameworks '))
        run('private-framework-rpath', 'install_name_tool', ['-add_rpath', '@executable_path/../Frameworks', join(app, 'Contents/MacOS/TextText')]);
      const signArgs = ['--force', ...(process.env.TEXTTEXT_SIGN_ID === '-' ? [] : ['--options', 'runtime', '--timestamp']), '--entitlements', entitlements, '--sign', process.env.TEXTTEXT_SIGN_ID];
      run('sign-private-executable', 'codesign', [...signArgs, join(app, 'Contents/MacOS/TextText')]);
      run('sign-private-app', 'codesign', [...signArgs, app]);
      run('verify-private-app', 'codesign', ['--verify', '--strict', app]);
    } else steps.push({ id: 'pristine-locked-driver', status: 'passed' });
    const after = verifySourceTree(repository, prepared.proof.sourceCommit, sourceRoot);
    if (after.sourceInputSha256 !== prepared.proof.sourceInputSha256) throw new Error('Build changed tracked source');
    const receipt = { schemaVersion: 1, kind: 'private-actor-build-source', status: 'passed', role, platform: process.platform,
      sourceRoot, provenance: 'trusted-local-private-build-v1', wrapperHashes: wrappers, sourceCommit: prepared.proof.sourceCommit, before: prepared.proof, after,
      sourceArchiveSha256: prepared.sourceArchiveSha256, artifacts: artifactHashes(role, sourceRoot), steps };
    const buildReceipt = join(destination, 'build-receipt.json'), sidecar = config.sidecar ?? join(destination, 'StressBuildIdentity.json');
    createOnlyJSON(buildReceipt, receipt);
    const sealed = sealArtifacts({ repository, sourceRoot, buildReceipt, sidecar });
    return { sourceRoot, buildReceipt, sidecar, identity: sealed, acceptance: 'none' };
  } catch (error) { createOnlyJSON(join(destination, 'failure.json'), { status: 'failed', steps, message: String(error.message).slice(0, 300) }); throw error; }
}

// Store manifests omit Sparkle. SwiftPM may rewrite this tracked input even
// though the signed base build already preserved it; actor builds must too.
export function withPreservedPackageResolution(sourceRoot, action) {
  const resolution = join(sourceRoot, 'mac/Package.resolved');
  const original = readFileSync(resolution);
  try { return action(); }
  finally { writeFileSync(resolution, original); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = buildPrivateActor(JSON.parse(readFileSync(process.argv[2], 'utf8'))); console.log(JSON.stringify({ status: 'built-private-actor', sourceRoot: result.sourceRoot, sidecar: result.sidecar, acceptance: 'none' })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
