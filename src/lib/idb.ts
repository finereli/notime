// Image blobs for drafts. localStorage cannot hold them, IndexedDB can.

const DB = 'notime.v1'
const STORE = 'images'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const putImage = (id: string, blob: Blob) => run('readwrite', (s) => s.put(blob, id))
export const getImage = (id: string) => run<Blob | undefined>('readonly', (s) => s.get(id))
export const deleteImage = (id: string) => run('readwrite', (s) => s.delete(id))
export const imageKeys = () => run('readonly', (s) => s.getAllKeys()) as Promise<string[]>
