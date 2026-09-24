import fs from 'fs';
import path from 'path';

// Load config
let config: {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
} = {
  projectId: 'gen-lang-client-0486946771',
  apiKey: '',
  firestoreDatabaseId: '(default)'
};

try {
  const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    config = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Could not read firebase-applet-config.json:', e);
}

// Check for Service Account Key (for Hostinger and custom servers)
let adminDb: any = null;

async function initAdminIfNeeded() {
  if (adminDb) return adminDb;

  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (saKey || gac) {
    try {
      const { initializeApp, cert } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');

      let credentialObj;
      if (saKey) {
        credentialObj = JSON.parse(saKey);
      } else if (gac && fs.existsSync(gac)) {
        credentialObj = JSON.parse(fs.readFileSync(gac, 'utf-8'));
      }

      if (credentialObj) {
        const app = initializeApp({
          credential: cert(credentialObj),
          projectId: config.projectId
        }, `admin_app_${Date.now()}`);

        adminDb = getFirestore(app, config.firestoreDatabaseId || '(default)');
        console.log('Firebase Admin SDK initialized successfully with Service Account Key');
        return adminDb;
      }
    } catch (err) {
      console.warn('Could not initialize Firebase Admin SDK, falling back to Firestore Direct Engine:', err);
    }
  }
  return null;
}

