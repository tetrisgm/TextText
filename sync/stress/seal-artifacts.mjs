// Explicit human invocation only. Never invoked by a hook, installer or job.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sealArtifacts } from './artifact-source.mjs';
export { sealArtifacts };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = sealArtifacts(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify({ status: 'sealed', role: result.role, sourceCommit: result.sourceCommit, acceptance: 'none' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
