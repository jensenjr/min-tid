// Device-local storage for the sync encryption key.
//
// The encKey is a non-extractable CryptoKey, so it can't be serialised to
// localStorage — but CryptoKey is structured-cloneable, so IndexedDB stores the key
// object itself and hands back a working (still non-extractable) key on the next
// launch. Nothing here is ever synced.
//
// The not-yet-acknowledged recovery key is kept here too, so a page reload or a killed
// app between "account created" and "I have saved my recovery key" still shows it.

export type DeviceKey = {
  userId: string;
  username: string;
  /** Salt the key was derived with; doubles as the key's id on the server. */
  salt: string;
  encKey: CryptoKey;
};

export type RecoveryKeyReason = "created" | "migrated" | "rotated" | "recovered";

export type PendingRecoveryKey = {
  key: string;
  /** Only valid while the device key has this salt. */
  salt: string;
  username: string;
  reason: RecoveryKeyReason;
};

export interface KeyStore {
  getKey(): Promise<DeviceKey | null>;
  setKey(key: DeviceKey): Promise<void>;
  getPending(): Promise<PendingRecoveryKey | null>;
  setPending(p: PendingRecoveryKey | null): Promise<void>;
  /** Forget everything (account deleted / sync turned off). */
  clear(): Promise<void>;
}

type Slot = "key" | "pending";

interface Backend {
  get(slot: Slot): Promise<unknown>;
  set(slot: Slot, value: unknown): Promise<void>;
  del(slot: Slot): Promise<void>;
}

function storeOver(backend: Backend): KeyStore {
  return {
    getKey: async () => ((await backend.get("key")) as DeviceKey | undefined) ?? null,
    setKey: (key) => backend.set("key", key),
    getPending: async () =>
      ((await backend.get("pending")) as PendingRecoveryKey | undefined) ?? null,
    setPending: (p) => (p ? backend.set("pending", p) : backend.del("pending")),
    clear: async () => {
      await backend.del("key");
      await backend.del("pending");
    },
  };
}

function memoryBackend(): Backend {
  const m = new Map<Slot, unknown>();
  return {
    get: async (s) => m.get(s),
    set: async (s, v) => void m.set(s, v),
    del: async (s) => void m.delete(s),
  };
}

/** In-memory store: tests, and the fallback when IndexedDB is unavailable. */
export function createMemoryKeyStore(): KeyStore {
  return storeOver(memoryBackend());
}

const DB_NAME = "min-tid-sync";
const OBJECT_STORE = "keys";

function idbBackend(): Backend {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(OBJECT_STORE);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    }).catch((e) => {
      dbp = null; // let the next call try again
      throw e;
    }));

  // Resolve on transaction *complete*, so a write is durable before we report success.
  async function run<T>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(OBJECT_STORE, mode);
      const req = fn(tx.objectStore(OBJECT_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  }

  return {
    get: (s) => run("readonly", (os) => os.get(s)),
    set: async (s, v) => void (await run("readwrite", (os) => os.put(v, s))),
    del: async (s) => void (await run("readwrite", (os) => os.delete(s))),
  };
}

/**
 * IndexedDB with an in-memory fallback. When a write fails (private mode, quota, a
 * browser that can't clone CryptoKey) the value lives in memory for this session and
 * shadows whatever IndexedDB still holds — a stale key must never win. After a reload
 * the user simply has to log in again.
 */
export function createIndexedDbKeyStore(): KeyStore {
  const idb = idbBackend();
  const mem = memoryBackend();
  const shadowed = new Set<Slot>();
  return storeOver({
    async get(s) {
      if (shadowed.has(s)) return mem.get(s);
      try {
        return await idb.get(s);
      } catch {
        return mem.get(s);
      }
    },
    async set(s, v) {
      try {
        await idb.set(s, v);
        shadowed.delete(s);
        await mem.del(s);
      } catch {
        shadowed.add(s);
        await mem.set(s, v);
      }
    },
    async del(s) {
      await mem.del(s);
      shadowed.delete(s);
      try {
        await idb.del(s);
      } catch {
        shadowed.add(s); // IndexedDB may still hold it: keep reading "nothing" from memory
      }
    },
  });
}

export function createDefaultKeyStore(): KeyStore {
  return typeof indexedDB === "undefined" ? createMemoryKeyStore() : createIndexedDbKeyStore();
}
