/** Minimal transactional IDB double for the outbox contract. Writes become
 * visible together on completion and disappear on abort. The backing map is
 * external to the provider module, so resetModules models process restart. */
export function outboxIndexedDB() {
  const records = new Map<string, unknown>();
  let failRetirement = false;
  let holdRetirement = false;
  let held: (() => void) | undefined;
  const microtask = (fn: () => void) => { void Promise.resolve().then(fn); };
  type Row = { postId: string; documentPostId?: string };
  const indexedDB = {
    open() {
      const request = {} as IDBOpenDBRequest;
      const database = {
        close() {},
        objectStoreNames: { contains: () => true },
        transaction(_store: string, mode: string) {
          const writes = new Map<string, unknown>(), deletes = new Set<string>();
          let retirement = false;
          const transaction = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            objectStore() {
              return {
                get(key: string) {
                  const result = { result: structuredClone(records.get(key)), onsuccess: null as (() => void) | null };
                  microtask(() => result.onsuccess?.()); return result;
                },
                getAll() { return { result: structuredClone([...records.values()]) }; },
                put(row: Row) { retirement ||= !!row.documentPostId; writes.set(row.postId, structuredClone(row)); },
                delete(key: string) { deletes.add(key); },
              };
            },
          };
          const commit = () => {
            if (retirement && failRetirement) { transaction.onabort?.(); return; }
            if (mode === "readwrite") {
              for (const key of deletes) records.delete(key);
              for (const [key, row] of writes) records.set(key, row);
            }
            transaction.oncomplete?.();
          };
          // Give request callbacks their turn before completing the transaction.
          microtask(() => microtask(() => {
            if (retirement && holdRetirement) held = commit;
            else commit();
          }));
          return transaction;
        },
      };
      Object.assign(request, { result: database });
      microtask(() => request.onsuccess?.({} as Event));
      return request;
    },
  };
  return {
    indexedDB,
    records,
    failRetirement: () => { failRetirement = true; },
    holdRetirement: () => { holdRetirement = true; },
    release: () => { held?.(); held = undefined; holdRetirement = false; },
  };
}
