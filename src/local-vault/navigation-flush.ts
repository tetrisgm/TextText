/** Leave a web file after its accepted edits have a durable local journal. */
export async function flushForNavigation(client: {
  readonly hasPendingChanges: boolean;
  flush: () => Promise<boolean>;
  flushLocal?: () => Promise<boolean>;
  flushLocalResult?: () => Promise<{ outcome: string }>;
}, onChanged: () => void): Promise<boolean> {
  const hadPendingChanges = client.hasPendingChanges;
  if (!hadPendingChanges) return true;
  if (client.flushLocalResult || client.flushLocal) {
    const durable = client.flushLocalResult
      ? (await client.flushLocalResult()).outcome === "durable"
      : await client.flushLocal!();
    if (!durable) return false;
    onChanged();
    return true;
  }
  if (hadPendingChanges && !await client.flush()) return false;
  // A new edit may arrive while the first batch is being acknowledged.
  if (client.hasPendingChanges) return false;
  if (hadPendingChanges) onChanged();
  return true;
}

/** A native file may close once its current projection and journal are durable on disk. */
export async function flushNativeForNavigation(client: {
  flushLocal: () => Promise<boolean>;
  flushLocalResult?: () => Promise<{ outcome: string }>;
}, onChanged: () => void): Promise<boolean> {
  const durable = client.flushLocalResult
    ? (await client.flushLocalResult()).outcome === "durable"
    : await client.flushLocal();
  if (!durable) return false;
  onChanged();
  return true;
}
