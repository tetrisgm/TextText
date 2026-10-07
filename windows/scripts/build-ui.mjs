import { buildLocalVault } from '../../scripts/build-local-vault.mjs';
import { fileURLToPath } from 'node:url';
await buildLocalVault({entry:'src/local-vault/windows-main.tsx',output:fileURLToPath(new URL('../TextText.Windows/Assets/',import.meta.url))});
