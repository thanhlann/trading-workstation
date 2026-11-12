const DATABASE_NAME = 'trading-workstation-backtest-notes';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tradeNotes';

export const TRADE_NOTE_PRIORITIES = ['Critical', 'High', 'Medium', 'Low', 'None'] as const;
export type TradeNotePriority = (typeof TRADE_NOTE_PRIORITIES)[number];

export interface TradeNote {
  text: string;
  priority: TradeNotePriority;
}

interface TradeNoteRecord extends TradeNote {
  id: string;
}

function isTradeNotePriority(value: unknown): value is TradeNotePriority {
  return TRADE_NOTE_PRIORITIES.some((priority) => priority === value);
}

export function getTradeNoteId(
  symbol: string,
  tradeNumber: number,
  tradeTime: number,
): string {
  return `${symbol}:${tradeNumber}:${tradeTime}`;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(error);
    };

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      fail(request.error ?? new Error('Could not open the trade notes database.'));
    };
    request.onblocked = () => {
      fail(new Error('The trade notes database is blocked by another page.'));
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error('Could not read the trade notes database.'));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('The trade notes transaction failed.'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('The trade notes transaction was aborted.'));
    };
  });
}

function isTradeNoteRecord(value: unknown): value is TradeNoteRecord {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && typeof value.id === 'string'
    && 'text' in value
    && typeof value.text === 'string'
    && (!('priority' in value) || isTradeNotePriority(value.priority));
}

export async function loadTradeNote(id: string): Promise<TradeNote> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const done = transactionComplete(transaction);
  const resultPromise = requestResult(transaction.objectStore(STORE_NAME).get(id));
  const [result] = await Promise.all([resultPromise, done]);

  if (result === undefined) return { text: '', priority: 'None' };
  if (!isTradeNoteRecord(result)) {
    throw new Error('The stored trade note has an invalid format.');
  }

  return { text: result.text, priority: result.priority ?? 'None' };
}

export async function loadTradeNotes(ids: readonly string[]): Promise<Map<string, TradeNotePriority>> {
  if (ids.length === 0) return new Map();

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const done = transactionComplete(transaction);
  const recordsPromise = requestResult(transaction.objectStore(STORE_NAME).getAll());
  const [records] = await Promise.all([recordsPromise, done]);

  if (!Array.isArray(records) || !records.every(isTradeNoteRecord)) {
    throw new Error('The stored trade notes have an invalid format.');
  }

  const requestedIds = new Set(ids);
  const loadedNotes = new Map<string, TradeNotePriority>();
  for (const record of records) {
    if (requestedIds.has(record.id)
      && (record.text.trim().length > 0 || (record.priority ?? 'None') !== 'None')) {
      loadedNotes.set(record.id, record.priority ?? 'None');
    }
  }
  return loadedNotes;
}

export async function saveTradeNote(
  id: string,
  text: string,
  priority: TradeNotePriority = 'None',
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionComplete(transaction);
  const store = transaction.objectStore(STORE_NAME);

  if (text.trim().length === 0 && priority === 'None') {
    store.delete(id);
  } else {
    store.put({ id, text, priority } satisfies TradeNoteRecord);
  }

  await done;
}
