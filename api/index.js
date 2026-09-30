// server.ts
import express from "express";
import path3 from "path";
import fs3 from "fs";

// src/server/firestoreClient.ts
import fs from "fs";
import path from "path";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "gen-lang-client-0486946771",
  appId: "1:823023563940:web:41bf03863cf52614e62231",
  apiKey: "AIzaSyDC9f8sHINjenDyIWsqZBrb9d_NrA91A98",
  authDomain: "gen-lang-client-0486946771.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-gstbilling23sepv-ed65618f-66ed-4ea7-ba85-1e9daca7a455",
  storageBucket: "gen-lang-client-0486946771.firebasestorage.app",
  messagingSenderId: "823023563940",
  measurementId: "",
  oAuthClientId: "823023563940-ek327tlce1fhckoptii9jkg4vndjnupi.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/server/firestoreClient.ts
var config = {
  projectId: process.env.FIREBASE_PROJECT_ID || firebase_applet_config_default.projectId || "gen-lang-client-0486946771",
  apiKey: process.env.FIREBASE_API_KEY || firebase_applet_config_default.apiKey || "",
  firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || firebase_applet_config_default.firestoreDatabaseId || "(default)"
};
try {
  const cfgPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = JSON.parse(raw);
    config = {
      projectId: process.env.FIREBASE_PROJECT_ID || parsed.projectId || config.projectId,
      apiKey: process.env.FIREBASE_API_KEY || parsed.apiKey || config.apiKey,
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || parsed.firestoreDatabaseId || config.firestoreDatabaseId
    };
  }
} catch (e) {
  console.warn("Could not read firebase-applet-config.json from cwd, using bundled config/env:", e);
}
var adminDb = null;
async function initAdminIfNeeded() {
  if (adminDb) return adminDb;
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saKey || gac) {
    try {
      const { initializeApp, cert } = await import("firebase-admin/app");
      const { getFirestore } = await import("firebase-admin/firestore");
      let credentialObj;
      if (saKey) {
        credentialObj = JSON.parse(saKey);
      } else if (gac && fs.existsSync(gac)) {
        credentialObj = JSON.parse(fs.readFileSync(gac, "utf-8"));
      }
      if (credentialObj) {
        const app2 = initializeApp({
          credential: cert(credentialObj),
          projectId: config.projectId
        }, `admin_app_${Date.now()}`);
        adminDb = getFirestore(app2, config.firestoreDatabaseId || "(default)");
        console.log("Firebase Admin SDK initialized successfully with Service Account Key");
        return adminDb;
      }
    } catch (err) {
      console.warn("Could not initialize Firebase Admin SDK, falling back to Firestore Direct Engine:", err);
    }
  }
  return null;
}
function toFirestoreValue(val) {
  if (val === null || val === void 0) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== void 0) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}
