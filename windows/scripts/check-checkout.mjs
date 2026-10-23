import { spawnSync } from 'node:child_process';
const config = spawnSync('git', ['config', '--local', '--get', 'core.autocrlf'], { encoding: 'utf8' });
if (config.status !== 0 || config.stdout.trim() !== 'false') {
  console.error('Windows builds require git config core.autocrlf false in this checkout; converted line endings invalidate source hashes.');
  process.exitCode = 1;
}