// Convert JS Value to Firestore Value
export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// Convert Firestore Value to JS Value
export function fromFirestoreValue(field: any): any {
  if (!field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('booleanValue' in field) return field.booleanValue;
  if ('nullValue' in field) return null;
  if ('arrayValue' in field) {
    return (field.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in field) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

export function docToJs<T>(doc: any): T {
  if (!doc || !doc.fields) return doc as T;
  const res: any = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    res[k] = fromFirestoreValue(v);
  }
  if (!res.id && doc.name) {
    const parts = doc.name.split('/');
    res.id = parts[parts.length - 1];
  }
  return res as T;
}

function getBaseUrl(collectionPath?: string) {
  const base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  if (collectionPath) {
    return `${base}/${collectionPath}`;
  }
  return base;
}

export interface ListOptions {
  page?: number;
  pageSize?: number;
  limit?: number;
  offset?: number;
  startAfter?: string;
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  status?: string;
  search?: string;
  searchFields?: string[];
  filterFn?: (item: any) => boolean;
}

/**
 * Get document by collection and ID
 */
export async function getDoc<T = any>(collection: string, id: string): Promise<T | null> {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      const snap = await admin.collection(collection).doc(id).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() } as T;
    } catch (err: any) {
      console.warn(`Admin getDoc error on ${collection}/${id}: ${err.message}. Falling back to REST.`);
    }
  }

  const url = `${getBaseUrl(collection)}/${encodeURIComponent(id)}?key=${config.apiKey}`;
  try {
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Firestore GET error (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    return docToJs<T>(data);
  } catch (err: any) {
    console.error(`getDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}

/**
 * Create or replace document by ID
 */
export async function setDoc<T extends Record<string, any>>(
  collection: string,
  id: string,
  data: T,
  merge: boolean = false
): Promise<void> {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      await admin.collection(collection).doc(id).set(data, { merge });
      return;
    } catch (err: any) {
      console.warn(`Admin setDoc error on ${collection}/${id}: ${err.message}. Falling back to REST.`);
    }
  }

  const cleanData: any = { ...data };
  if (!cleanData.id) cleanData.id = id;

  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(cleanData)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }

  let url = `${getBaseUrl(collection)}/${encodeURIComponent(id)}?key=${config.apiKey}`;
  if (merge) {
    const mask = Object.keys(cleanData).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    url += `&${mask}`;
  }

  try {
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Firestore setDoc error (${resp.status}): ${errText}`);
    }
  } catch (err: any) {
    console.error(`setDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}

/**
 * Delete document by ID
 */
export async function deleteDoc(collection: string, id: string): Promise<boolean> {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      await admin.collection(collection).doc(id).delete();
      return true;
    } catch (err: any) {
      console.warn(`Admin deleteDoc error on ${collection}/${id}: ${err.message}. Falling back to REST.`);
    }
  }

  const url = `${getBaseUrl(collection)}/${encodeURIComponent(id)}?key=${config.apiKey}`;
  try {
    const resp = await fetch(url, { method: 'DELETE' });
    if (resp.status === 404) return false;
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Firestore deleteDoc error (${resp.status}): ${errText}`);
    }
    return true;
  } catch (err: any) {
    console.error(`deleteDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}

/**
 * List documents with pagination, sorting, search, and filtering
 */
export async function listDocs<T = any>(
  collection: string,
  options: ListOptions = {}
): Promise<{ docs: T[]; total: number; page: number; pageSize: number; hasMore: boolean; nextCursor?: string }> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.max(1, Math.min(500, options.pageSize || options.limit || 50));
  const offset = options.offset !== undefined ? options.offset : (page - 1) * pageSize;

  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      let q = admin.collection(collection);
      if (options.status && options.status !== 'all') {
        q = q.where('status', '==', options.status);
      }
      if (options.orderByField) {
        q = q.orderBy(options.orderByField, options.orderDirection || 'desc');
      }

      const snap = await q.get();
      let allDocs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as T[];

      // Client-side search / filter
      if (options.filterFn) {
        allDocs = allDocs.filter(options.filterFn);
      }
      if (options.search) {
        const query = options.search.toLowerCase().trim();
        const fields = options.searchFields || ['name', 'businessName', 'invoiceNumber', 'quoteNumber', 'customerName', 'phone', 'email'];
        allDocs = allDocs.filter((item: any) =>
          fields.some(f => item[f] && String(item[f]).toLowerCase().includes(query))
        );
      }

      const total = allDocs.length;
      const paginated = allDocs.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < total;
      const nextCursor = paginated.length > 0 ? (paginated[paginated.length - 1] as any).id : undefined;

      return {
        docs: paginated,
        total,
        page,
        pageSize,
        hasMore,
        nextCursor
      };
    } catch (err: any) {
      console.warn(`Admin listDocs error on ${collection}: ${err.message}. Falling back to REST.`);
    }
  }

  // REST API Implementation via runQuery
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:runQuery?key=${config.apiKey}`;
    
    const structuredQuery: any = {
      from: [{ collectionId: collection }]
    };

    if (options.status && options.status !== 'all') {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: options.status }
        }
      };
    }

    if (options.orderByField) {
      structuredQuery.orderBy = [{
        field: { fieldPath: options.orderByField },
        direction: (options.orderDirection || 'desc').toUpperCase() === 'ASC' ? 'ASCENDING' : 'DESCENDING'
      }];
    }

    // When no search or client-side filter is specified, we can query natively with limit/offset
    const hasClientFilter = Boolean(options.filterFn || options.search);
    if (!hasClientFilter) {
      structuredQuery.limit = pageSize;
      if (offset > 0) {
        structuredQuery.offset = offset;
      }
    } else {
      // Query up to 1000 items to filter and page in memory
      structuredQuery.limit = 1000;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery })
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Firestore runQuery error (${resp.status}): ${text}`);
    }

    const results = await resp.json();
    let allItems: T[] = [];
    if (Array.isArray(results)) {
      for (const res of results) {
        if (res.document) {
          allItems.push(docToJs<T>(res.document));
        }
      }
    }

    if (hasClientFilter) {
      if (options.filterFn) {
        allItems = allItems.filter(options.filterFn);
      }
      if (options.search) {
        const query = options.search.toLowerCase().trim();
        const fields = options.searchFields || ['name', 'businessName', 'invoiceNumber', 'quoteNumber', 'customerName', 'phone', 'email'];
        allItems = allItems.filter((item: any) =>
          fields.some(f => item[f] && String(item[f]).toLowerCase().includes(query)) ||
          (item.client?.name && item.client.name.toLowerCase().includes(query)) ||
          (item.clientName && item.clientName.toLowerCase().includes(query))
        );
      }
      const total = allItems.length;
      const paginated = allItems.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < total;
      const nextCursor = paginated.length > 0 ? (paginated[paginated.length - 1] as any).id : undefined;

      return {
        docs: paginated,
        total,
        page,
        pageSize,
        hasMore,
        nextCursor
      };
    }

    // Direct paginated
    const totalCount = await countDocs(collection, options.status);
    const hasMore = offset + allItems.length < totalCount;
    const nextCursor = allItems.length > 0 ? (allItems[allItems.length - 1] as any).id : undefined;

    return {
      docs: allItems,
      total: totalCount,
      page,
      pageSize,
      hasMore,
      nextCursor
    };
  } catch (err: any) {
    console.error(`listDocs error on ${collection}:`, err);
    throw err;
  }
}

/**
 * Efficiently count documents using Firestore Native Aggregations
 */
export async function countDocs(collection: string, filterStatus?: string): Promise<number> {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      let q = admin.collection(collection);
      if (filterStatus && filterStatus !== 'all') {
        q = q.where('status', '==', filterStatus);
      }
      const snap = await q.count().get();
      return snap.data().count;
    } catch (err: any) {
      console.warn(`Admin countDocs error: ${err.message}. Falling back to REST.`);
    }
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:runAggregationQuery?key=${config.apiKey}`;
    const structuredQuery: any = {
      from: [{ collectionId: collection }]
    };
    if (filterStatus && filterStatus !== 'all') {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: filterStatus }
        }
      };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery,
          aggregations: [{ alias: 'total_count', count: {} }]
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data[0]?.result?.aggregateFields?.total_count) {
        return Number(data[0].result.aggregateFields.total_count.integerValue || 0);
      }
    }
  } catch (e) {
    console.warn(`Native aggregation failed on ${collection}, falling back to list count:`, e);
  }

  // Fallback: list docs count
  const res = await listDocs(collection, { pageSize: 500 });
  return res.total;
}

/**
 * Batch write multiple documents into a collection
 */
export async function batchSet(collection: string, items: Array<{ id: string; data: any }>): Promise<void> {
  if (items.length === 0) return;

  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      const chunks = [];
      const CHUNK_SIZE = 450; // Firestore limit 500 ops per batch
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        chunks.push(items.slice(i, i + CHUNK_SIZE));
      }
      for (const chunk of chunks) {
        const batch = admin.batch();
        for (const item of chunk) {
          batch.set(admin.collection(collection).doc(item.id), item.data, { merge: true });
        }
        await batch.commit();
      }
      return;
    } catch (err: any) {
      console.warn(`Admin batchSet error: ${err.message}. Falling back to individual REST sets.`);
    }
  }

  // REST Batching (Concurrent workers with concurrency limit)
  const CONCURRENCY = 10;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(item => setDoc(collection, item.id, item.data, true)));
  }
}
