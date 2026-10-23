import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertReleaseSource } from './committed-pin.mjs';

export function assertReleaseCheckpoint(root, commit, cancelFile) {
  if (existsSync(cancelFile)) throw new Error(`Release cancelled at a stage boundary: ${cancelFile}`);
  assertReleaseSource(root, commit);
}

// Cancellation waits for the child to finish. Never signal a test or installed app.
export function runReleaseStage(checkpoint, command, args, options, onSuccess = () => {}) {
  checkpoint();
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status}); release stopped.`);
  onSuccess();
  checkpoint();
}
