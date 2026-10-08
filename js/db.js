// Local persistence: book metadata and the raw .epub bytes live in IndexedDB.
// Nothing ever leaves the browser.

const DB_NAME = 'secret-reader';
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function listBooks() {
  return run(['books'], 'readonly', (tx) => req(tx.objectStore('books').getAll()));
}

export function getBook(id) {
  return run(['books'], 'readonly', (tx) => req(tx.objectStore('books').get(id)));
}

export function getFile(id) {
  return run(['files'], 'readonly', (tx) => req(tx.objectStore('files').get(id)));
}

export function addBook(meta, buffer) {
  return run(['books', 'files'], 'readwrite', (tx) => {
    tx.objectStore('books').put(meta);
    tx.objectStore('files').put(buffer, meta.id);
  });
}

export function updateBook(id, patch) {
  return run(['books'], 'readwrite', async (tx) => {
    const store = tx.objectStore('books');
    const current = await req(store.get(id));
    if (current) store.put({ ...current, ...patch });
  });
}

export function deleteBook(id) {
  return run(['books', 'files'], 'readwrite', (tx) => {
    tx.objectStore('books').delete(id);
    tx.objectStore('files').delete(id);
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* best effort */ }
}
