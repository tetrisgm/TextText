/** A workspace change owns a new page/bridge realm. Never accept navigation URLs from callers. */
export async function openWebWorkspace(params: Record<string, unknown>, options: {
  currentId: string; signal: AbortSignal; request?: typeof fetch;
  flush: () => Promise<boolean>; stopAgent: () => void; navigate: (path: string) => void;
}): Promise<void> {
  const id = params.workspaceId;
  if (Object.keys(params).length !== 1 || typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Choose a workspace from your account.");
  if (id === options.currentId) return;
  const check = () => { if (options.signal.aborted) throw new DOMException("Workspace closed", "AbortError"); };
  check();
  if (!await options.flush()) throw new Error("Finish saving your changes before opening another workspace.");
  check();
  const request = options.request ?? fetch;
  // Discovery and selected access are both fresh; a removed invitation cannot
  // turn a previously rendered menu into navigation authority.
  const list = await request("/api/vault/workspaces", { credentials: "same-origin", cache: "no-store", signal: options.signal });
  if (!list.ok) throw new Error("Workspaces are unavailable. Your current workspace is still open.");
  const value = await list.json();
  check();
  if (!Array.isArray(value.workspaces) || !value.workspaces.some((entry: {id?: string}) => entry.id === id)) throw new Error("This workspace is no longer available to your account.");
  const access = await request(`/api/vault/${encodeURIComponent(id)}/access`, { credentials: "same-origin", cache: "no-store", signal: options.signal });
  if (!access.ok) throw new Error("This workspace is no longer available to your account.");
  check();
  options.stopAgent();
  options.navigate(`/vault/${encodeURIComponent(id)}`);
}
