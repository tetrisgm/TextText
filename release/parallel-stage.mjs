import { spawn } from 'node:child_process';

// The caller must await this inside withCommittedPin. A failed foreground stage
// still joins the child before source pin cleanup; neither lane is signalled.
export async function withParallelStage(checkpoint, command, args, options, foreground, childLabel = command) {
  checkpoint();
  // Inherited output cannot fill an unread pipe while foreground spawnSync
  // stages block the Node event loop. Detached children would break ownership.
  const child = spawn(command, args, { ...options, stdio: 'inherit', detached: false });
  let launchError;
  child.once('error', error => { launchError = error; });
  const completion = new Promise(resolve => child.once('close', (code, signal) => {
    resolve(launchError ?? (code === 0 ? null : new Error(`${childLabel} failed (${signal || code}); release stopped.`)));
  }));
  const errors = [];
  let result;
  try { result = await foreground(); } catch (error) { errors.push(error); }
  const childError = await completion;
  if (childError) errors.push(childError);
  try { checkpoint(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, errors.map(error => String(error?.message ?? error)).join('\n'));
  return result;
}
