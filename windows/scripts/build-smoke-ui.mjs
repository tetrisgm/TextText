import { buildLocalVault } from '../../scripts/build-local-vault.mjs';
import { fileURLToPath } from 'node:url';
await buildLocalVault({entry:'windows/TextText.Smoke/main.ts',output:fileURLToPath(new URL('../build/smoke-ui/',import.meta.url))});
