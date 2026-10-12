/** Minimal transactional IDB double for the outbox contract. Transactions on
 * this store run in creation order, including their reads, across connections.
 * Writes become visible together on completion and disappear on abort. */
export function outboxIndexedDB() {
  const records = new Map<string, unknown>();
  let failRetirement = false;
  let failNextWrite = false;
  let throwPuts = false;
  let holdRetirement = false;
  let holdNextWrite = false;
  let held: (() => void) | undefined;
  let lastDatabase: { onversionchange: ((event: IDBVersionChangeEvent) => void) | null } | undefined;
  const microtask = (fn: () => void) => { void Promise.resolve().then(fn); };
  const waiting: (() => void)[] = [];
  let active = false;
  const next = () => {
    active = false;
    const start = waiting.shift();
    if (start) { active = true; microtask(start); }
  };
  type Row = { postId: string; documentPostId?: string };
  const indexedDB = {
    open() {
      const request = {} as IDBOpenDBRequest;
      const database = {
        close() {},
        onversionchange: null as ((event: IDBVersionChangeEvent) => void) | null,
        objectStoreNames: { contains: () => true },
        transaction(_store: string, mode: string) {
          const writes = new Map<string, unknown>(), deletes = new Set<string>();
          const requests: (() => void)[] = [];
          let retirement = false;
          let aborted = false;
          const transaction = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            abort() { if (!aborted) { aborted = true; transaction.onabort?.(); next(); } },
            objectStore() {
              return {
                get(key: string) {
                  const result = { result: undefined as unknown, onsuccess: null as (() => void) | null };
                  requests.push(() => {
                    result.result = structuredClone(deletes.has(key) ? undefined : writes.get(key) ?? records.get(key));
                    result.onsuccess?.();
                  });
                  return result;
                },
                getAll() {
                  const result = { result: [] as unknown[], onsuccess: null as (() => void) | null };
                  requests.push(() => {
                    const snapshot = new Map(records);
                    for (const key of deletes) snapshot.delete(key);
                    for (const [key, row] of writes) snapshot.set(key, row);
                    result.result = structuredClone([...snapshot.values()]);
                    result.onsuccess?.();
                  });
                  return result;
                },
                put(row: Row) {
                  if (throwPuts) throw new DOMException("Storage is full", "QuotaExceededError");
                  retirement ||= !!row.documentPostId;
                  deletes.delete(row.postId);
                  writes.set(row.postId, structuredClone(row));
                },
                delete(key: string) { writes.delete(key); deletes.add(key); },
              };
            },
          };
          const commit = () => {
            const fail = (retirement && failRetirement) || (mode === "readwrite" && failNextWrite);
            if (mode === "readwrite" && failNextWrite) failNextWrite = false;
            if (fail) transaction.onabort?.();
            else {
              if (mode === "readwrite") {
                for (const key of deletes) records.delete(key);
                for (const [key, row] of writes) records.set(key, row);
              }
              transaction.oncomplete?.();
            }
            next();
          };
          const run = () => {
            if (aborted) return;
            const pending = requests.shift();
            if (pending) { pending(); microtask(run); }
            else if ((retirement && holdRetirement) || (mode === "readwrite" && holdNextWrite)) {
              if (mode === "readwrite" && holdNextWrite) holdNextWrite = false;
              held = commit;
            }
            else commit();
          };
          waiting.push(run);
          if (!active) next();
          return transaction;
        },
      };
      lastDatabase = database;
      Object.assign(request, { result: database });
      microtask(() => request.onsuccess?.({} as Event));
      return request;
    },
  };
  return {
    indexedDB,
    records,
    failRetirement: () => { failRetirement = true; },
    failNextWrite: () => { failNextWrite = true; },
    throwPuts: () => { throwPuts = true; },
    allowPuts: () => { throwPuts = false; },
    holdRetirement: () => { holdRetirement = true; },
    holdNextWrite: () => { holdNextWrite = true; },
    triggerVersionChange: () => lastDatabase?.onversionchange?.({} as IDBVersionChangeEvent),
    release: () => { const commit = held; held = undefined; holdRetirement = false; holdNextWrite = false; commit?.(); },
  };
}
