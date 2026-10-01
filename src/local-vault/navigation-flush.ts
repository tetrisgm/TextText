/** Finish shared edits before leaving a web file without re-reading a pack that will be discarded. */
export async function flushForNavigation(client: { readonly hasPendingChanges: boolean; flush: () => Promise<boolean> }, onChanged: () => void): Promise<boolean> {
  const hadPendingChanges = client.hasPendingChanges;
  if (hadPendingChanges && !await client.flush()) return false;
  // A new edit may arrive while the first batch is being acknowledged.
  if (client.hasPendingChanges) return false;
  if (hadPendingChanges) onChanged();
  return true;
}
