import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile } from './identity-observation.mjs';

export const playwrightBundlePath = join(dirname(fileURLToPath(import.meta.resolve('playwright-core/package.json'))), 'lib/coreBundle.js');

// Preserve the locked SDK's defaults instead of replacing its feature switch.
// Refuse an unfamiliar SDK layout before starting Edge, which can lock Windows accounts.
export function edgeDisabledFeatures(source) {
  if (typeof source !== 'string' || source.length > 8 * 1024 * 1024) throw new Error('Browser defaults outside bounds');
  const matches = [...source.matchAll(/^\s*disabledFeatures = \[([\s\S]*?)^\s*\]\.filter\(Boolean\);/gm)];
  if (matches.length !== 1) throw new Error('Browser feature defaults unavailable');
  const features = [];
  for (const line of matches[0][1].split('\n')) {
    if (!line.trim() || /^\s*\/\//.test(line)) continue;
    const match = /^\s*"([A-Za-z][A-Za-z0-9_-]*)",?\s*$/.exec(line);
    if (!match) throw new Error('Browser feature defaults changed syntax');
    features.push(match[1]);
  }
  if (!features.length || features.length > 128 || new Set(features).size !== features.length) throw new Error('Browser feature defaults outside bounds');
  return '--disable-features=' + [...new Set([...features, 'AutofillAiWalletPrivatePasses'])].join(',');
}

export function browserLaunchArguments(platform, readDefaults = () => boundedFile(playwrightBundlePath, 8 * 1024 * 1024).toString('utf8')) {
  return ['--enable-automation', ...(platform === 'win32' ? [edgeDisabledFeatures(readDefaults())] : [])];
}