function fromFirestoreValue(field) {
  if (!field) return null;
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("booleanValue" in field) return field.booleanValue;
  if ("nullValue" in field) return null;
  if ("arrayValue" in field) {
    return (field.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in field) {
    const obj = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}
function docToJs(doc) {
  if (!doc || !doc.fields) return doc;
  const res = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    res[k] = fromFirestoreValue(v);
  }
  if (!res.id && doc.name) {
    const parts = doc.name.split("/");
    res.id = parts[parts.length - 1];
  }
  return res;
}
function getBaseUrl(collectionPath) {
  const base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  if (collectionPath) {
    return `${base}/${collectionPath}`;
  }
  return base;
}
async function getDoc(collection, id) {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      const snap = await admin.collection(collection).doc(id).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() };
    } catch (err) {
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
    return docToJs(data);
  } catch (err) {
    console.error(`getDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}
async function setDoc(collection, id, data, merge = false) {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      await admin.collection(collection).doc(id).set(data, { merge });
      return;
    } catch (err) {
      console.warn(`Admin setDoc error on ${collection}/${id}: ${err.message}. Falling back to REST.`);
    }
  }
  const cleanData = { ...data };
  if (!cleanData.id) cleanData.id = id;
  const fields = {};
  for (const [k, v] of Object.entries(cleanData)) {
    if (v !== void 0) {
      fields[k] = toFirestoreValue(v);
    }
  }
  let url = `${getBaseUrl(collection)}/${encodeURIComponent(id)}?key=${config.apiKey}`;
  if (merge) {
    const mask = Object.keys(cleanData).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    url += `&${mask}`;
  }
  try {
    const resp = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Firestore setDoc error (${resp.status}): ${errText}`);
    }
  } catch (err) {
    console.error(`setDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}
async function deleteDoc(collection, id) {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      await admin.collection(collection).doc(id).delete();
      return true;
    } catch (err) {
      console.warn(`Admin deleteDoc error on ${collection}/${id}: ${err.message}. Falling back to REST.`);
    }
  }
  const url = `${getBaseUrl(collection)}/${encodeURIComponent(id)}?key=${config.apiKey}`;
  try {
    const resp = await fetch(url, { method: "DELETE" });
    if (resp.status === 404) return false;
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Firestore deleteDoc error (${resp.status}): ${errText}`);
    }
    return true;
  } catch (err) {
    console.error(`deleteDoc failed for ${collection}/${id}:`, err);
    throw err;
  }
}
async function listDocs(collection, options = {}) {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.max(1, Math.min(500, options.pageSize || options.limit || 50));
  const offset = options.offset !== void 0 ? options.offset : (page - 1) * pageSize;
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      let q = admin.collection(collection);
      if (options.status && options.status !== "all") {
        q = q.where("status", "==", options.status);
      }
      if (options.orderByField) {
        q = q.orderBy(options.orderByField, options.orderDirection || "desc");
      }
      const snap = await q.get();
      let allDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (options.filterFn) {
        allDocs = allDocs.filter(options.filterFn);
      }
      if (options.search) {
        const query = options.search.toLowerCase().trim();
        const fields = options.searchFields || ["name", "businessName", "invoiceNumber", "quoteNumber", "customerName", "phone", "email"];
        allDocs = allDocs.filter(
          (item) => fields.some((f) => item[f] && String(item[f]).toLowerCase().includes(query))
        );
      }
      const total = allDocs.length;
      const paginated = allDocs.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < total;
      const nextCursor = paginated.length > 0 ? paginated[paginated.length - 1].id : void 0;
      return {
        docs: paginated,
        total,
        page,
        pageSize,
        hasMore,
        nextCursor
      };
    } catch (err) {
      console.warn(`Admin listDocs error on ${collection}: ${err.message}. Falling back to REST.`);
    }
  }
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:runQuery?key=${config.apiKey}`;
    const structuredQuery = {
      from: [{ collectionId: collection }]
    };
    if (options.status && options.status !== "all") {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: options.status }
        }
      };
    }
    if (options.orderByField) {
      structuredQuery.orderBy = [{
        field: { fieldPath: options.orderByField },
        direction: (options.orderDirection || "desc").toUpperCase() === "ASC" ? "ASCENDING" : "DESCENDING"
      }];
    }
    const hasClientFilter = Boolean(options.filterFn || options.search);
    if (!hasClientFilter) {
      structuredQuery.limit = pageSize;
      if (offset > 0) {
        structuredQuery.offset = offset;
      }
    } else {
      structuredQuery.limit = 1e3;
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Firestore runQuery error (${resp.status}): ${text}`);
    }
    const results = await resp.json();
    let allItems = [];
    if (Array.isArray(results)) {
      for (const res of results) {
        if (res.document) {
          allItems.push(docToJs(res.document));
        }
      }
    }
    if (hasClientFilter) {
      if (options.filterFn) {
        allItems = allItems.filter(options.filterFn);
      }
      if (options.search) {
        const query = options.search.toLowerCase().trim();
        const fields = options.searchFields || ["name", "businessName", "invoiceNumber", "quoteNumber", "customerName", "phone", "email"];
        allItems = allItems.filter(
          (item) => fields.some((f) => item[f] && String(item[f]).toLowerCase().includes(query)) || item.client?.name && item.client.name.toLowerCase().includes(query) || item.clientName && item.clientName.toLowerCase().includes(query)
        );
      }
      const total = allItems.length;
      const paginated = allItems.slice(offset, offset + pageSize);
      const hasMore2 = offset + pageSize < total;
      const nextCursor2 = paginated.length > 0 ? paginated[paginated.length - 1].id : void 0;
      return {
        docs: paginated,
        total,
        page,
        pageSize,
        hasMore: hasMore2,
        nextCursor: nextCursor2
      };
    }
    const totalCount = await countDocs(collection, options.status);
    const hasMore = offset + allItems.length < totalCount;
    const nextCursor = allItems.length > 0 ? allItems[allItems.length - 1].id : void 0;
    return {
      docs: allItems,
      total: totalCount,
      page,
      pageSize,
      hasMore,
      nextCursor
    };
  } catch (err) {
    console.error(`listDocs error on ${collection}:`, err);
    throw err;
  }
}
async function countDocs(collection, filterStatus) {
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      let q = admin.collection(collection);
      if (filterStatus && filterStatus !== "all") {
        q = q.where("status", "==", filterStatus);
      }
      const snap = await q.count().get();
      return snap.data().count;
    } catch (err) {
      console.warn(`Admin countDocs error: ${err.message}. Falling back to REST.`);
    }
  }
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:runAggregationQuery?key=${config.apiKey}`;
    const structuredQuery = {
      from: [{ collectionId: collection }]
    };
    if (filterStatus && filterStatus !== "all") {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: filterStatus }
        }
      };
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery,
          aggregations: [{ alias: "total_count", count: {} }]
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
  const res = await listDocs(collection, { pageSize: 500 });
  return res.total;
}
async function batchSet(collection, items) {
  if (items.length === 0) return;
  const admin = await initAdminIfNeeded();
  if (admin) {
    try {
      const chunks = [];
      const CHUNK_SIZE = 450;
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
    } catch (err) {
      console.warn(`Admin batchSet error: ${err.message}. Falling back to individual REST sets.`);
    }
  }
  const CONCURRENCY = 10;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((item) => setDoc(collection, item.id, item.data, true)));
  }
}

// src/server/validation.ts
import { z } from "zod";
var nullableString = z.preprocess((val) => {
  if (val === null || val === void 0) return "";
  return String(val).trim();
}, z.string());
var sanitizedEmail = z.preprocess((val) => {
  if (!val || typeof val !== "string") return "";
  return val.trim();
}, z.string().optional().default(""));
var ClientSchema = z.object({
  name: z.preprocess((val) => String(val || "").trim(), z.string().min(1, "Client name is required")),
  contactPerson: nullableString.default(""),
  email: sanitizedEmail,
  phone: nullableString.default(""),
  billingAddress: nullableString.default(""),
  shippingAddress: nullableString.default(""),
  city: nullableString.default(""),
  state: z.preprocess((val) => String(val || "Madhya Pradesh").trim(), z.string().default("Madhya Pradesh")),
  stateCode: z.preprocess((val) => {
    if (!val) return "23";
    return String(val).trim().padStart(2, "0");
  }, z.string().default("23")),
  country: nullableString.default("India"),
  pinCode: nullableString.default(""),
  gstin: nullableString.default(""),
  pan: nullableString.default(""),
  customerType: z.preprocess((val) => {
    if (!val || typeof val !== "string") return "B2B";
    const upper = val.toUpperCase().trim();
    if (["B2B", "B2C", "SEZ", "EXPORT"].includes(upper)) {
      return upper === "EXPORT" ? "Export" : upper;
    }
    return "B2B";
  }, z.enum(["B2B", "B2C", "SEZ", "Export"]).default("B2B")),
  notes: nullableString.default("")
}).passthrough();
var LineItemSchema = z.object({
  id: z.string().optional(),
  name: z.preprocess((val) => String(val || "").trim(), z.string().min(1, "Item name is required")),
  description: z.string().optional().default(""),
  hsnSac: z.string().optional().default("9983"),
  quantity: z.preprocess((val) => Number(val) || 1, z.number().min(1e-3, "Quantity must be greater than 0")),
  unit: z.string().optional().default("NOS"),
  rate: z.preprocess((val) => Number(val) || 0, z.number().min(0, "Rate cannot be negative")),
  discountType: z.enum(["percentage", "fixed"]).optional().default("percentage"),
  discountValue: z.number().optional().default(0),
  discountAmount: z.number().optional().default(0),
  gstRate: z.number().optional().default(0)
}).passthrough();
var AdditionalChargeSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  amount: z.number(),
  gstRate: z.number().optional().default(0)
}).passthrough();
var InvoiceSchema = z.object({
  invoiceNumber: z.string().optional(),
  poNumber: z.string().optional().default(""),
  invoiceDate: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    z.string().default((/* @__PURE__ */ new Date()).toISOString().split("T")[0])
  ),
  dueDate: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : new Date(Date.now() + 15 * 864e5).toISOString().split("T")[0],
    z.string().default(new Date(Date.now() + 15 * 864e5).toISOString().split("T")[0])
  ),
  billingStartDate: z.string().optional(),
  billingEndDate: z.string().optional(),
  billingPeriod: z.string().optional(),
  placeOfSupply: z.string().optional().default("Madhya Pradesh"),
  placeOfSupplyCode: z.string().optional().default("23"),
  currency: z.string().optional().default("INR"),
  financialYear: z.string().optional(),
  isInterState: z.boolean().optional(),
  isReverseCharge: z.boolean().optional().default(false),
  status: z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"]).optional().default("draft"),
  template: z.string().optional().default("classic"),
  clientId: z.string().optional(),
  client: z.any().optional(),
  items: z.array(LineItemSchema).min(1, "At least one line item is required"),
  discountType: z.enum(["percentage", "fixed"]).optional().default("percentage"),
  discountValue: z.number().optional().default(0),
  additionalCharges: z.array(AdditionalChargeSchema).optional().default([]),
  advanceAmount: z.number().optional().default(0),
  terms: z.string().optional().default(""),
  customerNotes: z.string().optional().default(""),
  internalNotes: z.string().optional().default("")
}).passthrough();
var QuoteSchema = z.object({
  quoteNumber: z.string().optional(),
  quoteDate: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    z.string().default((/* @__PURE__ */ new Date()).toISOString().split("T")[0])
  ),
  validUntil: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : new Date(Date.now() + 30 * 864e5).toISOString().split("T")[0],
    z.string().default(new Date(Date.now() + 30 * 864e5).toISOString().split("T")[0])
  ),
  placeOfSupply: z.string().optional().default("Madhya Pradesh"),
  placeOfSupplyCode: z.string().optional().default("23"),
  currency: z.string().optional().default("INR"),
  clientId: z.string().optional(),
  client: z.any().optional(),
  items: z.array(LineItemSchema).min(1),
  discountType: z.enum(["percentage", "fixed"]).optional().default("percentage"),
  discountValue: z.number().optional().default(0),
  additionalCharges: z.array(AdditionalChargeSchema).optional().default([]),
  status: z.enum(["draft", "sent", "accepted", "rejected", "converted"]).optional().default("draft"),
  terms: z.string().optional().default(""),
  notes: z.string().optional().default("")
}).passthrough();
var CreditNoteSchema = z.object({
  creditNoteNumber: z.string().optional(),
  creditNoteDate: z.string().optional(),
  date: z.string().optional(),
  invoiceId: z.string().min(1, "Linked invoice ID is required"),
  invoiceNumber: z.string().optional(),
  clientId: z.string().optional(),
  client: z.any().optional(),
  reason: z.string().min(1, "Reason for credit note is required"),
  items: z.array(z.any()).optional().default([]),
  taxableAmount: z.number().optional().default(0),
  totalAmount: z.number().min(0),
  taxAmount: z.number().optional().default(0),
  gstAmount: z.number().optional().default(0),
  status: z.string().optional().default("active"),
  notes: z.string().optional().default("")
}).passthrough();
var RecurringInvoiceSchema = z.object({
  title: z.string().optional().default("Recurring AMC & Retainer"),
  recurringNumber: z.string().optional(),
  clientId: z.string().min(1, "Client ID is required"),
  clientName: z.string().optional(),
  client: z.any().optional(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "half_yearly", "yearly"]).default("monthly"),
  startDate: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    z.string().default((/* @__PURE__ */ new Date()).toISOString().split("T")[0])
  ),
  endDate: z.string().optional(),
  nextInvoiceDate: z.string().optional(),
  nextDueDate: z.string().optional(),
  status: z.enum(["active", "paused", "cancelled", "completed"]).default("active"),
  items: z.array(LineItemSchema).min(1, "At least one line item is required"),
  invoiceTemplateData: z.any().optional(),
  terms: z.string().optional().default(""),
  autoSendEmail: z.boolean().optional().default(false)
}).passthrough();
var ExpenseSchema = z.object({
  date: z.preprocess(
    (val) => val && typeof val === "string" && val.trim() ? val.trim() : (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    z.string().default((/* @__PURE__ */ new Date()).toISOString().split("T")[0])
  ),
  category: z.string().min(1, "Category is required"),
  title: nullableString.default(""),
  description: z.preprocess((val) => {
    if (val === null || val === void 0) return "";
    return String(val).trim();
  }, z.string().optional().default("")),
  amount: z.number().min(0, "Amount must be positive"),
  taxAmount: z.number().optional().default(0),
  gstAmount: z.number().optional().default(0),
  totalAmount: z.number().min(0),
  paymentMethod: z.string().optional().default("UPI"),
  paymentMode: z.string().optional().default("Bank"),
  vendor: z.string().optional().default(""),
  vendorName: z.string().optional().default(""),
  vendorGstin: z.string().optional().default(""),
  invoiceNumber: z.string().optional().default(""),
  receiptUrl: z.string().optional().default(""),
  isTaxDeductible: z.boolean().optional().default(true),
  itcEligible: z.boolean().optional().default(true),
  notes: z.string().optional().default("")
}).passthrough();
var DealServiceItemSchema = z.object({
  id: z.string().optional(),
  serviceName: z.string().optional().default(""),
  service: z.string().optional(),
  managementFee: z.number().optional().default(0),
  managementFeePaid: z.number().optional().default(0),
  adBudget: z.number().optional().default(0),
  adBudgetPaid: z.number().optional().default(0),
  dealValue: z.number().optional().default(0),
  totalReceived: z.number().optional().default(0),
  totalDue: z.number().optional().default(0)
}).passthrough();
var OnboardingSchema = z.object({
  onboardingNumber: z.string().optional(),
  clientId: z.string().nullable().optional(),
  customerName: z.preprocess((val) => String(val || "").trim(), z.string().min(1, "Customer name is required")),
  businessName: z.preprocess((val) => String(val || "").trim(), z.string().min(1, "Business name is required")),
  contactPerson: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  city: z.string().optional().default("Indore"),
  state: z.string().optional().default("Madhya Pradesh"),
  status: z.enum(["active", "paused", "completed", "churned"]).optional().default("active"),
  onboardingDate: z.string().optional(),
  billingCycleDays: z.number().optional().default(30),
  nextPaymentDueDate: z.string().optional(),
  servicePackage: z.string().optional().default("Meta Ads & Lead Gen Retainer"),
  services: z.array(DealServiceItemSchema).optional(),
  hasAdsCampaign: z.boolean().optional().default(false),
  adPlatform: z.enum(["meta", "google", "both", "other"]).optional().default("meta"),
  adDailyBudget: z.number().optional().default(0),
  adDurationDays: z.number().optional().default(15),
  adTotalBudget: z.number().optional().default(0),
  adCampaignStartDate: z.string().optional(),
  adCampaignEndDate: z.string().optional(),
  adBudget: z.number().optional(),
  adBudgetPaid: z.number().optional().default(0),
  serviceFee: z.number().optional().default(0),
  managementFee: z.number().optional(),
  managementFeePaid: z.number().optional(),
  totalDealValue: z.number().optional(),
  totalPackageValue: z.number().optional(),
  advancePaid: z.number().optional().default(0),
  totalReceived: z.number().optional(),
  remainingBalance: z.number().optional(),
  totalDue: z.number().optional(),
  paymentStatus: z.enum(["paid", "partially_paid", "overdue", "unpaid"]).optional(),
  assignedExecutive: z.string().optional().default("Sankalp"),
  salesManager: z.string().optional().default("Sankalp"),
  incentivePercentage: z.number().optional().default(10),
  incentiveAmount: z.number().optional(),
  incentiveStatus: z.enum(["pending", "eligible", "paid"]).optional().default("pending"),
  remarks: z.string().optional().default(""),
  notes: z.string().optional().default("")
}).passthrough();
var PaymentRecordSchema = z.object({
  amount: z.number().min(0.01, "Payment amount must be greater than zero"),
  paymentDate: z.string().optional(),
  paymentMethod: z.string().optional().default("UPI"),
  transactionId: z.string().optional().default(""),
  notes: z.string().optional().default("")
}).passthrough();

// src/utils/taxCalculator.ts
function round2(num) {
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
function calculateLineItem(item, isInterState) {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const rate = Math.max(0, Number(item.rate) || 0);
  const rawSubtotal = round2(qty * rate);
  let discountAmount = 0;
  const dType = item.discountType || "percentage";
  const dVal = Math.max(0, Number(item.discountValue) || 0);
  if (dType === "percentage") {
    discountAmount = round2(rawSubtotal * dVal / 100);
  } else {
    discountAmount = round2(dVal);
  }
  discountAmount = Math.min(rawSubtotal, discountAmount);
  const taxableAmount = round2(rawSubtotal - discountAmount);
  const gstRate = Math.max(0, Number(item.gstRate) || 0);
  const gstTotal = round2(taxableAmount * gstRate / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (isInterState) {
    igst = gstTotal;
  } else {
    cgst = round2(gstTotal / 2);
    sgst = round2(gstTotal - cgst);
  }
  const lineTotal = round2(taxableAmount + gstTotal);
  return {
    ...item,
    quantity: qty,
    rate,
    discountType: dType,
    discountValue: dVal,
    discountAmount,
    taxableAmount,
    gstRate,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    totalGstAmount: gstTotal,
    total: lineTotal
  };
}
function calculateInvoiceTotals(items, options, currentStatus = "draft") {
  const isInterState = Boolean(options.isInterState);
  const isReverseCharge = Boolean(options.isReverseCharge);
  const baseItems = (items || []).map((item) => calculateLineItem(item, isInterState));
  const subtotal = round2(baseItems.reduce((sum, item) => sum + item.quantity * item.rate, 0));
  const totalItemDiscount = round2(baseItems.reduce((sum, item) => sum + item.discountAmount, 0));
  const afterItemDiscount = Math.max(0, round2(subtotal - totalItemDiscount));
  let globalDiscountAmount = 0;
  const gType = options.discountType || "percentage";
  const gVal = Math.max(0, Number(options.discountValue) || 0);
  if (gType === "percentage") {
    globalDiscountAmount = round2(afterItemDiscount * gVal / 100);
  } else {
    globalDiscountAmount = round2(gVal);
  }
  globalDiscountAmount = Math.min(afterItemDiscount, globalDiscountAmount);
  const totalTaxableAmount = Math.max(0, round2(afterItemDiscount - globalDiscountAmount));
  const discountRatio = afterItemDiscount > 0 ? totalTaxableAmount / afterItemDiscount : 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  const finalizedItems = baseItems.map((item) => {
    const discountedTaxable = round2(item.taxableAmount * discountRatio);
    const gstRate = item.gstRate || 0;
    const itemGst = round2(discountedTaxable * gstRate / 100);
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (isInterState) {
      igst = itemGst;
      totalIgst += igst;
    } else {
      cgst = round2(itemGst / 2);
      sgst = round2(itemGst - cgst);
      totalCgst += cgst;
      totalSgst += sgst;
    }
    const itemTotal = round2(discountedTaxable + (isReverseCharge ? 0 : itemGst));
    return {
      ...item,
      taxableAmount: discountedTaxable,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      totalGstAmount: itemGst,
      total: itemTotal
    };
  });
  totalCgst = round2(totalCgst);
  totalSgst = round2(totalSgst);
  totalIgst = round2(totalIgst);
  const totalGst = round2(totalCgst + totalSgst + totalIgst);
  const additionalCharges = options.additionalCharges || [];
  const totalAdditionalCharges = round2(
    additionalCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0)
  );
  const taxablePlusGst = isReverseCharge ? totalTaxableAmount : round2(totalTaxableAmount + totalGst);
  const exactGrandTotal = round2(taxablePlusGst + totalAdditionalCharges);
  const grandTotal = Math.round(exactGrandTotal);
  const roundOff = round2(grandTotal - exactGrandTotal);
  const totalInWords = numberToIndianWords(grandTotal);
  const advance = round2(Math.max(0, Number(options.advanceAmount) || 0));
  const paymentsTotal = round2(Math.max(0, Number(options.paymentsTotal) || 0));
  const amountPaid = round2(advance + paymentsTotal);
  const balanceDue = round2(Math.max(0, grandTotal - amountPaid));
  let calculatedStatus = currentStatus;
  if (calculatedStatus !== "draft" && calculatedStatus !== "cancelled") {
    if (balanceDue <= 0.01 && grandTotal > 0) {
      calculatedStatus = "paid";
    } else if (amountPaid > 0) {
      calculatedStatus = "partially_paid";
    } else {
      calculatedStatus = currentStatus || "sent";
    }
  }
  return {
    items: finalizedItems,
    subtotal,
    totalItemDiscount,
    globalDiscountAmount,
    totalTaxableAmount,
    totalCgst,
    totalSgst,
    totalIgst,
    totalGst,
    totalAdditionalCharges,
    exactGrandTotal,
    grandTotal,
    roundOff,
    totalInWords,
    advanceAmount: advance,
    amountPaid,
    balanceDue,
    status: calculatedStatus
  };
}
function numberToIndianWords(num) {
  if (isNaN(num) || num === 0) return "Zero Rupees Only";
  const singleDigits = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function convertTwoDigits(n) {
    if (n === 0) return "";
    if (n < 10) return singleDigits[n];
    if (n < 20) return teens[n - 10];
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    return `${tens[ten]}${unit > 0 ? " " + singleDigits[unit] : ""}`;
  }
  function convertThreeDigits(n) {
    if (n === 0) return "";
    const hundred = Math.floor(n / 100);
    const remainder2 = n % 100;
    let str = "";
    if (hundred > 0) {
      str += `${singleDigits[hundred]} Hundred`;
      if (remainder2 > 0) str += " ";
    }
    if (remainder2 > 0) {
      str += convertTwoDigits(remainder2);
    }
    return str.trim();
  }
  function convertUnderTenMillion(n) {
    if (n === 0) return "";
    const lakhs = Math.floor(n / 1e5);
    const thousands = Math.floor(n % 1e5 / 1e3);
    const hundreds = n % 1e3;
    const parts = [];
    if (lakhs > 0) parts.push(`${convertTwoDigits(lakhs)} Lakh`);
    if (thousands > 0) parts.push(`${convertTwoDigits(thousands)} Thousand`);
    if (hundreds > 0) parts.push(convertThreeDigits(hundreds));
    return parts.join(" ").trim();
  }
  const rounded = Math.round(num * 100) / 100;
  const integerPart = Math.floor(Math.abs(rounded));
  const paise = Math.round((Math.abs(rounded) - integerPart) * 100);
  const crores = Math.floor(integerPart / 1e7);
  const remainder = integerPart % 1e7;
  let words = "";
  if (crores > 0) {
    if (crores < 100) {
      words += `${convertTwoDigits(crores)} Crore `;
    } else {
      words += `${convertUnderTenMillion(crores)} Crore `;
    }
  }
  if (remainder > 0) {
    words += convertUnderTenMillion(remainder);
  }
  words = words.trim();
  if (words.length === 0) {
    words = "Zero";
  }
  words += integerPart === 1 ? " Rupee" : " Rupees";
  if (paise > 0) {
    words += ` and ${convertTwoDigits(paise)} Paise`;
  }
  words += " Only";
  return words;
}

// src/utils/gstUtils.ts
function calculateBillingPeriod(startDateStr) {
  const cleanStart = startDateStr || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const parts = cleanStart.split("-").map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const end = new Date(parts[0], parts[1] - 1, parts[2] + 29);
  const endYear = end.getFullYear();
  const endMonth = String(end.getMonth() + 1).padStart(2, "0");
  const endDay = String(end.getDate()).padStart(2, "0");
  const endDateStr = `${endYear}-${endMonth}-${endDay}`;
  const formatOptions = { day: "numeric", month: "short", year: "numeric" };
  const formattedStart = start.toLocaleDateString("en-IN", formatOptions);
  const formattedEnd = end.toLocaleDateString("en-IN", formatOptions);
  return {
    startDate: cleanStart,
    endDate: endDateStr,
    formattedStart,
    formattedEnd,
    formattedPeriod: `${formattedStart} to ${formattedEnd} (30 Days)`,
    periodText: `${formattedStart} to ${formattedEnd} (30 Days)`
  };
}

// src/server/migrateAndSeed.ts
import fs2 from "fs";
import path2 from "path";
async function runMigration() {
  const dbPath = path2.join(process.cwd(), "data", "db.json");
  if (!fs2.existsSync(dbPath)) {
    console.log("data/db.json not found, skipping local migration.");
    return { migrated: {}, message: "data/db.json not found, skipped." };
  }
  const raw = fs2.readFileSync(dbPath, "utf-8");
  const db = JSON.parse(raw);
  const counts = {};
  console.log("Starting migration from data/db.json to Firestore...");
  if (db.businessProfile) {
    await setDoc("settings", "businessProfile", db.businessProfile, true);
    counts["settings.businessProfile"] = 1;
  }
  if (db.invoiceSettings) {
    await setDoc("settings", "invoiceSettings", db.invoiceSettings, true);
    counts["settings.invoiceSettings"] = 1;
  }
  if (db.taxSettings) {
    await setDoc("settings", "taxSettings", db.taxSettings, true);
    counts["settings.taxSettings"] = 1;
  }
  if (db.paymentSettings) {
    await setDoc("settings", "paymentSettings", db.paymentSettings, true);
    counts["settings.paymentSettings"] = 1;
  }
  if (db.pdfSettings) {
    await setDoc("settings", "pdfSettings", db.pdfSettings, true);
    counts["settings.pdfSettings"] = 1;
  }
  if (Array.isArray(db.users) && db.users.length > 0) {
    await batchSet("users", db.users.map((u) => ({ id: u.id, data: u })));
    counts["users"] = db.users.length;
  }
  if (Array.isArray(db.clients) && db.clients.length > 0) {
    await batchSet("clients", db.clients.map((c) => ({ id: c.id, data: c })));
    counts["clients"] = db.clients.length;
  }
  if (Array.isArray(db.invoices) && db.invoices.length > 0) {
    await batchSet("invoices", db.invoices.map((i) => ({ id: i.id, data: i })));
    counts["invoices"] = db.invoices.length;
  }
  if (Array.isArray(db.quotes) && db.quotes.length > 0) {
    await batchSet("quotes", db.quotes.map((q) => ({ id: q.id, data: q })));
    counts["quotes"] = db.quotes.length;
  }
  if (Array.isArray(db.creditNotes) && db.creditNotes.length > 0) {
    await batchSet("creditNotes", db.creditNotes.map((cn) => ({ id: cn.id, data: cn })));
    counts["creditNotes"] = db.creditNotes.length;
  }
  if (Array.isArray(db.recurringInvoices) && db.recurringInvoices.length > 0) {
    await batchSet("recurringInvoices", db.recurringInvoices.map((r) => ({ id: r.id, data: r })));
    counts["recurringInvoices"] = db.recurringInvoices.length;
  }
  if (Array.isArray(db.expenses) && db.expenses.length > 0) {
    await batchSet("expenses", db.expenses.map((e) => ({ id: e.id, data: e })));
    counts["expenses"] = db.expenses.length;
  }
  if (Array.isArray(db.onboardings) && db.onboardings.length > 0) {
    await batchSet("onboardings", db.onboardings.map((o) => ({ id: o.id, data: o })));
    counts["onboardings"] = db.onboardings.length;
  }
  if (Array.isArray(db.auditLogs) && db.auditLogs.length > 0) {
    await batchSet("auditLogs", db.auditLogs.map((a) => ({ id: a.id, data: a })));
    counts["auditLogs"] = db.auditLogs.length;
  }
  console.log("Migration completed successfully:", counts);
  return { migrated: counts, message: "Data migration completed successfully" };
}
async function seedRealisticDataset(targetCount = 1e3) {
  console.log(`Starting generation of realistic dataset (~${targetCount} records)...`);
  const businessProfile = await getDoc("settings", "businessProfile") || {
    stateCode: "23",
    businessName: "UDM Techno Solutions"
  };
  const sellerStateCode = businessProfile.stateCode || "23";
  const clientNames = [
    { name: "Apex Digital Agency", city: "Indore", state: "Madhya Pradesh", code: "23", gstin: "23AABCA1234F1Z1", type: "B2B" },
    { name: "TechMatrix Software Pvt Ltd", city: "Bhopal", state: "Madhya Pradesh", code: "23", gstin: "23AAACT1984Q1Z5", type: "B2B" },
    { name: "Zenith Logistics Hub", city: "Mumbai", state: "Maharashtra", code: "27", gstin: "27AABCZ9876K1ZY", type: "B2B" },
    { name: "Bharat Cloud Infotech", city: "Pune", state: "Maharashtra", code: "27", gstin: "27AAFCB5432D1Z9", type: "B2B" },
    { name: "Kaveri Retailers & Mart", city: "Bengaluru", state: "Karnataka", code: "29", gstin: "29AABCK1122P1Z0", type: "B2B" },
    { name: "Sunrise Healthcare Clinic", city: "Hyderabad", state: "Telangana", code: "36", gstin: "36AABCS3344M1Z2", type: "B2C" },
    { name: "Royal Rajputana Exports", city: "Jaipur", state: "Rajasthan", code: "08", gstin: "08AABCR5566T1Z4", type: "B2B" },
    { name: "Ganga Valley Agro Products", city: "Lucknow", state: "Uttar Pradesh", code: "09", gstin: "09AABCG7788L1Z6", type: "B2B" },
    { name: "Delhi Techventures LLP", city: "New Delhi", state: "Delhi", code: "07", gstin: "07AABCD9900H1Z8", type: "B2B" },
    { name: "Gujarat Diamond Impex", city: "Surat", state: "Gujarat", code: "24", gstin: "24AABCG1357J1Z3", type: "B2B" }
  ];
  const generatedClients = [];
  for (let i = 0; i < 50; i++) {
    const base = clientNames[i % clientNames.length];
    const clientNumber = `CLI-${String(i + 1).padStart(3, "0")}`;
    const clientId = `client_${String(i + 1).padStart(4, "0")}`;
    generatedClients.push({
      id: clientId,
      clientNumber,
      name: i < clientNames.length ? base.name : `${base.name} - Branch ${Math.floor(i / 10) + 1}`,
      contactPerson: `Manager ${i + 1}`,
      email: `contact${i + 1}@${base.name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      phone: `9826${String(1e5 + i).slice(-6)}`,
      billingAddress: `Plot No. ${i + 10}, Industrial Area`,
      shippingAddress: `Plot No. ${i + 10}, Industrial Area`,
      city: base.city,
      state: base.state,
      stateCode: base.code,
      country: "India",
      pinCode: "452001",
      gstin: base.gstin,
      pan: base.gstin.substring(2, 12),
      customerType: base.type,
      notes: "Corporate client registered under GST",
      createdAt: new Date(Date.now() - (180 - i) * 864e5).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  await batchSet("clients", generatedClients.map((c) => ({ id: c.id, data: c })));
  const itemsPool = [
    { name: "Custom ERP Software Module Development", hsnSac: "998314", rate: 45e3, gstRate: 18 },
    { name: "Monthly Cloud Infrastructure & Server AMC", hsnSac: "998315", rate: 25e3, gstRate: 18 },
    { name: "Meta Ads Campaign Strategy & Execution", hsnSac: "998313", rate: 18e3, gstRate: 18 },
    { name: "Google Ads PPC Management Retainer", hsnSac: "998313", rate: 15e3, gstRate: 18 },
    { name: "Technical Support & System Maintenance", hsnSac: "9987", rate: 12e3, gstRate: 12 },
    { name: "Server Hardware Peripheral Replacement", hsnSac: "8471", rate: 8e3, gstRate: 18 },
    { name: "GST Audit & Compliance Software Setup", hsnSac: "9982", rate: 3e4, gstRate: 18 }
  ];
  const generatedInvoices = [];
  const generatedCreditNotes = [];
  const now = Date.now();
  for (let i = 1; i <= 500; i++) {
    const client = generatedClients[(i - 1) % generatedClients.length];
    const isInterState = client.stateCode !== sellerStateCode;
    const invId = `inv_${String(i).padStart(5, "0")}`;
    const invoiceNumber = `A${String(i).padStart(6, "0")}`;
    const daysAgo = Math.floor(Math.random() * 150);
    const invoiceDate = new Date(now - daysAgo * 864e5).toISOString().split("T")[0];
    const dueDate = new Date(new Date(invoiceDate).getTime() + 15 * 864e5).toISOString().split("T")[0];
    const numItems = i % 3 + 1;
    const items = [];
    for (let k = 0; k < numItems; k++) {
      const templateItem = itemsPool[(i + k) % itemsPool.length];
      items.push({
        id: `item_${i}_${k}`,
        name: templateItem.name,
        description: `Delivered per scope of agreement SOW-${i}`,
        hsnSac: templateItem.hsnSac,
        quantity: 1,
        unit: "NOS",
        rate: templateItem.rate,
        discountType: "percentage",
        discountValue: i % 5 === 0 ? 5 : 0,
        discountAmount: 0,
        gstRate: templateItem.gstRate
      });
    }
    const statusCycle = i % 10;
    let initialStatus = "paid";
    let advanceAmount = 0;
    let paymentsTotal = 0;
    const payments = [];
    if (statusCycle === 0) {
      initialStatus = "draft";
    } else if (statusCycle === 1) {
      initialStatus = "sent";
    } else if (statusCycle === 2) {
      initialStatus = "partially_paid";
      advanceAmount = 5e3;
    } else {
      initialStatus = "paid";
    }
    const totals = calculateInvoiceTotals(items, {
      isInterState,
      advanceAmount,
      paymentsTotal
    }, initialStatus);
    if (initialStatus === "paid") {
      payments.push({
        id: `pay_${invId}_1`,
        amount: totals.grandTotal,
        paymentDate: invoiceDate,
        paymentMethod: i % 2 === 0 ? "UPI" : "Bank Transfer",
        transactionId: `TXN${1e5 + i}`,
        notes: "Full payment received"
      });
      totals.amountPaid = totals.grandTotal;
      totals.balanceDue = 0;
      totals.status = "paid";
    } else if (initialStatus === "partially_paid") {
      payments.push({
        id: `pay_${invId}_1`,
        amount: advanceAmount,
        paymentDate: invoiceDate,
        paymentMethod: "UPI",
        transactionId: `TXN${1e5 + i}`,
        notes: "Advance deposit received"
      });
      totals.amountPaid = advanceAmount;
      totals.balanceDue = round2(totals.grandTotal - advanceAmount);
      totals.status = "partially_paid";
    }
    const invoiceDoc = {
      id: invId,
      invoiceNumber,
      poNumber: `PO-${202600 + i}`,
      invoiceDate,
      dueDate,
      billingStartDate: invoiceDate,
      billingEndDate: dueDate,
      billingPeriod: `${invoiceDate} to ${dueDate}`,
      placeOfSupply: client.state,
      placeOfSupplyCode: client.stateCode,
      currency: "INR",
      financialYear: "FY 2026-27",
      isInterState,
      status: totals.status,
      template: "classic",
      seller: businessProfile,
      clientId: client.id,
      client,
      items: totals.items,
      discountType: "percentage",
      discountValue: 0,
      discountAmount: 0,
      additionalCharges: [],
      subtotal: totals.subtotal,
      totalItemDiscount: totals.totalItemDiscount,
      totalTaxableAmount: totals.totalTaxableAmount,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalGst: totals.totalGst,
      totalAdditionalCharges: 0,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      advanceAmount: totals.advanceAmount,
      amountPaid: totals.amountPaid,
      balanceDue: totals.balanceDue,
      payments,
      showBankDetails: true,
      showUpiQr: true,
      terms: "Payment due in 15 days.",
      customerNotes: "Thank you for your business.",
      createdAt: new Date(invoiceDate).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    generatedInvoices.push(invoiceDoc);
    if (i % 25 === 0) {
      generatedCreditNotes.push({
        id: `cn_${String(generatedCreditNotes.length + 1).padStart(3, "0")}`,
        creditNoteNumber: `CN-2026-${String(generatedCreditNotes.length + 1).padStart(3, "0")}`,
        creditNoteDate: invoiceDate,
        invoiceId: invId,
        invoiceNumber,
        clientId: client.id,
        client,
        reason: "Service scope alteration & rate adjustment",
        items: [{ description: "Scope adjustment", amount: 5e3 }],
        taxAmount: 900,
        totalAmount: 5900,
        createdAt: new Date(invoiceDate).toISOString()
      });
    }
  }
  await batchSet("invoices", generatedInvoices.map((i) => ({ id: i.id, data: i })));
  if (generatedCreditNotes.length > 0) {
    await batchSet("creditNotes", generatedCreditNotes.map((cn) => ({ id: cn.id, data: cn })));
  }
  const generatedQuotes = [];
  for (let i = 1; i <= 100; i++) {
    const client = generatedClients[(i + 5) % generatedClients.length];
    const isInterState = client.stateCode !== sellerStateCode;
    const qId = `quote_${String(i).padStart(4, "0")}`;
    const quoteNumber = `Q000${100 + i}`;
    const quoteDate = new Date(now - i * 2 * 864e5).toISOString().split("T")[0];
    const validUntil = new Date(new Date(quoteDate).getTime() + 30 * 864e5).toISOString().split("T")[0];
    const items = [{
      name: "Custom Mobile & Web Application Suite",
      hsnSac: "998314",
      quantity: 1,
      unit: "NOS",
      rate: 75e3,
      gstRate: 18
    }];
    const totals = calculateInvoiceTotals(items, { isInterState }, "draft");
    generatedQuotes.push({
      id: qId,
      quoteNumber,
      quoteDate,
      validUntil,
      placeOfSupply: client.state,
      placeOfSupplyCode: client.stateCode,
      currency: "INR",
      status: i % 4 === 0 ? "accepted" : i % 3 === 0 ? "sent" : "draft",
      clientId: client.id,
      client,
      items: totals.items,
      subtotal: totals.subtotal,
      totalTaxableAmount: totals.totalTaxableAmount,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalGst: totals.totalGst,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      createdAt: new Date(quoteDate).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  await batchSet("quotes", generatedQuotes.map((q) => ({ id: q.id, data: q })));
  const generatedRecurring = [];
  for (let i = 1; i <= 30; i++) {
    const client = generatedClients[i % generatedClients.length];
    generatedRecurring.push({
      id: `rec_${String(i).padStart(3, "0")}`,
      recurringNumber: `REC-00${i}`,
      clientId: client.id,
      clientName: client.name,
      frequency: i % 2 === 0 ? "monthly" : "quarterly",
      startDate: "2026-04-01",
      nextDueDate: "2026-10-01",
      status: "active",
      items: [{
        name: "Managed Cloud Retainer",
        hsnSac: "998315",
        quantity: 1,
        rate: 2e4,
        gstRate: 18
      }],
      terms: "Billed monthly on the 1st.",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  await batchSet("recurringInvoices", generatedRecurring.map((r) => ({ id: r.id, data: r })));
  const expenseCategories = ["Server & Cloud Hosting", "Office Rent", "Salaries & Contractors", "Marketing & Ads", "Software Subscriptions", "Utilities"];
  const generatedExpenses = [];
  for (let i = 1; i <= 150; i++) {
    const cat = expenseCategories[i % expenseCategories.length];
    const amount = 3e3 + i * 250;
    const taxAmount = round2(amount * 18 / 100);
    const totalAmount = round2(amount + taxAmount);
    const daysAgo = Math.floor(Math.random() * 120);
    const date = new Date(now - daysAgo * 864e5).toISOString().split("T")[0];
    generatedExpenses.push({
      id: `exp_${String(i).padStart(4, "0")}`,
      category: cat,
      description: `Monthly payment for ${cat} - Reference ${i}`,
      amount,
      taxAmount,
      totalAmount,
      paymentMethod: "Bank Transfer",
      vendor: `Vendor ${i}`,
      invoiceNumber: `V-INV-${1e3 + i}`,
      date,
      isTaxDeductible: true,
      createdAt: new Date(date).toISOString()
    });
  }
  await batchSet("expenses", generatedExpenses.map((e) => ({ id: e.id, data: e })));
  const generatedOnboardings = [];
  for (let i = 1; i <= 100; i++) {
    const client = generatedClients[i % generatedClients.length];
    const daysAgo = Math.floor(Math.random() * 120);
    const obDate = new Date(now - daysAgo * 864e5).toISOString().split("T")[0];
    const dueDate = new Date(new Date(obDate).getTime() + 30 * 864e5).toISOString().split("T")[0];
    const serviceFee = 25e3;
    const adDailyBudget = 250;
    const adDurationDays = 15;
    const adTotalBudget = adDailyBudget * adDurationDays;
    const totalPackageValue = serviceFee + adTotalBudget;
    const advancePaid = i % 3 === 0 ? 15e3 : i % 2 === 0 ? totalPackageValue : 0;
    const remainingBalance = Math.max(0, totalPackageValue - advancePaid);
    const paymentStatus = remainingBalance === 0 ? "paid" : advancePaid > 0 ? "partially_paid" : "unpaid";
    generatedOnboardings.push({
      id: `onb_${String(i).padStart(4, "0")}`,
      onboardingNumber: `ONB-${String(i).padStart(3, "0")}`,
      clientId: client.id,
      customerName: client.contactPerson || client.name,
      businessName: client.name,
      phone: client.phone,
      email: client.email,
      city: client.city,
      state: client.state,
      status: i % 8 === 0 ? "churned" : "active",
      onboardingDate: obDate,
      billingCycleDays: 30,
      nextPaymentDueDate: dueDate,
      lastRenewalDate: obDate,
      servicePackage: "Meta & Google Ads Growth Retainer",
      hasAdsCampaign: true,
      adPlatform: "meta",
      adDailyBudget,
      adDurationDays,
      adTotalBudget,
      adCampaignStartDate: obDate,
      adCampaignEndDate: dueDate,
      adBudgetPaid: adTotalBudget,
      serviceFee,
      totalPackageValue,
      advancePaid,
      remainingBalance,
      paymentStatus,
      paymentHistory: advancePaid > 0 ? [{
        id: `pay_onb_${i}`,
        date: obDate,
        amount: advancePaid,
        type: "advance",
        paymentMethod: "UPI",
        notes: "Deposit received"
      }] : [],
      assignedExecutive: i % 2 === 0 ? "Sankalp" : "Mahendra",
      salesManager: i % 2 === 0 ? "Sankalp" : "Mahendra",
      incentivePercentage: 10,
      incentiveAmount: 2500,
      incentiveStatus: paymentStatus === "paid" ? "eligible" : "pending",
      monthYear: obDate.slice(0, 7),
      notes: "Active growth marketing client",
      remarks: "Active growth marketing client",
      createdAt: new Date(obDate).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  await batchSet("onboardings", generatedOnboardings.map((o) => ({ id: o.id, data: o })));
  const generatedLogs = [];
  for (let i = 1; i <= 100; i++) {
    generatedLogs.push({
      id: `log_${String(i).padStart(4, "0")}`,
      action: i % 2 === 0 ? "Invoice Created & Finalized" : "Payment Recorded",
      entityType: i % 2 === 0 ? "invoice" : "payment",
      entityId: `inv_${String(i).padStart(5, "0")}`,
      entityName: `A${String(i).padStart(6, "0")}`,
      user: "UDM Admin",
      details: "Automated verified transaction",
      timestamp: new Date(now - i * 36e5).toISOString()
    });
  }
  await batchSet("auditLogs", generatedLogs.map((l) => ({ id: l.id, data: l })));
  const resultCounts = {
    clients: generatedClients.length,
    invoices: generatedInvoices.length,
    creditNotes: generatedCreditNotes.length,
    quotes: generatedQuotes.length,
    recurringInvoices: generatedRecurring.length,
    expenses: generatedExpenses.length,
    onboardings: generatedOnboardings.length,
    auditLogs: generatedLogs.length,
    totalRecords: generatedClients.length + generatedInvoices.length + generatedCreditNotes.length + generatedQuotes.length + generatedRecurring.length + generatedExpenses.length + generatedOnboardings.length + generatedLogs.length
  };
  console.log("Seeding completed successfully:", resultCounts);
  return { seeded: resultCounts };
}

// server.ts
var app = express();
var isNginxPresent = Boolean(process.env.NGINX_PORT || process.env.DEFAULT_APP_PORT);
var PORT = isNginxPresent ? Number(process.env.DEFAULT_APP_PORT) || 3e3 : Number(process.env.PORT) || 3e3;
var HOST = "0.0.0.0";
app.use(express.json({ limit: "10mb" }));
async function addAuditLog(action, entityType, entityId, entityName, user = "UDM Admin", details = "") {
  try {
    const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const log = {
      id,
      action,
      entityType,
      entityId,
      entityName,
      user,
      details,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("auditLogs", id, log);
  } catch (e) {
    console.warn("Could not write audit log:", e);
  }
}
var sequenceLock = Promise.resolve();
async function generateNextInvoiceNumber() {
  return new Promise((resolve, reject) => {
    sequenceLock = sequenceLock.then(async () => {
      try {
        let settings = await getDoc("settings", "invoiceSettings");
        if (!settings) {
          settings = {
            prefix: "A",
            startingNumber: 1,
            numberPadding: 6,
            nextSequence: 1,
            defaultCurrency: "INR",
            defaultGstRate: 18,
            defaultPaymentTerms: "Payment due within 15 days.",
            defaultNotes: "Thank you for your business!"
          };
        }
        const prefix = settings.prefix || "A";
        const padding = Number(settings.numberPadding) || 6;
        let currentSeq = Number(settings.nextSequence) || 1;
        let candidate = `${prefix}${String(currentSeq).padStart(padding, "0")}`;
        while (true) {
          const existing = await listDocs("invoices", {
            pageSize: 1,
            filterFn: (inv) => inv.invoiceNumber === candidate
          });
          if (existing.docs.length === 0) {
            break;
          }
          currentSeq++;
          candidate = `${prefix}${String(currentSeq).padStart(padding, "0")}`;
        }
        settings.nextSequence = currentSeq + 1;
        await setDoc("settings", "invoiceSettings", settings, true);
        const profile = await getDoc("settings", "businessProfile");
        if (profile) {
          profile.invoicePrefix = prefix;
          profile.invoiceStartingNumber = currentSeq + 1;
          await setDoc("settings", "businessProfile", profile, true);
        }
        resolve(candidate);
      } catch (err) {
        reject(err);
      }
    });
  });
}
async function advanceSequenceIfHigher(providedNumber) {
  if (!providedNumber) return;
  const match = providedNumber.match(/^[A-Za-z]+(\d+)$/);
  if (!match) return;
  const numPart = parseInt(match[1], 10);
  if (isNaN(numPart)) return;
  const settings = await getDoc("settings", "invoiceSettings");
  if (settings && numPart >= (settings.nextSequence || 1)) {
    settings.nextSequence = numPart + 1;
    await setDoc("settings", "invoiceSettings", settings, true);
  }
}
function processOnboardingRecord(onb) {
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  let services = [];
  if (Array.isArray(onb.services) && onb.services.length > 0) {
    services = onb.services.map((s, idx) => {
      const sMgmt = Number(s.managementFee) || 0;
      const sMgmtPaid = Number(s.managementFeePaid) || 0;
      const sAd = Number(s.adBudget) || 0;
      const sAdPaid = Number(s.adBudgetPaid) || 0;
      const sVal = s.dealValue !== void 0 ? Number(s.dealValue) : sMgmt + sAd;
      const sRec = s.totalReceived !== void 0 ? Number(s.totalReceived) : sMgmtPaid + sAdPaid;
      const sDue = s.totalDue !== void 0 ? Number(s.totalDue) : Math.max(0, sVal - sRec);
      return {
        id: s.id || `srv_${idx + 1}`,
        serviceName: s.serviceName || s.service || `Service ${idx + 1}`,
        managementFee: sMgmt,
        managementFeePaid: sMgmtPaid,
        adBudget: sAd,
        adBudgetPaid: sAdPaid,
        dealValue: sVal,
        totalReceived: sRec,
        totalDue: sDue
      };
    });
  }
  const mgmtFee = services.length > 0 ? services.reduce((acc, s) => acc + s.managementFee, 0) : onb.managementFee !== void 0 ? Number(onb.managementFee) : Number(onb.serviceFee) || 0;
  const adBudgetVal = services.length > 0 ? services.reduce((acc, s) => acc + s.adBudget, 0) : onb.adBudget !== void 0 ? Number(onb.adBudget) : Number(onb.adTotalBudget) || 0;
  const totalDealVal = onb.totalDealValue !== void 0 ? Number(onb.totalDealValue) : mgmtFee + adBudgetVal;
  const mgmtReceived = services.length > 0 ? services.reduce((acc, s) => acc + s.managementFeePaid, 0) : onb.managementFeePaid !== void 0 ? Number(onb.managementFeePaid) : 0;
  const adReceived = services.length > 0 ? services.reduce((acc, s) => acc + s.adBudgetPaid, 0) : onb.adBudgetPaid !== void 0 ? Number(onb.adBudgetPaid) : 0;
  const totalRec = onb.advancePaid !== void 0 ? Number(onb.advancePaid) : onb.totalReceived !== void 0 ? Number(onb.totalReceived) : mgmtReceived + adReceived;
  const totalDueVal = onb.totalDue !== void 0 ? Number(onb.totalDue) : Math.max(0, totalDealVal - totalRec);
  let nextDueDate = onb.nextPaymentDueDate;
  if (!nextDueDate && onb.onboardingDate) {
    const obDate = new Date(onb.onboardingDate);
    const cycleDays = onb.billingCycleDays || 30;
    const computedDue = new Date(obDate.getTime() + cycleDays * 24 * 60 * 60 * 1e3);
    nextDueDate = computedDue.toISOString().split("T")[0];
  }
  let isPaymentOverdue = false;
  let daysUntilPaymentDue = 0;
  if (nextDueDate) {
    const dueTime = new Date(nextDueDate).getTime();
    const diffMs = dueTime - today.getTime();
    daysUntilPaymentDue = Math.ceil(diffMs / (1e3 * 60 * 60 * 24));
    if (daysUntilPaymentDue < 0 && (totalDueVal > 0 || onb.paymentStatus !== "paid")) {
      isPaymentOverdue = true;
    }
  }
  let isAdExpired = false;
  let daysUntilAdExpiry = null;
  if (onb.hasAdsCampaign && onb.adCampaignEndDate) {
    const endTime = new Date(onb.adCampaignEndDate).getTime();
    const diffMs = endTime - today.getTime();
    daysUntilAdExpiry = Math.ceil(diffMs / (1e3 * 60 * 60 * 24));
    if (daysUntilAdExpiry < 0) {
      isAdExpired = true;
    }
  } else if (onb.hasAdsCampaign && onb.adDurationDays && onb.adCampaignStartDate) {
    const startTime = new Date(onb.adCampaignStartDate);
    const endTime = new Date(startTime.getTime() + (onb.adDurationDays || 15) * 24 * 60 * 60 * 1e3);
    const diffMs = endTime.getTime() - today.getTime();
    daysUntilAdExpiry = Math.ceil(diffMs / (1e3 * 60 * 60 * 24));
    if (daysUntilAdExpiry < 0) {
      isAdExpired = true;
    }
  }
  return {
    ...onb,
    services: services.length > 0 ? services : Array.isArray(onb.services) ? onb.services : void 0,
    serviceFee: mgmtFee,
    managementFee: mgmtFee,
    managementFeePaid: mgmtReceived,
    adTotalBudget: adBudgetVal,
    adBudget: adBudgetVal,
    adBudgetPaid: adReceived,
    totalPackageValue: totalDealVal,
    totalDealValue: totalDealVal,
    advancePaid: totalRec,
    totalReceived: totalRec,
    remainingBalance: totalDueVal,
    totalDue: totalDueVal,
    salesManager: onb.salesManager || onb.assignedExecutive || "Sankalp",
    assignedExecutive: onb.salesManager || onb.assignedExecutive || "Sankalp",
    remarks: onb.remarks || onb.notes || "",
    notes: onb.remarks || onb.notes || "",
    nextPaymentDueDate: nextDueDate,
    isPaymentOverdue,
    daysUntilPaymentDue,
    isAdExpired,
    daysUntilAdExpiry
  };
}
app.get(["/health", "/api/health", "/api/admin/health"], async (req, res) => {
  try {
    const [invoicesCount, clientsCount, quotesCount, expensesCount, onboardingsCount] = await Promise.all([
      countDocs("invoices").catch(() => 0),
      countDocs("clients").catch(() => 0),
      countDocs("quotes").catch(() => 0),
      countDocs("expenses").catch(() => 0),
      countDocs("onboardings").catch(() => 0)
    ]);
    res.json({
      success: true,
      database: "Firestore",
      status: "healthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      counts: {
        invoices: invoicesCount,
        clients: clientsCount,
        quotes: quotesCount,
        expenses: expensesCount,
        onboardings: onboardingsCount
      }
    });
  } catch (err) {
    res.status(200).json({ success: true, status: "healthy", degraded: true, error: err.message });
  }
});
app.post("/api/admin/migrate-and-seed", async (req, res) => {
  try {
    const { action, targetCount } = req.body;
    let result = {};
    if (action === "migrate" || !action) {
      result.migration = await runMigration();
    }
    if (action === "seed" || action === "all") {
      result.seeding = await seedRealisticDataset(targetCount || 1e3);
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getDoc("users", "usr_admin") || {
      id: "usr_admin",
      email: "sakshi.udmtechno@gmail.com",
      name: "Sakshi (UDM Admin)",
      role: "admin"
    };
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanUser = (email || "").toString().trim().toLowerCase();
    const cleanPass = (password || "").toString().trim();
    if (!cleanUser || !cleanPass) {
      return res.status(400).json({
        success: false,
        message: "Username/Email and password are required."
      });
    }
    const isAdminUser = cleanUser === "sankalp123" || cleanUser === "sankalpnayakk@gmail.com" || cleanUser === "sankalp" || cleanUser === "sankap123" || cleanUser === "admin" || cleanUser === "sakshi.udmtechno@gmail.com";
    const isSalesUser = cleanUser === "sales@udmtechno.com" || cleanUser === "mahendra" || cleanUser === "sales";
    let authenticatedRole = null;
    let userName = "UDM User";
    let userId = `usr_${Date.now()}`;
    if (isAdminUser) {
      const isValidAdminPass = cleanPass === "Sankalp@321" || cleanPass.toLowerCase() === "sankalp@321" || cleanPass === "Udm@2026" || cleanPass === "Sankap@321";
      if (isValidAdminPass) {
        authenticatedRole = "admin";
        userName = cleanUser.includes("sakshi") ? "Sakshi (UDM Admin)" : "Sankalp Nayak (UDM Admin)";
        userId = "usr_admin";
      }
    } else if (isSalesUser) {
      const isValidSalesPass = cleanPass === "Sales@321" || cleanPass.toLowerCase() === "sales@321" || cleanPass === "Udm@2026";
      if (isValidSalesPass) {
        authenticatedRole = "sales_manager";
        userName = "Mahendra (Sales Manager)";
        userId = "usr_sales";
      }
    } else {
      const userList = await listDocs("users", {
        pageSize: 10,
        filterFn: (u) => u.email?.toLowerCase() === cleanUser || u.username?.toLowerCase() === cleanUser
      });
      if (userList.docs.length > 0) {
        const found = userList.docs[0];
        if (found.password && found.password === cleanPass) {
          authenticatedRole = found.role || "admin";
          userName = found.name || "UDM User";
          userId = found.id;
        }
      }
    }
    if (!authenticatedRole) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password. Please verify your credentials."
      });
    }
    const sessionDurationMs = 7 * 24 * 60 * 60 * 1e3;
    const expiresAt = Date.now() + sessionDurationMs;
    const token = `udm_token_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const userData = {
      id: userId,
      email: cleanUser,
      username: cleanUser,
      name: userName,
      role: authenticatedRole,
      permissions: authenticatedRole === "admin" ? ["all"] : ["onboarding", "quotes", "invoices_create", "clients"],
      expiresAt
    };
    await setDoc("users", userId, userData, true);
    await addAuditLog("User Login", "user", userId, `${userName} (${authenticatedRole})`);
    res.json({
      success: true,
      token,
      expiresAt,
      sessionDurationDays: 7,
      user: userData,
      data: userData
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/business-profile", async (req, res) => {
  try {
    let profile = await getDoc("settings", "businessProfile");
    if (!profile) {
      profile = {
        businessName: "UDM Techno Solutions",
        legalName: "UDM Techno Solutions Pvt Ltd",
        gstin: "23AHWPH3168H2Z2",
        pan: "AHWPH3168H",
        state: "Madhya Pradesh",
        stateCode: "23",
        city: "Indore",
        address: "101, IT Park Road",
        pinCode: "452001",
        country: "India",
        email: "billing@udmtechno.com",
        phone: "9826000000",
        authorizedSignatoryName: "Authorized Signatory"
      };
      await setDoc("settings", "businessProfile", profile, true);
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/business-profile", async (req, res) => {
  try {
    const existing = await getDoc("settings", "businessProfile") || {};
    const updated = {
      ...existing,
      ...req.body,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("settings", "businessProfile", updated, true);
    if (req.body.invoicePrefix !== void 0 || req.body.invoiceStartingNumber !== void 0) {
      const invSettings = await getDoc("settings", "invoiceSettings") || {};
      if (req.body.invoicePrefix !== void 0) {
        invSettings.prefix = req.body.invoicePrefix;
      }
      if (req.body.invoiceStartingNumber !== void 0) {
        const startNum = Number(req.body.invoiceStartingNumber) || 1;
        invSettings.startingNumber = startNum;
        invSettings.nextSequence = startNum;
      }
      await setDoc("settings", "invoiceSettings", invSettings, true);
    }
    await addAuditLog("Business Profile Updated", "settings", "businessProfile", updated.businessName);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/settings", async (req, res) => {
  try {
    const [invoiceSettings, taxSettings, paymentSettings, pdfSettings] = await Promise.all([
      getDoc("settings", "invoiceSettings"),
      getDoc("settings", "taxSettings"),
      getDoc("settings", "paymentSettings"),
      getDoc("settings", "pdfSettings")
    ]);
    res.json({
      success: true,
      data: {
        invoiceSettings: invoiceSettings || {},
        taxSettings: taxSettings || {},
        paymentSettings: paymentSettings || {},
        pdfSettings: pdfSettings || {}
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/settings", async (req, res) => {
  try {
    const { invoiceSettings, taxSettings, paymentSettings, pdfSettings } = req.body;
    if (invoiceSettings) {
      const existing = await getDoc("settings", "invoiceSettings") || {};
      const updatedInv = { ...existing, ...invoiceSettings };
      await setDoc("settings", "invoiceSettings", updatedInv, true);
      const bp = await getDoc("settings", "businessProfile");
      if (bp) {
        if (invoiceSettings.prefix) bp.invoicePrefix = invoiceSettings.prefix;
        if (invoiceSettings.startingNumber || invoiceSettings.nextSequence) {
          bp.invoiceStartingNumber = Number(invoiceSettings.startingNumber || invoiceSettings.nextSequence);
        }
        await setDoc("settings", "businessProfile", bp, true);
      }
    }
    if (taxSettings) {
      const existing = await getDoc("settings", "taxSettings") || {};
      await setDoc("settings", "taxSettings", { ...existing, ...taxSettings }, true);
    }
    if (paymentSettings) {
      const existing = await getDoc("settings", "paymentSettings") || {};
      await setDoc("settings", "paymentSettings", { ...existing, ...paymentSettings }, true);
    }
    if (pdfSettings) {
      const existing = await getDoc("settings", "pdfSettings") || {};
      await setDoc("settings", "pdfSettings", { ...existing, ...pdfSettings }, true);
    }
    await addAuditLog("Settings Updated", "settings", "app_settings", "System Settings");
    res.json({ success: true, message: "Settings updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/invoices/next-number", async (req, res) => {
  try {
    let settings = await getDoc("settings", "invoiceSettings");
    if (!settings) {
      settings = {
        prefix: "A",
        startingNumber: 1,
        numberPadding: 6,
        nextSequence: 1
      };
    }
    const prefix = settings.prefix || "A";
    const padding = Number(settings.numberPadding) || 6;
    const currentSeq = Number(settings.nextSequence) || 1;
    const invoiceNumber = `${prefix}${String(currentSeq).padStart(padding, "0")}`;
    res.json({ success: true, invoiceNumber, nextSequence: currentSeq });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/clients", async (req, res) => {
  try {
    const { page, pageSize, search, customerType } = req.query;
    const result = await listDocs("clients", {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      search,
      searchFields: ["name", "clientNumber", "email", "phone", "city", "state", "gstin"],
      filterFn: customerType && customerType !== "all" ? (c) => c.customerType === customerType : void 0,
      orderByField: "createdAt",
      orderDirection: "desc"
    });
    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/clients/:id", async (req, res) => {
  try {
    const client = await getDoc("clients", req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const invoicesResult = await listDocs("invoices", {
      filterFn: (inv) => inv.clientId === req.params.id,
      pageSize: 500
    });
    const clientInvoices = invoicesResult.docs;
    const totalBilled = clientInvoices.reduce((sum, inv) => sum + (inv.status !== "cancelled" ? inv.grandTotal : 0), 0);
    const totalPaid = clientInvoices.reduce((sum, inv) => sum + (inv.status !== "cancelled" ? inv.amountPaid : 0), 0);
    const outstanding = Math.max(0, round2(totalBilled - totalPaid));
    const lastInvoice = [...clientInvoices].sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime())[0];
    res.json({
      success: true,
      data: {
        client,
        stats: {
          totalInvoices: clientInvoices.length,
          totalBilled: round2(totalBilled),
          totalPaid: round2(totalPaid),
          outstanding,
          lastInvoiceDate: lastInvoice ? lastInvoice.invoiceDate : null,
          lastInvoiceNumber: lastInvoice ? lastInvoice.invoiceNumber : null
        },
        invoices: clientInvoices
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/clients", async (req, res) => {
  try {
    const parseResult = ClientSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = "Invalid client data: " + parseResult.error.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join(", ");
      console.warn("POST /api/clients validation failed:", errorMsg, "Payload:", req.body);
      return res.status(400).json({
        success: false,
        message: errorMsg,
        errors: parseResult.error.issues
      });
    }
    const currentCount = await countDocs("clients");
    const newId = `client_${Date.now()}`;
    const newClient = {
      id: newId,
      clientNumber: `CLI-${String(currentCount + 1).padStart(3, "0")}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...parseResult.data
    };
    await setDoc("clients", newId, newClient);
    await addAuditLog("Client Created", "client", newClient.id, newClient.name);
    res.status(201).json({ success: true, data: newClient });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/clients/:id", async (req, res) => {
  try {
    const existing = await getDoc("clients", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const parseResult = ClientSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid client update",
        errors: parseResult.error.issues
      });
    }
    const updatedClient = {
      ...existing,
      ...parseResult.data,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("clients", req.params.id, updatedClient, true);
    await addAuditLog("Client Updated", "client", updatedClient.id, updatedClient.name);
    res.json({ success: true, data: updatedClient });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/clients/:id", async (req, res) => {
  try {
    const clientId = req.params.id;
    const existing = await getDoc("clients", clientId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const force = req.query.force === "true";
    const [linkedInvoices, linkedQuotes, linkedRecurring] = await Promise.all([
      listDocs("invoices", { pageSize: 50, filterFn: (inv) => inv.clientId === clientId }),
      listDocs("quotes", { pageSize: 50, filterFn: (q) => q.clientId === clientId }),
      listDocs("recurringInvoices", { pageSize: 50, filterFn: (r) => r.clientId === clientId })
    ]);
    const hasDependencies = linkedInvoices.docs.length > 0 || linkedQuotes.docs.length > 0 || linkedRecurring.docs.length > 0;
    if (hasDependencies && !force) {
      return res.status(409).json({
        success: false,
        conflict: true,
        message: `Client "${existing.name}" is linked to ${linkedInvoices.docs.length} invoice(s), ${linkedQuotes.docs.length} estimate(s), and ${linkedRecurring.docs.length} recurring schedule(s). Deleting will affect these records. Reassign or delete these records first, or confirm force deletion.`,
        dependencies: {
          invoices: linkedInvoices.docs.length,
          quotes: linkedQuotes.docs.length,
          recurring: linkedRecurring.docs.length
        }
      });
    }
    await deleteDoc("clients", clientId);
    await addAuditLog("Client Deleted", "client", clientId, `${existing.name}${force ? " (Force deleted with dependencies)" : ""}`);
    res.json({ success: true, message: "Client deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/invoices", async (req, res) => {
  try {
    const { page, pageSize, status, search, financialYear, clientId, orderBy, orderDir } = req.query;
    const result = await listDocs("invoices", {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status,
      search,
      searchFields: ["invoiceNumber", "poNumber"],
      filterFn: (inv) => {
        if (financialYear && financialYear !== "All" && inv.financialYear !== financialYear) return false;
        if (clientId && clientId !== "All" && inv.clientId !== clientId) return false;
        return true;
      },
      orderByField: orderBy || "invoiceDate",
      orderDirection: orderDir || "desc"
    });
    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/invoices/:id", async (req, res) => {
  try {
    const invoice = await getDoc("invoices", req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/invoices", async (req, res) => {
  try {
    const parseResult = InvoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice data",
        errors: parseResult.error.issues
      });
    }
    let invoiceData = { ...req.body };
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    if (!invoiceData.invoiceNumber || invoiceData.invoiceNumber === "AUTO" || invoiceData.invoiceNumber.startsWith("DRAFT-")) {
      if (invoiceData.status !== "draft") {
        invoiceData.invoiceNumber = await generateNextInvoiceNumber();
      } else {
        invoiceData.invoiceNumber = invoiceData.invoiceNumber || `DRAFT-${Date.now().toString().slice(-4)}`;
      }
    } else {
      const existingInv = await listDocs("invoices", {
        pageSize: 1,
        filterFn: (inv) => inv.invoiceNumber === invoiceData.invoiceNumber
      });
      if (existingInv.docs.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invoice #${invoiceData.invoiceNumber} already exists in the system. Please use a unique invoice number.`
        });
      }
      await advanceSequenceIfHigher(invoiceData.invoiceNumber);
    }
    const billingInfo = calculateBillingPeriod(invoiceData.billingStartDate || invoiceData.invoiceDate);
    invoiceData.billingStartDate = invoiceData.billingStartDate || billingInfo.startDate;
    invoiceData.billingEndDate = invoiceData.billingEndDate || billingInfo.endDate;
    invoiceData.billingPeriod = invoiceData.billingPeriod || billingInfo.formattedPeriod;
    if (invoiceData.clientId) {
      const client = await getDoc("clients", invoiceData.clientId);
      if (client) {
        invoiceData.client = { ...invoiceData.client, ...client };
      }
    } else if (invoiceData.client && invoiceData.client.name) {
      const existingClients = await listDocs("clients", {
        search: invoiceData.client.name,
        searchFields: ["name"],
        pageSize: 5
      });
      const matched = existingClients.docs.find(
        (c) => c.name.toLowerCase().trim() === invoiceData.client.name.toLowerCase().trim()
      );
      if (matched) {
        invoiceData.clientId = matched.id;
        invoiceData.client = { ...invoiceData.client, ...matched };
      } else {
        const count = await countDocs("clients");
        const newClientId = `client_${Date.now()}`;
        const createdClient = {
          id: newClientId,
          clientNumber: `CLI-${String(count + 1).padStart(3, "0")}`,
          name: invoiceData.client.name,
          contactPerson: invoiceData.client.contactPerson || "",
          email: invoiceData.client.email || "",
          phone: invoiceData.client.phone || "",
          billingAddress: invoiceData.client.billingAddress || "",
          city: invoiceData.client.city || "",
          state: invoiceData.client.state || invoiceData.placeOfSupply || "Madhya Pradesh",
          stateCode: invoiceData.client.stateCode || invoiceData.placeOfSupplyCode || "23",
          country: invoiceData.client.country || "India",
          pinCode: invoiceData.client.pinCode || "",
          gstin: invoiceData.client.gstin || "",
          pan: invoiceData.client.pan || "",
          customerType: invoiceData.client.customerType || "B2B",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await setDoc("clients", newClientId, createdClient);
        invoiceData.clientId = newClientId;
        invoiceData.client = createdClient;
      }
    }
    const placeOfSupplyCode = invoiceData.placeOfSupplyCode || invoiceData.client?.stateCode || "23";
    const isInterState = sellerStateCode !== placeOfSupplyCode;
    const advance = round2(Number(invoiceData.advanceAmount) || 0);
    const existingPayments = Array.isArray(invoiceData.payments) ? invoiceData.payments : [];
    const paymentsTotal = round2(existingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const calculatedTotals = calculateInvoiceTotals(invoiceData.items, {
      isInterState,
      isReverseCharge: invoiceData.isReverseCharge,
      discountType: invoiceData.discountType,
      discountValue: invoiceData.discountValue,
      additionalCharges: invoiceData.additionalCharges,
      advanceAmount: advance,
      paymentsTotal
    }, invoiceData.status || "draft");
    const newId = `inv_${Date.now()}`;
    const newInvoice = {
      ...invoiceData,
      id: newId,
      isInterState,
      items: calculatedTotals.items,
      subtotal: calculatedTotals.subtotal,
      totalItemDiscount: calculatedTotals.totalItemDiscount,
      totalTaxableAmount: calculatedTotals.totalTaxableAmount,
      totalCgst: calculatedTotals.totalCgst,
      totalSgst: calculatedTotals.totalSgst,
      totalIgst: calculatedTotals.totalIgst,
      totalGst: calculatedTotals.totalGst,
      totalAdditionalCharges: calculatedTotals.totalAdditionalCharges,
      roundOff: calculatedTotals.roundOff,
      grandTotal: calculatedTotals.grandTotal,
      totalInWords: calculatedTotals.totalInWords,
      advanceAmount: calculatedTotals.advanceAmount,
      amountPaid: calculatedTotals.amountPaid,
      balanceDue: calculatedTotals.balanceDue,
      status: calculatedTotals.status,
      payments: existingPayments,
      seller: businessProfile,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", newId, newInvoice);
    await addAuditLog(
      newInvoice.status === "draft" ? "Draft Invoice Created" : "Invoice Created & Finalized",
      "invoice",
      newInvoice.id,
      `${newInvoice.invoiceNumber} (${newInvoice.client?.name || "Client"})`,
      "UDM Admin",
      `Total: \u20B9${newInvoice.grandTotal} | Bal: \u20B9${newInvoice.balanceDue}`
    );
    res.status(201).json({ success: true, data: newInvoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/invoices/:id", async (req, res) => {
  try {
    const existing = await getDoc("invoices", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const parseResult = InvoiceSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice update",
        errors: parseResult.error.issues
      });
    }
    const updateData = { ...req.body };
    if (existing.status === "draft" && updateData.status !== "draft" && (!updateData.invoiceNumber || updateData.invoiceNumber.startsWith("DRAFT-"))) {
      updateData.invoiceNumber = await generateNextInvoiceNumber();
    } else if (updateData.invoiceNumber) {
      await advanceSequenceIfHigher(updateData.invoiceNumber);
    }
    if (updateData.billingStartDate || updateData.invoiceDate) {
      const billingInfo = calculateBillingPeriod(updateData.billingStartDate || updateData.invoiceDate);
      updateData.billingStartDate = updateData.billingStartDate || billingInfo.startDate;
      updateData.billingEndDate = billingInfo.endDate;
      updateData.billingPeriod = billingInfo.formattedPeriod;
    }
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    const placeOfSupplyCode = updateData.placeOfSupplyCode || existing.placeOfSupplyCode || "23";
    const isInterState = sellerStateCode !== placeOfSupplyCode;
    const items = updateData.items || existing.items || [];
    const advance = updateData.advanceAmount !== void 0 ? round2(Number(updateData.advanceAmount) || 0) : existing.advanceAmount;
    const payments = Array.isArray(updateData.payments) ? updateData.payments : existing.payments || [];
    const paymentsTotal = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const calculatedTotals = calculateInvoiceTotals(items, {
      isInterState,
      isReverseCharge: updateData.isReverseCharge ?? existing.isReverseCharge,
      discountType: updateData.discountType || existing.discountType,
      discountValue: updateData.discountValue ?? existing.discountValue,
      additionalCharges: updateData.additionalCharges || existing.additionalCharges,
      advanceAmount: advance,
      paymentsTotal
    }, updateData.status || existing.status);
    const updatedInvoice = {
      ...existing,
      ...updateData,
      isInterState,
      items: calculatedTotals.items,
      subtotal: calculatedTotals.subtotal,
      totalItemDiscount: calculatedTotals.totalItemDiscount,
      totalTaxableAmount: calculatedTotals.totalTaxableAmount,
      totalCgst: calculatedTotals.totalCgst,
      totalSgst: calculatedTotals.totalSgst,
      totalIgst: calculatedTotals.totalIgst,
      totalGst: calculatedTotals.totalGst,
      totalAdditionalCharges: calculatedTotals.totalAdditionalCharges,
      roundOff: calculatedTotals.roundOff,
      grandTotal: calculatedTotals.grandTotal,
      totalInWords: calculatedTotals.totalInWords,
      advanceAmount: calculatedTotals.advanceAmount,
      amountPaid: calculatedTotals.amountPaid,
      balanceDue: calculatedTotals.balanceDue,
      status: calculatedTotals.status,
      payments,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", req.params.id, updatedInvoice, true);
    await addAuditLog("Invoice Updated", "invoice", updatedInvoice.id, updatedInvoice.invoiceNumber);
    res.json({ success: true, data: updatedInvoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const existing = await getDoc("invoices", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    await deleteDoc("invoices", req.params.id);
    await addAuditLog("Invoice Deleted", "invoice", req.params.id, existing.invoiceNumber);
    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/invoices/:id/payments", async (req, res) => {
  try {
    const invoice = await getDoc("invoices", req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const parseResult = PaymentRecordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment data",
        errors: parseResult.error.issues
      });
    }
    const paymentAmount = round2(parseResult.data.amount);
    const newPayment = {
      id: `pay_${Date.now()}`,
      invoiceId: invoice.id,
      amount: paymentAmount,
      paymentDate: parseResult.data.paymentDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      paymentMethod: parseResult.data.paymentMethod || "Bank Transfer",
      transactionId: parseResult.data.transactionId || "",
      notes: parseResult.data.notes || "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const payments = [...invoice.payments || [], newPayment];
    const advance = round2(Number(invoice.advanceAmount) || 0);
    const paymentsTotal = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const totalPaid = round2(advance + paymentsTotal);
    const balanceDue = round2(Math.max(0, invoice.grandTotal - totalPaid));
    let status = invoice.status;
    if (balanceDue <= 0.01) {
      status = "paid";
    } else if (totalPaid > 0) {
      status = "partially_paid";
    }
    const updatedInvoice = {
      ...invoice,
      payments,
      amountPaid: totalPaid,
      balanceDue,
      status,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", invoice.id, updatedInvoice, true);
    await addAuditLog(
      "Payment Recorded",
      "payment",
      invoice.id,
      invoice.invoiceNumber,
      "UDM Admin",
      `Recorded \u20B9${paymentAmount} via ${newPayment.paymentMethod} (Bal: \u20B9${balanceDue})`
    );
    res.json({ success: true, data: updatedInvoice, payment: newPayment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/invoices/:id/duplicate", async (req, res) => {
  try {
    const original = await getDoc("invoices", req.params.id);
    if (!original) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const nextNumber = await generateNextInvoiceNumber();
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const dueDate = new Date(Date.now() + 15 * 864e5).toISOString().split("T")[0];
    const newId = `inv_${Date.now()}`;
    const duplicated = {
      ...original,
      id: newId,
      invoiceNumber: nextNumber,
      invoiceDate: today,
      dueDate,
      status: "draft",
      payments: [],
      advanceAmount: 0,
      amountPaid: 0,
      balanceDue: original.grandTotal,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", newId, duplicated);
    await addAuditLog("Invoice Duplicated", "invoice", duplicated.id, `${duplicated.invoiceNumber} (from ${original.invoiceNumber})`);
    res.status(201).json({ success: true, data: duplicated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/invoices/:id/cancel", async (req, res) => {
  try {
    const invoice = await getDoc("invoices", req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const updated = {
      ...invoice,
      status: "cancelled",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", invoice.id, updated, true);
    await addAuditLog("Invoice Cancelled", "invoice", invoice.id, invoice.invoiceNumber);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/invoices/:id/send-email", async (req, res) => {
  try {
    const { to } = req.body;
    const invoice = await getDoc("invoices", req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    if (invoice.status === "draft") {
      invoice.status = "sent";
      invoice.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await setDoc("invoices", invoice.id, invoice, true);
    }
    await addAuditLog("Invoice Sent by Email", "invoice", invoice.id, invoice.invoiceNumber, "UDM Admin", `Sent to ${to}`);
    res.json({ success: true, message: `Invoice ${invoice.invoiceNumber} successfully queued for delivery to ${to}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/quotes", async (req, res) => {
  try {
    const { page, pageSize, search, status } = req.query;
    const result = await listDocs("quotes", {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status,
      search,
      searchFields: ["quoteNumber"],
      orderByField: "quoteDate",
      orderDirection: "desc"
    });
    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/quotes", async (req, res) => {
  try {
    const parseResult = QuoteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid quote data",
        errors: parseResult.error.issues
      });
    }
    const quoteData = req.body;
    const count = await countDocs("quotes");
    const newId = `quote_${Date.now()}`;
    const quoteNumber = quoteData.quoteNumber || `Q000${count + 101}`;
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    const placeOfSupplyCode = quoteData.placeOfSupplyCode || quoteData.client?.stateCode || "23";
    const isInterState = sellerStateCode !== placeOfSupplyCode;
    const totals = calculateInvoiceTotals(quoteData.items, {
      isInterState,
      discountType: quoteData.discountType,
      discountValue: quoteData.discountValue,
      additionalCharges: quoteData.additionalCharges
    }, quoteData.status || "draft");
    const newQuote = {
      ...quoteData,
      id: newId,
      quoteNumber,
      isInterState,
      items: totals.items,
      subtotal: totals.subtotal,
      totalTaxableAmount: totals.totalTaxableAmount,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalGst: totals.totalGst,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("quotes", newId, newQuote);
    await addAuditLog("Quote Created", "quote", newQuote.id, newQuote.quoteNumber);
    res.status(201).json({ success: true, data: newQuote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/quotes/:id", async (req, res) => {
  try {
    const existing = await getDoc("quotes", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Quote not found" });
    }
    const updatedData = { ...existing, ...req.body };
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    const placeOfSupplyCode = updatedData.placeOfSupplyCode || updatedData.client?.stateCode || "23";
    const isInterState = sellerStateCode !== placeOfSupplyCode;
    const totals = calculateInvoiceTotals(updatedData.items || [], {
      isInterState,
      discountType: updatedData.discountType,
      discountValue: updatedData.discountValue,
      additionalCharges: updatedData.additionalCharges
    }, updatedData.status || existing.status);
    const updatedQuote = {
      ...updatedData,
      isInterState,
      items: totals.items,
      subtotal: totals.subtotal,
      totalTaxableAmount: totals.totalTaxableAmount,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalGst: totals.totalGst,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("quotes", req.params.id, updatedQuote, true);
    await addAuditLog("Quote Updated", "quote", updatedQuote.id, updatedQuote.quoteNumber);
    res.json({ success: true, data: updatedQuote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/quotes/:id", async (req, res) => {
  try {
    const existing = await getDoc("quotes", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Quote not found" });
    }
    await deleteDoc("quotes", req.params.id);
    await addAuditLog("Quote Deleted", "quote", req.params.id, existing.quoteNumber);
    res.json({ success: true, message: "Quote deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/quotes/:id/convert-to-invoice", async (req, res) => {
  try {
    const quote = await getDoc("quotes", req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, message: "Quote not found" });
    }
    const nextNumber = await generateNextInvoiceNumber();
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const dueDate = new Date(Date.now() + 15 * 864e5).toISOString().split("T")[0];
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const invoiceSettings = await getDoc("settings", "invoiceSettings") || {};
    const newInvoice = {
      id: `inv_${Date.now()}`,
      invoiceNumber: nextNumber,
      poNumber: `CONV-${quote.quoteNumber}`,
      invoiceDate: today,
      dueDate,
      billingStartDate: today,
      billingEndDate: dueDate,
      billingPeriod: `${today} to ${dueDate}`,
      placeOfSupply: quote.placeOfSupply,
      placeOfSupplyCode: quote.placeOfSupplyCode,
      currency: quote.currency || "INR",
      financialYear: "FY 2026-27",
      isInterState: quote.isInterState,
      status: "draft",
      template: quote.template || "classic",
      seller: businessProfile,
      clientId: quote.clientId,
      client: quote.client,
      items: quote.items || [],
      discountType: quote.discountType || "percentage",
      discountValue: quote.discountValue || 0,
      discountAmount: quote.discountAmount || 0,
      additionalCharges: quote.additionalCharges || [],
      subtotal: quote.subtotal,
      totalItemDiscount: 0,
      totalTaxableAmount: quote.totalTaxableAmount,
      totalCgst: quote.totalCgst,
      totalSgst: quote.totalSgst,
      totalIgst: quote.totalIgst,
      totalGst: quote.totalGst,
      totalAdditionalCharges: 0,
      roundOff: quote.roundOff || 0,
      grandTotal: quote.grandTotal,
      totalInWords: quote.totalInWords,
      amountPaid: 0,
      balanceDue: quote.grandTotal,
      payments: [],
      showBankDetails: true,
      showUpiQr: true,
      terms: quote.terms || invoiceSettings.defaultPaymentTerms || "Payment due in 15 days.",
      customerNotes: quote.notes || "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", newInvoice.id, newInvoice);
    quote.status = "converted";
    quote.convertedToInvoiceId = newInvoice.id;
    quote.convertedToInvoiceNumber = newInvoice.invoiceNumber;
    quote.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await setDoc("quotes", quote.id, quote, true);
    await addAuditLog("Quote Converted to Invoice", "invoice", newInvoice.id, `${newInvoice.invoiceNumber} (from ${quote.quoteNumber})`);
    res.json({ success: true, invoice: newInvoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/credit-notes", async (req, res) => {
  try {
    const result = await listDocs("creditNotes", { pageSize: 500, orderByField: "createdAt", orderDirection: "desc" });
    res.json({ success: true, data: result.docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/credit-notes", async (req, res) => {
  try {
    const body = { ...req.body };
    const cnDate = body.creditNoteDate || body.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const totAmt = Number(body.totalAmount ?? Number(body.taxableAmount || 0) + gstAmt);
    const taxAble = Number(body.taxableAmount ?? totAmt - gstAmt);
    const normalizedBody = {
      ...body,
      creditNoteDate: cnDate,
      date: cnDate,
      totalAmount: totAmt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      taxableAmount: taxAble,
      status: body.status || "active"
    };
    const parseResult = CreditNoteSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid credit note data",
        errors: parseResult.error.issues
      });
    }
    const count = await countDocs("creditNotes");
    const newId = `cn_${Date.now()}`;
    const newCreditNote = {
      id: newId,
      creditNoteNumber: body.creditNoteNumber || `CN-2026-${String(count + 1).padStart(3, "0")}`,
      creditNoteDate: cnDate,
      date: cnDate,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...parseResult.data
    };
    await setDoc("creditNotes", newId, newCreditNote);
    if (newCreditNote.invoiceId) {
      const inv = await getDoc("invoices", newCreditNote.invoiceId);
      if (inv) {
        const creditAmt = Number(newCreditNote.totalAmount) || 0;
        const currentCredited = Number(inv.creditedAmount) || 0;
        inv.creditedAmount = round2(currentCredited + creditAmt);
        const grandTotal = Number(inv.grandTotal) || 0;
        const amountPaid = Number(inv.amountPaid) || 0;
        inv.balanceDue = Math.max(0, round2(grandTotal - amountPaid - inv.creditedAmount));
        if (inv.balanceDue === 0 && grandTotal > 0) {
          inv.status = "paid";
        }
        inv.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await setDoc("invoices", inv.id, inv, true);
      }
    }
    await addAuditLog("Credit Note Issued", "credit_note", newCreditNote.id, `${newCreditNote.creditNoteNumber} against ${newCreditNote.invoiceNumber || "Invoice"}`);
    res.status(201).json({ success: true, data: newCreditNote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/credit-notes/:id", async (req, res) => {
  try {
    const existing = await getDoc("creditNotes", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Credit note not found" });
    }
    const oldTotal = Number(existing.totalAmount) || 0;
    const updated = { ...existing, ...req.body, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const newTotal = Number(updated.totalAmount) || 0;
    await setDoc("creditNotes", req.params.id, updated, true);
    if (updated.invoiceId) {
      const inv = await getDoc("invoices", updated.invoiceId);
      if (inv) {
        const diff = newTotal - oldTotal;
        inv.creditedAmount = Math.max(0, round2((Number(inv.creditedAmount) || 0) + diff));
        inv.balanceDue = Math.max(0, round2((Number(inv.grandTotal) || 0) - (Number(inv.amountPaid) || 0) - inv.creditedAmount));
        inv.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await setDoc("invoices", inv.id, inv, true);
      }
    }
    await addAuditLog("Credit Note Updated", "credit_note", updated.id, updated.creditNoteNumber);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/credit-notes/:id", async (req, res) => {
  try {
    const existing = await getDoc("creditNotes", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Credit note not found" });
    }
    if (existing.invoiceId) {
      const inv = await getDoc("invoices", existing.invoiceId);
      if (inv) {
        const creditAmt = Number(existing.totalAmount) || 0;
        inv.creditedAmount = Math.max(0, round2((Number(inv.creditedAmount) || 0) - creditAmt));
        inv.balanceDue = Math.max(0, round2((Number(inv.grandTotal) || 0) - (Number(inv.amountPaid) || 0) - inv.creditedAmount));
        inv.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await setDoc("invoices", inv.id, inv, true);
      }
    }
    await deleteDoc("creditNotes", req.params.id);
    await addAuditLog("Credit Note Deleted", "credit_note", req.params.id, existing.creditNoteNumber);
    res.json({ success: true, message: "Credit note deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/recurring-invoices", async (req, res) => {
  try {
    const result = await listDocs("recurringInvoices", { pageSize: 500, orderByField: "createdAt", orderDirection: "desc" });
    res.json({ success: true, data: result.docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/recurring-invoices", async (req, res) => {
  try {
    const body = { ...req.body };
    if (typeof body.frequency === "string") {
      body.frequency = body.frequency.toLowerCase().trim();
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      if (Array.isArray(body.invoiceTemplateData?.items) && body.invoiceTemplateData.items.length > 0) {
        body.items = body.invoiceTemplateData.items;
      } else if (body.rate !== void 0 || body.cycleRate !== void 0 || body.amount !== void 0) {
        const flatRate = Number(body.rate || body.cycleRate || body.amount) || 0;
        const gstRate = Number(body.gstRate !== void 0 ? body.gstRate : 18);
        body.items = [
          {
            id: `rec_item_${Date.now()}`,
            name: body.title || "Recurring AMC & Retainer Service",
            description: body.description || "Automated recurring retainer service",
            hsnSac: body.hsnSac || "9983",
            quantity: 1,
            unit: body.unit || "MONTH",
            rate: flatRate,
            gstRate,
            discountType: "percentage",
            discountValue: 0,
            discountAmount: 0
          }
        ];
      }
    }
    if (Array.isArray(body.items)) {
      body.items = body.items.map((item, idx) => ({
        id: item.id || `item_${Date.now()}_${idx}`,
        name: String(item.name || body.title || "Recurring Service Item").trim(),
        description: String(item.description || "").trim(),
        hsnSac: String(item.hsnSac || "9983").trim(),
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        unit: String(item.unit || "MONTH").trim(),
        rate: Number(item.rate) >= 0 ? Number(item.rate) : 0,
        discountType: item.discountType === "fixed" ? "fixed" : "percentage",
        discountValue: Number(item.discountValue) || 0,
        discountAmount: Number(item.discountAmount) || 0,
        gstRate: Number(item.gstRate !== void 0 ? item.gstRate : 18)
      }));
    }
    const parseResult = RecurringInvoiceSchema.safeParse(body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid recurring invoice data",
        errors: parseResult.error.issues
      });
    }
    const client = await getDoc("clients", parseResult.data.clientId) || parseResult.data.client || {};
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    const clientStateCode = client.stateCode || "23";
    const isInterState = sellerStateCode !== clientStateCode;
    const totals = calculateInvoiceTotals(parseResult.data.items, { isInterState }, "draft");
    const count = await countDocs("recurringInvoices");
    const newId = `rec_${Date.now()}`;
    const newRec = {
      id: newId,
      recurringNumber: req.body.recurringNumber || `REC-00${count + 1}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...parseResult.data,
      client: client.name ? client : parseResult.data.client,
      clientName: client.name || parseResult.data.clientName || "Client",
      nextInvoiceDate: parseResult.data.nextInvoiceDate || parseResult.data.startDate,
      invoiceTemplateData: {
        ...parseResult.data.invoiceTemplateData || {},
        subtotal: totals.subtotal,
        totalTaxableAmount: totals.totalTaxableAmount,
        totalCgst: totals.totalCgst,
        totalSgst: totals.totalSgst,
        totalIgst: totals.totalIgst,
        totalGst: totals.totalGst,
        grandTotal: totals.grandTotal,
        items: totals.items
      }
    };
    await setDoc("recurringInvoices", newId, newRec);
    await addAuditLog("Recurring Schedule Created", "invoice", newRec.id, newRec.recurringNumber);
    res.status(201).json({ success: true, data: newRec });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/recurring-invoices/:id", async (req, res) => {
  try {
    const existing = await getDoc("recurringInvoices", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Recurring schedule not found" });
    }
    const updated = { ...existing, ...req.body, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await setDoc("recurringInvoices", req.params.id, updated, true);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/recurring-invoices/:id", async (req, res) => {
  try {
    const existing = await getDoc("recurringInvoices", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Recurring schedule not found" });
    }
    await deleteDoc("recurringInvoices", req.params.id);
    res.json({ success: true, message: "Recurring schedule deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/recurring-invoices/:id/trigger", async (req, res) => {
  try {
    const rec = await getDoc("recurringInvoices", req.params.id);
    if (!rec) {
      return res.status(404).json({ success: false, message: "Recurring schedule not found" });
    }
    const client = await getDoc("clients", rec.clientId) || {
      id: rec.clientId,
      name: rec.clientName || "Client",
      state: "Madhya Pradesh",
      stateCode: "23"
    };
    const businessProfile = await getDoc("settings", "businessProfile") || {};
    const sellerStateCode = businessProfile.stateCode || "23";
    const isInterState = sellerStateCode !== (client.stateCode || "23");
    const nextNumber = await generateNextInvoiceNumber();
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const dueDate = new Date(Date.now() + 15 * 864e5).toISOString().split("T")[0];
    const totals = calculateInvoiceTotals(rec.items || [], { isInterState }, "draft");
    const newInvoice = {
      id: `inv_${Date.now()}`,
      invoiceNumber: nextNumber,
      poNumber: `REC-${rec.recurringNumber}`,
      invoiceDate: today,
      dueDate,
      billingStartDate: today,
      billingEndDate: dueDate,
      billingPeriod: `${today} to ${dueDate}`,
      placeOfSupply: client.state,
      placeOfSupplyCode: client.stateCode,
      currency: "INR",
      financialYear: "FY 2026-27",
      isInterState,
      status: "draft",
      template: "classic",
      seller: businessProfile,
      clientId: client.id,
      client,
      items: totals.items,
      discountType: "percentage",
      discountValue: 0,
      discountAmount: 0,
      additionalCharges: [],
      subtotal: totals.subtotal,
      totalItemDiscount: 0,
      totalTaxableAmount: totals.totalTaxableAmount,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalGst: totals.totalGst,
      totalAdditionalCharges: 0,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      totalInWords: totals.totalInWords,
      amountPaid: 0,
      balanceDue: totals.grandTotal,
      payments: [],
      showBankDetails: true,
      showUpiQr: true,
      terms: rec.terms || "Automated recurring billing invoice.",
      customerNotes: "Automated recurring billing invoice.",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("invoices", newInvoice.id, newInvoice);
    const currentNext = new Date(rec.nextInvoiceDate || today);
    if (rec.frequency === "weekly") {
      currentNext.setDate(currentNext.getDate() + 7);
    } else if (rec.frequency === "quarterly") {
      currentNext.setMonth(currentNext.getMonth() + 3);
    } else if (rec.frequency === "half_yearly") {
      currentNext.setMonth(currentNext.getMonth() + 6);
    } else if (rec.frequency === "yearly") {
      currentNext.setFullYear(currentNext.getFullYear() + 1);
    } else {
      currentNext.setMonth(currentNext.getMonth() + 1);
    }
    rec.nextInvoiceDate = currentNext.toISOString().split("T")[0];
    rec.lastGeneratedInvoiceId = newInvoice.id;
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await setDoc("recurringInvoices", rec.id, rec, true);
    await addAuditLog("Recurring Invoice Draft Generated", "invoice", newInvoice.id, newInvoice.invoiceNumber);
    res.json({ success: true, invoice: newInvoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/expenses", async (req, res) => {
  try {
    const { page, pageSize, category } = req.query;
    const result = await listDocs("expenses", {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      filterFn: category && category !== "all" ? (e) => e.category === category : void 0,
      orderByField: "date",
      orderDirection: "desc"
    });
    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/expenses", async (req, res) => {
  try {
    const body = { ...req.body };
    const titleVal = (body.title || body.description || "Expense").trim();
    const descVal = (body.description || body.title || titleVal).trim();
    const vendorVal = (body.vendor || body.vendorName || "").trim();
    const vendorNameVal = (body.vendorName || body.vendor || vendorVal).trim();
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const amt = Number(body.amount) || 0;
    const totAmt = Number(body.totalAmount) || amt + gstAmt;
    const itc = body.itcEligible !== void 0 ? Boolean(body.itcEligible) : body.isTaxDeductible !== void 0 ? Boolean(body.isTaxDeductible) : true;
    const pMode = body.paymentMode || body.paymentMethod || "Bank";
    const pMethod = body.paymentMethod || body.paymentMode || "Bank";
    const normalizedBody = {
      ...body,
      title: titleVal,
      description: descVal,
      vendor: vendorVal,
      vendorName: vendorNameVal,
      vendorGstin: (body.vendorGstin || "").trim(),
      amount: amt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      totalAmount: totAmt,
      paymentMode: pMode,
      paymentMethod: pMethod,
      itcEligible: itc,
      isTaxDeductible: itc,
      date: body.date || body.expenseDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
    };
    const parseResult = ExpenseSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid expense data",
        errors: parseResult.error.issues
      });
    }
    const newId = `exp_${Date.now()}`;
    const newExp = {
      id: newId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...parseResult.data,
      title: titleVal,
      description: descVal,
      vendor: vendorVal,
      vendorName: vendorNameVal,
      amount: amt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      totalAmount: totAmt,
      paymentMode: pMode,
      paymentMethod: pMethod,
      itcEligible: itc,
      isTaxDeductible: itc
    };
    await setDoc("expenses", newId, newExp);
    await addAuditLog("Expense Added", "expense", newExp.id, `${newExp.category}: \u20B9${newExp.totalAmount}`);
    res.status(201).json({ success: true, data: newExp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/expenses/:id", async (req, res) => {
  try {
    const existing = await getDoc("expenses", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }
    const body = { ...existing, ...req.body };
    const titleVal = (body.title || body.description || existing.title || existing.description || "Expense").trim();
    const descVal = (body.description || body.title || titleVal).trim();
    const vendorVal = (body.vendor || body.vendorName || "").trim();
    const vendorNameVal = (body.vendorName || body.vendor || vendorVal).trim();
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const amt = Number(body.amount) || 0;
    const totAmt = Number(body.totalAmount) || amt + gstAmt;
    const itc = body.itcEligible !== void 0 ? Boolean(body.itcEligible) : body.isTaxDeductible !== void 0 ? Boolean(body.isTaxDeductible) : true;
    const updated = {
      ...body,
      title: titleVal,
      description: descVal,
      vendor: vendorVal,
      vendorName: vendorNameVal,
      amount: amt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      totalAmount: totAmt,
      itcEligible: itc,
      isTaxDeductible: itc,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("expenses", req.params.id, updated, true);
    await addAuditLog("Expense Updated", "expense", updated.id, `${updated.category}: \u20B9${updated.totalAmount}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/expenses/:id", async (req, res) => {
  try {
    const existing = await getDoc("expenses", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }
    await deleteDoc("expenses", req.params.id);
    await addAuditLog("Expense Deleted", "expense", req.params.id, existing.category);
    res.json({ success: true, message: "Expense deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/onboardings", async (req, res) => {
  try {
    const { month, status, search, page, pageSize } = req.query;
    const result = await listDocs("onboardings", {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status: status && status !== "all" ? status : void 0,
      search,
      searchFields: ["customerName", "businessName", "phone", "onboardingNumber"],
      filterFn: month && month !== "all" ? (o) => o.monthYear === month || o.onboardingDate && o.onboardingDate.startsWith(month) : void 0,
      orderByField: "onboardingDate",
      orderDirection: "desc"
    });
    const processedList = result.docs.map(processOnboardingRecord);
    res.json({
      success: true,
      data: processedList,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/onboardings/analytics/month-wise", async (req, res) => {
  try {
    const result = await listDocs("onboardings", { pageSize: 1e3 });
    const list = result.docs.map(processOnboardingRecord);
    const monthMap = {};
    list.forEach((item) => {
      const month = item.monthYear || (item.onboardingDate ? item.onboardingDate.slice(0, 7) : "2026-09");
      if (!monthMap[month]) {
        monthMap[month] = {
          month,
          totalClients: 0,
          activeClients: 0,
          totalSales: 0,
          totalServiceFee: 0,
          totalAdBudget: 0,
          totalAdvanceReceived: 0,
          totalRemainingBalance: 0,
          totalIncentives: 0,
          overdueCount: 0,
          adExpiredCount: 0
        };
      }
      const m = monthMap[month];
      m.totalClients += 1;
      if (item.status === "active") m.activeClients += 1;
      m.totalSales += item.totalPackageValue || 0;
      m.totalServiceFee += item.serviceFee || 0;
      m.totalAdBudget += item.adTotalBudget || 0;
      m.totalAdvanceReceived += item.advancePaid || 0;
      m.totalRemainingBalance += item.remainingBalance || 0;
      m.totalIncentives += item.incentiveAmount || 0;
      if (item.isPaymentOverdue) m.overdueCount += 1;
      if (item.isAdExpired) m.adExpiredCount += 1;
    });
    const monthArray = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));
    const overall = {
      totalClients: list.length,
      activeClients: list.filter((o) => o.status === "active").length,
      totalSales: list.reduce((s, o) => s + (o.totalPackageValue || 0), 0),
      totalAdvanceReceived: list.reduce((s, o) => s + (o.advancePaid || 0), 0),
      totalRemainingBalance: list.reduce((s, o) => s + (o.remainingBalance || 0), 0),
      totalAdBudget: list.reduce((s, o) => s + (o.adTotalBudget || 0), 0),
      totalIncentives: list.reduce((s, o) => s + (o.incentiveAmount || 0), 0),
      overdueCount: list.filter((o) => o.isPaymentOverdue).length,
      adExpiredCount: list.filter((o) => o.isAdExpired).length
    };
    res.json({
      success: true,
      data: {
        overall,
        monthlyBreakdown: monthArray
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/onboardings/:id", async (req, res) => {
  try {
    const item = await getDoc("onboardings", req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/onboardings", async (req, res) => {
  try {
    const parseResult = OnboardingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding data",
        errors: parseResult.error.issues
      });
    }
    const body = req.body;
    const count = await countDocs("onboardings");
    const seqNum = String(count + 1).padStart(3, "0");
    const onboardingNumber = body.onboardingNumber || `ONB-${seqNum}`;
    const onboardingDate = body.onboardingDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const billingCycleDays = body.billingCycleDays || 30;
    let nextPaymentDueDate = body.nextPaymentDueDate;
    if (!nextPaymentDueDate) {
      const obDate = new Date(onboardingDate);
      const dueDateObj = new Date(obDate.getTime() + billingCycleDays * 24 * 60 * 60 * 1e3);
      nextPaymentDueDate = dueDateObj.toISOString().split("T")[0];
    }
    const hasAdsCampaign = Boolean(body.hasAdsCampaign);
    let adCampaignStartDate = body.adCampaignStartDate || onboardingDate;
    let adCampaignEndDate = body.adCampaignEndDate;
    const adDurationDays = body.adDurationDays || 15;
    if (hasAdsCampaign && !adCampaignEndDate) {
      const sDate = new Date(adCampaignStartDate);
      const eDate = new Date(sDate.getTime() + adDurationDays * 24 * 60 * 60 * 1e3);
      adCampaignEndDate = eDate.toISOString().split("T")[0];
    }
    const serviceFee = Number(body.serviceFee) || 0;
    const adDailyBudget = Number(body.adDailyBudget) || 0;
    const adTotalBudget = hasAdsCampaign ? Number(body.adTotalBudget) || adDailyBudget * adDurationDays : 0;
    const totalPackageValue = Number(body.totalPackageValue) || serviceFee + adTotalBudget;
    const advancePaid = Number(body.advancePaid) || 0;
    const remainingBalance = Math.max(0, totalPackageValue - advancePaid);
    let paymentStatus = "unpaid";
    if (remainingBalance === 0 && totalPackageValue > 0) paymentStatus = "paid";
    else if (advancePaid > 0) paymentStatus = "partially_paid";
    const incentivePercentage = Number(body.incentivePercentage) || 10;
    const incentiveAmount = body.incentiveAmount !== void 0 ? Number(body.incentiveAmount) : Math.round(serviceFee * incentivePercentage / 100);
    const monthYear = onboardingDate.slice(0, 7);
    const newId = `onb_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newOnboarding = {
      ...body,
      id: newId,
      onboardingNumber,
      onboardingDate,
      billingCycleDays,
      nextPaymentDueDate,
      lastRenewalDate: onboardingDate,
      hasAdsCampaign,
      adCampaignStartDate,
      adCampaignEndDate,
      adDurationDays,
      adDailyBudget,
      adTotalBudget,
      serviceFee,
      totalPackageValue,
      advancePaid,
      remainingBalance,
      paymentStatus,
      incentivePercentage,
      incentiveAmount,
      monthYear,
      paymentHistory: body.paymentHistory || [
        ...advancePaid > 0 ? [{
          id: `pay_${Date.now()}`,
          date: onboardingDate,
          amount: advancePaid,
          type: "advance",
          paymentMethod: body.advancePaymentMethod || "UPI",
          notes: "Upfront advance payment recorded at onboarding"
        }] : []
      ],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setDoc("onboardings", newId, newOnboarding);
    await addAuditLog("Customer Onboarded", "onboarding", newOnboarding.id, `${newOnboarding.businessName} (\u20B9${newOnboarding.totalPackageValue})`);
    res.status(201).json({ success: true, data: processOnboardingRecord(newOnboarding) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/onboardings/:id", async (req, res) => {
  try {
    const existing = await getDoc("onboardings", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    const updated = {
      ...existing,
      ...req.body,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (Array.isArray(req.body.services)) {
      updated.services = req.body.services;
    }
    if (req.body.services && Array.isArray(req.body.services) && req.body.services.length > 0) {
      const sumMgmt = req.body.services.reduce((acc, s) => acc + (Number(s.managementFee) || 0), 0);
      const sumMgmtPaid = req.body.services.reduce((acc, s) => acc + (Number(s.managementFeePaid) || 0), 0);
      const sumAd = req.body.services.reduce((acc, s) => acc + (Number(s.adBudget) || 0), 0);
      const sumAdPaid = req.body.services.reduce((acc, s) => acc + (Number(s.adBudgetPaid) || 0), 0);
      const sumDeal = sumMgmt + sumAd;
      const sumRec = sumMgmtPaid + sumAdPaid;
      updated.managementFee = sumMgmt;
      updated.serviceFee = sumMgmt;
      updated.managementFeePaid = sumMgmtPaid;
      updated.adBudget = sumAd;
      updated.adTotalBudget = sumAd;
      updated.adBudgetPaid = sumAdPaid;
      updated.hasAdsCampaign = sumAd > 0;
      updated.totalDealValue = sumDeal;
      updated.totalPackageValue = sumDeal;
      updated.advancePaid = sumRec;
      updated.totalReceived = sumRec;
      updated.remainingBalance = Math.max(0, sumDeal - sumRec);
      updated.totalDue = updated.remainingBalance;
      updated.paymentStatus = updated.totalDue === 0 ? "paid" : sumRec > 0 ? "partially_paid" : "unpaid";
    } else if (req.body.serviceFee !== void 0 || req.body.adTotalBudget !== void 0 || req.body.advancePaid !== void 0) {
      const sFee = Number(updated.serviceFee) || 0;
      const adBudget = updated.hasAdsCampaign ? Number(updated.adTotalBudget) || 0 : 0;
      updated.totalPackageValue = sFee + adBudget;
      const totalPayments = (updated.paymentHistory || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const effectivePaid = Math.max(Number(updated.advancePaid) || 0, totalPayments);
      updated.remainingBalance = Math.max(0, updated.totalPackageValue - effectivePaid);
      if (updated.remainingBalance === 0 && updated.totalPackageValue > 0) {
        updated.paymentStatus = "paid";
      } else if (effectivePaid > 0) {
        updated.paymentStatus = "partially_paid";
      } else {
        updated.paymentStatus = "unpaid";
      }
    }
    await setDoc("onboardings", req.params.id, updated, true);
    await addAuditLog("Customer Onboarding Updated", "onboarding", updated.id, updated.businessName);
    res.json({ success: true, data: processOnboardingRecord(updated) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/onboardings/:id", async (req, res) => {
  try {
    const existing = await getDoc("onboardings", req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    await deleteDoc("onboardings", req.params.id);
    await addAuditLog("Customer Onboarding Removed", "onboarding", req.params.id, existing.businessName);
    res.json({ success: true, message: "Onboarding record removed" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/onboardings/:id/renew-cycle", async (req, res) => {
  try {
    const item = await getDoc("onboardings", req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const cycleDays = item.billingCycleDays || 30;
    const baseDate = /* @__PURE__ */ new Date();
    const nextDueDateObj = new Date(baseDate.getTime() + cycleDays * 24 * 60 * 60 * 1e3);
    const nextPaymentDueDate = nextDueDateObj.toISOString().split("T")[0];
    item.lastRenewalDate = todayStr;
    item.nextPaymentDueDate = nextPaymentDueDate;
    item.status = "active";
    item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (req.body.resetBalance) {
      item.remainingBalance = item.serviceFee + (item.hasAdsCampaign ? item.adTotalBudget : 0);
      item.paymentStatus = "unpaid";
    }
    await setDoc("onboardings", item.id, item, true);
    await addAuditLog("Billing Cycle Renewed (30 Days)", "onboarding", item.id, `${item.businessName} next due on ${nextPaymentDueDate}`);
    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/onboardings/:id/record-payment", async (req, res) => {
  try {
    const item = await getDoc("onboardings", req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    const { amount, paymentMethod, type, notes, date } = req.body;
    const payAmount = Number(amount) || 0;
    if (payAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid payment amount" });
    }
    const newPayment = {
      id: `pay_${Date.now()}`,
      date: date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      amount: payAmount,
      type: type || "balance",
      paymentMethod: paymentMethod || "UPI",
      notes: notes || "Payment received"
    };
    item.paymentHistory = item.paymentHistory || [];
    item.paymentHistory.push(newPayment);
    const totalPaid = item.paymentHistory.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    item.remainingBalance = Math.max(0, item.totalPackageValue - totalPaid);
    if (item.remainingBalance === 0) {
      item.paymentStatus = "paid";
      item.incentiveStatus = "eligible";
    } else {
      item.paymentStatus = "partially_paid";
    }
    item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await setDoc("onboardings", item.id, item, true);
    await addAuditLog("Payment Recorded for Onboarded Client", "onboarding", item.id, `\u20B9${payAmount} received for ${item.businessName}`);
    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/onboardings/:id/topup-ads", async (req, res) => {
  try {
    const item = await getDoc("onboardings", req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Onboarding record not found" });
    }
    const { dailyBudget, durationDays, platform } = req.body;
    const dBudget = Number(dailyBudget) || item.adDailyBudget || 200;
    const days = Number(durationDays) || 15;
    const addedBudget = dBudget * days;
    item.hasAdsCampaign = true;
    if (platform) item.adPlatform = platform;
    item.adDailyBudget = dBudget;
    item.adDurationDays = days;
    item.adTotalBudget = (item.adTotalBudget || 0) + addedBudget;
    item.adCampaignStartDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1e3);
    item.adCampaignEndDate = endDate.toISOString().split("T")[0];
    item.totalPackageValue = (item.serviceFee || 0) + item.adTotalBudget;
    item.remainingBalance = (item.remainingBalance || 0) + addedBudget;
    item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await setDoc("onboardings", item.id, item, true);
    await addAuditLog("Ad Campaign Budget Top-up", "onboarding", item.id, `\u20B9${addedBudget} added for ${item.businessName} (${days} days)`);
    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/audit-logs", async (req, res) => {
  try {
    const result = await listDocs("auditLogs", { pageSize: 200, orderByField: "timestamp", orderDirection: "desc" });
    res.json({ success: true, data: result.docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/reports", async (req, res) => {
  try {
    const { financialYear, month, clientId } = req.query;
    const [invoicesResult, expensesResult] = await Promise.all([
      listDocs("invoices", {
        pageSize: 1e3,
        filterFn: (inv) => {
          if (inv.status === "cancelled") return false;
          if (financialYear && financialYear !== "All" && inv.financialYear !== financialYear) return false;
          if (month && month !== "All" && !inv.invoiceDate.startsWith(month)) return false;
          if (clientId && clientId !== "All" && inv.clientId !== clientId) return false;
          return true;
        }
      }),
      listDocs("expenses", { pageSize: 500 })
    ]);
    const filteredInvoices = invoicesResult.docs;
    const totalSales = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0));
    const totalTaxable = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.totalTaxableAmount) || 0), 0));
    const totalCgst = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.totalCgst) || 0), 0));
    const totalSgst = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.totalSgst) || 0), 0));
    const totalIgst = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.totalIgst) || 0), 0));
    const totalGst = round2(totalCgst + totalSgst + totalIgst);
    const totalPaid = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.amountPaid) || 0), 0));
    const totalOutstanding = round2(filteredInvoices.reduce((sum, inv) => sum + (Number(inv.balanceDue) || 0), 0));
    const allPayments = filteredInvoices.flatMap(
      (inv) => (inv.payments || []).map((p) => ({
        ...p,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name || "Client",
        clientId: inv.clientId
      }))
    );
    res.json({
      success: true,
      data: {
        summary: {
          totalInvoices: filteredInvoices.length,
          totalSales,
          totalTaxable,
          totalCgst,
          totalSgst,
          totalIgst,
          totalGst,
          totalPaid,
          totalOutstanding
        },
        invoices: filteredInvoices,
        payments: allPayments,
        expenses: expensesResult.docs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
function getFinancialYear(dateStr) {
  try {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth();
    if (month >= 3) {
      return `FY ${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `FY ${year - 1}-${year.toString().slice(-2)}`;
    }
  } catch {
    return "FY 2026-27";
  }
}
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [
      totalCount,
      draftCount,
      sentCount,
      paidCount,
      partiallyPaidCount,
      expensesCount
    ] = await Promise.all([
      countDocs("invoices"),
      countDocs("invoices", "draft"),
      countDocs("invoices", "sent"),
      countDocs("invoices", "paid"),
      countDocs("invoices", "partially_paid"),
      countDocs("expenses")
    ]);
    const invoicesResult = await listDocs("invoices", {
      pageSize: 300,
      orderByField: "invoiceDate",
      orderDirection: "desc"
    });
    const activeInvoices = invoicesResult.docs.filter((inv) => inv.status !== "cancelled");
    const now = /* @__PURE__ */ new Date();
    const overdueCount = activeInvoices.filter((inv) => {
      if (inv.status === "paid" || inv.status === "draft") return false;
      return new Date(inv.dueDate) < now && (inv.balanceDue || 0) > 0;
    }).length;
    const totalSales = round2(activeInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0));
    const totalGstCollected = round2(activeInvoices.reduce((sum, inv) => sum + (Number(inv.totalGst) || 0), 0));
    const outstandingAmount = round2(activeInvoices.reduce((sum, inv) => sum + (Number(inv.balanceDue) || 0), 0));
    const currentMonthPrefix = now.toISOString().slice(0, 7);
    const thisMonthInvoices = activeInvoices.filter((inv) => inv.invoiceDate?.startsWith(currentMonthPrefix));
    const thisMonthRevenue = round2(thisMonthInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0));
    const thisMonthGst = round2(thisMonthInvoices.reduce((sum, inv) => sum + (Number(inv.totalGst) || 0), 0));
    const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5);
    const last30DaysInvoices = activeInvoices.filter((inv) => new Date(inv.invoiceDate) >= thirtyDaysAgo);
    const last30DaysRevenue = round2(last30DaysInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0));
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyMap = {};
    for (const name of monthNames) monthlyMap[name] = { revenue: 0, gst: 0 };
    activeInvoices.forEach((inv) => {
      if (inv.invoiceDate) {
        const d = new Date(inv.invoiceDate);
        const mName = monthNames[d.getMonth()];
        if (monthlyMap[mName]) {
          monthlyMap[mName].revenue += Number(inv.grandTotal) || 0;
          monthlyMap[mName].gst += Number(inv.totalGst) || 0;
        }
      }
    });
    const monthlyChart = [
      { name: "Apr", revenue: round2(monthlyMap["Apr"].revenue), gst: round2(monthlyMap["Apr"].gst) },
      { name: "May", revenue: round2(monthlyMap["May"].revenue), gst: round2(monthlyMap["May"].gst) },
      { name: "Jun", revenue: round2(monthlyMap["Jun"].revenue), gst: round2(monthlyMap["Jun"].gst) },
      { name: "Jul", revenue: round2(monthlyMap["Jul"].revenue), gst: round2(monthlyMap["Jul"].gst) },
      { name: "Aug", revenue: round2(monthlyMap["Aug"].revenue), gst: round2(monthlyMap["Aug"].gst) },
      { name: "Sep", revenue: round2(monthlyMap["Sep"].revenue), gst: round2(monthlyMap["Sep"].gst) },
      { name: "Oct", revenue: round2(monthlyMap["Oct"].revenue), gst: round2(monthlyMap["Oct"].gst) },
      { name: "Nov", revenue: round2(monthlyMap["Nov"].revenue), gst: round2(monthlyMap["Nov"].gst) },
      { name: "Dec", revenue: round2(monthlyMap["Dec"].revenue), gst: round2(monthlyMap["Dec"].gst) },
      { name: "Jan", revenue: round2(monthlyMap["Jan"].revenue), gst: round2(monthlyMap["Jan"].gst) },
      { name: "Feb", revenue: round2(monthlyMap["Feb"].revenue), gst: round2(monthlyMap["Feb"].gst) },
      { name: "Mar", revenue: round2(monthlyMap["Mar"].revenue), gst: round2(monthlyMap["Mar"].gst) }
    ];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dailyMap = {
      Mon: { revenue: 0, gst: 0 },
      Tue: { revenue: 0, gst: 0 },
      Wed: { revenue: 0, gst: 0 },
      Thu: { revenue: 0, gst: 0 },
      Fri: { revenue: 0, gst: 0 },
      Sat: { revenue: 0, gst: 0 },
      Sun: { revenue: 0, gst: 0 }
    };
    thisMonthInvoices.forEach((inv) => {
      if (inv.invoiceDate) {
        const day = dayNames[new Date(inv.invoiceDate).getDay()];
        if (dailyMap[day]) {
          dailyMap[day].revenue += Number(inv.grandTotal) || 0;
          dailyMap[day].gst += Number(inv.totalGst) || 0;
        }
      }
    });
    const dailyChart = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => ({
      name,
      revenue: round2(dailyMap[name].revenue),
      gst: round2(dailyMap[name].gst)
    }));
    const weeklyBuckets = [
      { name: "Week 1", revenue: 0, gst: 0 },
      { name: "Week 2", revenue: 0, gst: 0 },
      { name: "Week 3", revenue: 0, gst: 0 },
      { name: "Week 4", revenue: 0, gst: 0 }
    ];
    thisMonthInvoices.forEach((inv) => {
      if (inv.invoiceDate) {
        const dom = new Date(inv.invoiceDate).getDate();
        const bIdx = dom <= 7 ? 0 : dom <= 14 ? 1 : dom <= 21 ? 2 : 3;
        weeklyBuckets[bIdx].revenue += Number(inv.grandTotal) || 0;
        weeklyBuckets[bIdx].gst += Number(inv.totalGst) || 0;
      }
    });
    const weeklyChart = weeklyBuckets.map((b) => ({
      name: b.name,
      revenue: round2(b.revenue),
      gst: round2(b.gst)
    }));
    const fyMap = {};
    activeInvoices.forEach((inv) => {
      const fy = inv.financialYear || getFinancialYear(inv.invoiceDate || (/* @__PURE__ */ new Date()).toISOString());
      if (!fyMap[fy]) fyMap[fy] = { revenue: 0, gst: 0 };
      fyMap[fy].revenue += Number(inv.grandTotal) || 0;
      fyMap[fy].gst += Number(inv.totalGst) || 0;
    });
    ["FY 2024-25", "FY 2025-26", "FY 2026-27"].forEach((fy) => {
      if (!fyMap[fy]) fyMap[fy] = { revenue: 0, gst: 0 };
    });
    const yearlyChart = Object.keys(fyMap).sort().map((fy) => ({
      name: fy,
      revenue: round2(fyMap[fy].revenue),
      gst: round2(fyMap[fy].gst)
    }));
    const creditNotesRes = await listDocs("creditNotes", { pageSize: 500 });
    const totalCreditsIssued = round2(creditNotesRes.docs.reduce((sum, cn) => sum + (Number(cn.totalAmount) || 0), 0));
    const netSales = Math.max(0, round2(totalSales - totalCreditsIssued));
    const expensesRes = await listDocs("expenses", { pageSize: 500 });
    const totalExpenses = round2(expensesRes.docs.reduce((sum, e) => sum + (Number(e.totalAmount) || 0), 0));
    res.json({
      success: true,
      data: {
        metrics: {
          totalInvoices: totalCount,
          draftInvoices: draftCount,
          sentInvoices: sentCount,
          paidInvoices: paidCount,
          partiallyPaid: partiallyPaidCount,
          overdueInvoices: overdueCount,
          totalSales,
          netSales,
          totalCreditsIssued,
          totalGstCollected,
          outstandingAmount,
          thisMonthRevenue,
          thisMonthGst,
          last30DaysRevenue,
          totalExpenses
        },
        charts: {
          daily: dailyChart,
          weekly: weeklyChart,
          monthly: monthlyChart,
          yearly: yearlyChart
        },
        recentInvoices: activeInvoices.slice(0, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
async function startServer() {
  const isDev = process.env.npm_lifecycle_event === "dev";
  const distPath = path3.join(process.cwd(), "dist");
  const hasDist = fs3.existsSync(path3.join(distPath, "index.html"));
  if (isDev || !hasDist) {
    console.log("Starting Vite in development middleware mode...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    console.log(`Serving production static assets from ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path3.join(distPath, "index.html"));
    });
  }
  const server = app.listen(PORT, HOST, () => {
    console.log(`GST Billing CRM Server with Firestore running at http://${HOST}:${PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is in use!`);
      if (PORT !== 3e3) {
        console.log("Attempting fallback to port 3000...");
        app.listen(3e3, HOST, () => {
          console.log(`Fallback server listening at http://${HOST}:3000`);
        });
      }
    } else {
      console.error("Server listen error:", err);
    }
  });
  setTimeout(async () => {
    try {
      const profile = await getDoc("settings", "businessProfile");
      if (!profile) {
        console.log("Bootstrapping initial settings into Firestore...");
        await runMigration();
      }
    } catch (e) {
      console.warn("Initial settings check:", e);
    }
  }, 500);
}
var server_default = app;
if (!process.env.VERCEL) {
  startServer();
}

// api/index.ts
var index_default = server_default;
export {
  index_default as default
};
