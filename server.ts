import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import {
  getDoc,
  setDoc,
  deleteDoc,
  listDocs,
  countDocs,
  batchSet
} from './src/server/firestoreClient.ts';
import {
  ClientSchema,
  InvoiceSchema,
  QuoteSchema,
  CreditNoteSchema,
  RecurringInvoiceSchema,
  ExpenseSchema,
  OnboardingSchema,
  PaymentRecordSchema
} from './src/server/validation.ts';
import {
  calculateInvoiceTotals,
  calculateLineItem,
  round2,
  numberToIndianWords
} from './src/utils/taxCalculator.ts';
import { calculateBillingPeriod, validateGSTIN } from './src/utils/gstUtils.ts';
import { runMigration, seedRealisticDataset } from './src/server/migrateAndSeed.ts';

const app = express();
// Port resolution:
// In Cloud Run / AI Studio container environment, Nginx binds externally on NGINX_PORT (8080)
// and reverse-proxies all incoming traffic to localhost:3000 (DEFAULT_APP_PORT).
// Trying to bind to 8080 when Nginx is active causes immediate EADDRINUSE crashes.
const isNginxPresent = Boolean(process.env.NGINX_PORT || process.env.DEFAULT_APP_PORT);
const PORT = isNginxPresent
  ? (Number(process.env.DEFAULT_APP_PORT) || 3000)
  : (Number(process.env.PORT) || 3000);
const HOST = '0.0.0.0';

app.use(express.json({ limit: '10mb' }));

// Audit log helper
async function addAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  entityName: string,
  user: string = 'UDM Admin',
  details: string = ''
) {
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
      timestamp: new Date().toISOString()
    };
    await setDoc('auditLogs', id, log);
  } catch (e) {
    console.warn('Could not write audit log:', e);
  }
}

// Generate next invoice number atomically from Firestore settings
let sequenceLock = Promise.resolve();

async function generateNextInvoiceNumber(): Promise<string> {
  return new Promise((resolve, reject) => {
    sequenceLock = sequenceLock.then(async () => {
      try {
        let settings: any = await getDoc('settings', 'invoiceSettings');
        if (!settings) {
          settings = {
            prefix: 'A',
            startingNumber: 1,
            numberPadding: 6,
            nextSequence: 1,
            defaultCurrency: 'INR',
            defaultGstRate: 18,
            defaultPaymentTerms: 'Payment due within 15 days.',
            defaultNotes: 'Thank you for your business!'
          };
        }

        const prefix = settings.prefix || 'A';
        const padding = Number(settings.numberPadding) || 6;
        let currentSeq = Number(settings.nextSequence) || 1;

        // Collision check against Firestore invoices
        let candidate = `${prefix}${String(currentSeq).padStart(padding, '0')}`;
        while (true) {
          const existing = await listDocs('invoices', {
            pageSize: 1,
            filterFn: (inv) => inv.invoiceNumber === candidate
          });
          if (existing.docs.length === 0) {
            break;
          }
          currentSeq++;
          candidate = `${prefix}${String(currentSeq).padStart(padding, '0')}`;
        }

        settings.nextSequence = currentSeq + 1;
        await setDoc('settings', 'invoiceSettings', settings, true);

        // Also sync starting number to businessProfile if present
        const profile = await getDoc('settings', 'businessProfile');
        if (profile) {
          profile.invoicePrefix = prefix;
          profile.invoiceStartingNumber = currentSeq + 1;
          await setDoc('settings', 'businessProfile', profile, true);
        }

        resolve(candidate);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// If an invoice is manually created with a higher sequence number, advance the sequence
async function advanceSequenceIfHigher(providedNumber: string) {
  if (!providedNumber) return;
  const match = providedNumber.match(/^[A-Za-z]+(\d+)$/);
  if (!match) return;

  const numPart = parseInt(match[1], 10);
  if (isNaN(numPart)) return;

  const settings: any = await getDoc('settings', 'invoiceSettings');
  if (settings && numPart >= (settings.nextSequence || 1)) {
    settings.nextSequence = numPart + 1;
    await setDoc('settings', 'invoiceSettings', settings, true);
  }
}

// Hydrate client details on invoice if client document was updated
function hydrateInvoiceWithClient(invoice: any, clientDoc?: any) {
  if (!invoice) return invoice;
  if (clientDoc) {
    return {
      ...invoice,
      client: {
        ...invoice.client,
        ...clientDoc
      }
    };
  }
  return invoice;
}

// Onboarding record processing
function processOnboardingRecord(onb: any) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Process multi-service items if present
  let services: any[] = [];
  if (Array.isArray(onb.services) && onb.services.length > 0) {
    services = onb.services.map((s: any, idx: number) => {
      const sMgmt = Number(s.managementFee) || 0;
      const sMgmtPaid = Number(s.managementFeePaid) || 0;
      const sAd = Number(s.adBudget) || 0;
      const sAdPaid = Number(s.adBudgetPaid) || 0;
      const sVal = s.dealValue !== undefined ? Number(s.dealValue) : (sMgmt + sAd);
      const sRec = s.totalReceived !== undefined ? Number(s.totalReceived) : (sMgmtPaid + sAdPaid);
      const sDue = s.totalDue !== undefined ? Number(s.totalDue) : Math.max(0, sVal - sRec);
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

  const mgmtFee = services.length > 0
    ? services.reduce((acc, s) => acc + s.managementFee, 0)
    : (onb.managementFee !== undefined ? Number(onb.managementFee) : (Number(onb.serviceFee) || 0));

  const adBudgetVal = services.length > 0
    ? services.reduce((acc, s) => acc + s.adBudget, 0)
    : (onb.adBudget !== undefined ? Number(onb.adBudget) : (Number(onb.adTotalBudget) || 0));

  const totalDealVal = onb.totalDealValue !== undefined
    ? Number(onb.totalDealValue)
    : (mgmtFee + adBudgetVal);

  const mgmtReceived = services.length > 0
    ? services.reduce((acc, s) => acc + s.managementFeePaid, 0)
    : (onb.managementFeePaid !== undefined ? Number(onb.managementFeePaid) : 0);

  const adReceived = services.length > 0
    ? services.reduce((acc, s) => acc + s.adBudgetPaid, 0)
    : (onb.adBudgetPaid !== undefined ? Number(onb.adBudgetPaid) : 0);

  const totalRec = onb.advancePaid !== undefined
    ? Number(onb.advancePaid)
    : (onb.totalReceived !== undefined ? Number(onb.totalReceived) : (mgmtReceived + adReceived));

  const totalDueVal = onb.totalDue !== undefined
    ? Number(onb.totalDue)
    : Math.max(0, totalDealVal - totalRec);

  let nextDueDate = onb.nextPaymentDueDate;
  if (!nextDueDate && onb.onboardingDate) {
    const obDate = new Date(onb.onboardingDate);
    const cycleDays = onb.billingCycleDays || 30;
    const computedDue = new Date(obDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);
    nextDueDate = computedDue.toISOString().split('T')[0];
  }

  let isPaymentOverdue = false;
  let daysUntilPaymentDue = 0;
  if (nextDueDate) {
    const dueTime = new Date(nextDueDate).getTime();
    const diffMs = dueTime - today.getTime();
    daysUntilPaymentDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysUntilPaymentDue < 0 && (totalDueVal > 0 || onb.paymentStatus !== 'paid')) {
      isPaymentOverdue = true;
    }
  }

  let isAdExpired = false;
  let daysUntilAdExpiry: number | null = null;
  if (onb.hasAdsCampaign && onb.adCampaignEndDate) {
    const endTime = new Date(onb.adCampaignEndDate).getTime();
    const diffMs = endTime - today.getTime();
    daysUntilAdExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysUntilAdExpiry < 0) {
      isAdExpired = true;
    }
  } else if (onb.hasAdsCampaign && onb.adDurationDays && onb.adCampaignStartDate) {
    const startTime = new Date(onb.adCampaignStartDate);
    const endTime = new Date(startTime.getTime() + (onb.adDurationDays || 15) * 24 * 60 * 60 * 1000);
    const diffMs = endTime.getTime() - today.getTime();
    daysUntilAdExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysUntilAdExpiry < 0) {
      isAdExpired = true;
    }
  }

  return {
    ...onb,
    services: services.length > 0 ? services : (Array.isArray(onb.services) ? onb.services : undefined),
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
    salesManager: onb.salesManager || onb.assignedExecutive || 'Sankalp',
    assignedExecutive: onb.salesManager || onb.assignedExecutive || 'Sankalp',
    remarks: onb.remarks || onb.notes || '',
    notes: onb.remarks || onb.notes || '',
    nextPaymentDueDate: nextDueDate,
    isPaymentOverdue,
    daysUntilPaymentDue,
    isAdExpired,
    daysUntilAdExpiry
  };
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// System Health & Diagnostics (Serves root /health for Cloud Run / K8s readiness probes)
app.get(['/health', '/api/health', '/api/admin/health'], async (req, res) => {
  try {
    const [invoicesCount, clientsCount, quotesCount, expensesCount, onboardingsCount] = await Promise.all([
      countDocs('invoices').catch(() => 0),
      countDocs('clients').catch(() => 0),
      countDocs('quotes').catch(() => 0),
      countDocs('expenses').catch(() => 0),
      countDocs('onboardings').catch(() => 0)
    ]);

    res.json({
      success: true,
      database: 'Firestore',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      counts: {
        invoices: invoicesCount,
        clients: clientsCount,
        quotes: quotesCount,
        expenses: expensesCount,
        onboardings: onboardingsCount
      }
    });
  } catch (err: any) {
    // Return 200 with degraded note so Cloud Run health checks don't fail during transient db warmup
    res.status(200).json({ success: true, status: 'healthy', degraded: true, error: err.message });
  }
});

// Admin Migration & Seeding Endpoint
app.post('/api/admin/migrate-and-seed', async (req, res) => {
  try {
    const { action, targetCount } = req.body;
    let result: any = {};

    if (action === 'migrate' || !action) {
      result.migration = await runMigration();
    }
    if (action === 'seed' || action === 'all') {
      result.seeding = await seedRealisticDataset(targetCount || 1000);
    }

    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auth Endpoints
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = (await getDoc('users', 'usr_admin')) || {
      id: 'usr_admin',
      email: 'sakshi.udmtechno@gmail.com',
      name: 'Sakshi (UDM Admin)',
      role: 'admin'
    };
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanUser = (email || '').toString().trim().toLowerCase();
    const cleanPass = (password || '').toString().trim();

    if (!cleanUser || !cleanPass) {
      return res.status(400).json({
        success: false,
        message: 'Username/Email and password are required.'
      });
    }

    // Known authorized credential mappings
    const isAdminUser =
      cleanUser === 'sankalp123' ||
      cleanUser === 'sankalpnayakk@gmail.com' ||
      cleanUser === 'sankalp' ||
      cleanUser === 'sankap123' ||
      cleanUser === 'admin' ||
      cleanUser === 'sakshi.udmtechno@gmail.com';

    const isSalesUser =
      cleanUser === 'sales@udmtechno.com' ||
      cleanUser === 'mahendra' ||
      cleanUser === 'sales';

    let authenticatedRole: string | null = null;
    let userName = 'UDM User';
    let userId = `usr_${Date.now()}`;

    // Admin password checks
    if (isAdminUser) {
      const isValidAdminPass =
        cleanPass === 'Sankalp@321' ||
        cleanPass.toLowerCase() === 'sankalp@321' ||
        cleanPass === 'Udm@2026' ||
        cleanPass === 'Sankap@321';

      if (isValidAdminPass) {
        authenticatedRole = 'admin';
        userName = cleanUser.includes('sakshi') ? 'Sakshi (UDM Admin)' : 'Sankalp Nayak (UDM Admin)';
        userId = 'usr_admin';
      }
    } else if (isSalesUser) {
      const isValidSalesPass =
        cleanPass === 'Sales@321' ||
        cleanPass.toLowerCase() === 'sales@321' ||
        cleanPass === 'Udm@2026';

      if (isValidSalesPass) {
        authenticatedRole = 'sales_manager';
        userName = 'Mahendra (Sales Manager)';
        userId = 'usr_sales';
      }
    } else {
      // Check in Firestore users collection
      const userList = await listDocs('users', {
        pageSize: 10,
        filterFn: (u: any) => u.email?.toLowerCase() === cleanUser || u.username?.toLowerCase() === cleanUser
      });

      if (userList.docs.length > 0) {
        const found = userList.docs[0];
        if (found.password && found.password === cleanPass) {
          authenticatedRole = found.role || 'admin';
          userName = found.name || 'UDM User';
          userId = found.id;
        }
      }
    }

    if (!authenticatedRole) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password. Please verify your credentials.'
      });
    }

    const sessionDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 Days
    const expiresAt = Date.now() + sessionDurationMs;
    const token = `udm_token_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const userData = {
      id: userId,
      email: cleanUser,
      username: cleanUser,
      name: userName,
      role: authenticatedRole,
      permissions: authenticatedRole === 'admin' ? ['all'] : ['onboarding', 'quotes', 'invoices_create', 'clients'],
      expiresAt
    };

    // Upsert into users collection
    await setDoc('users', userId, userData, true);
    await addAuditLog('User Login', 'user', userId, `${userName} (${authenticatedRole})`);

    res.json({
      success: true,
      token,
      expiresAt,
      sessionDurationDays: 7,
      user: userData,
      data: userData
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Business Profile
app.get('/api/business-profile', async (req, res) => {
  try {
    let profile = await getDoc('settings', 'businessProfile');
    if (!profile) {
      profile = {
        businessName: 'UDM Techno Solutions',
        legalName: 'UDM Techno Solutions Pvt Ltd',
        gstin: '23AHWPH3168H2Z2',
        pan: 'AHWPH3168H',
        state: 'Madhya Pradesh',
        stateCode: '23',
        city: 'Indore',
        address: '101, IT Park Road',
        pinCode: '452001',
        country: 'India',
        email: 'billing@udmtechno.com',
        phone: '',
        authorizedSignatoryName: 'Authorized Signatory'
      };
      await setDoc('settings', 'businessProfile', profile, true);
    }
    res.json({ success: true, data: profile });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/business-profile', async (req, res) => {
  try {
    const existing = (await getDoc('settings', 'businessProfile')) || {};
    const updated = {
      ...existing,
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    await setDoc('settings', 'businessProfile', updated, true);

    // Sync invoice prefix / starting number to invoiceSettings if provided
    if (req.body.invoicePrefix !== undefined || req.body.invoiceStartingNumber !== undefined) {
      const invSettings = (await getDoc('settings', 'invoiceSettings')) || {};
      if (req.body.invoicePrefix !== undefined) {
        invSettings.prefix = req.body.invoicePrefix;
      }
      if (req.body.invoiceStartingNumber !== undefined) {
        const startNum = Number(req.body.invoiceStartingNumber) || 1;
        invSettings.startingNumber = startNum;
        invSettings.nextSequence = startNum;
      }
      await setDoc('settings', 'invoiceSettings', invSettings, true);
    }

    await addAuditLog('Business Profile Updated', 'settings', 'businessProfile', updated.businessName);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Settings (invoice, tax, payment, pdf)
app.get('/api/settings', async (req, res) => {
  try {
    const [invoiceSettings, taxSettings, paymentSettings, pdfSettings] = await Promise.all([
      getDoc('settings', 'invoiceSettings'),
      getDoc('settings', 'taxSettings'),
      getDoc('settings', 'paymentSettings'),
      getDoc('settings', 'pdfSettings')
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { invoiceSettings, taxSettings, paymentSettings, pdfSettings } = req.body;

    if (invoiceSettings) {
      const existing = (await getDoc('settings', 'invoiceSettings')) || {};
      const updatedInv = { ...existing, ...invoiceSettings };
      await setDoc('settings', 'invoiceSettings', updatedInv, true);

      // Sync prefix to businessProfile
      const bp = await getDoc('settings', 'businessProfile');
      if (bp) {
        if (invoiceSettings.prefix) bp.invoicePrefix = invoiceSettings.prefix;
        if (invoiceSettings.startingNumber || invoiceSettings.nextSequence) {
          bp.invoiceStartingNumber = Number(invoiceSettings.startingNumber || invoiceSettings.nextSequence);
        }
        await setDoc('settings', 'businessProfile', bp, true);
      }
    }
    if (taxSettings) {
      const existing = (await getDoc('settings', 'taxSettings')) || {};
      await setDoc('settings', 'taxSettings', { ...existing, ...taxSettings }, true);
    }
    if (paymentSettings) {
      const existing = (await getDoc('settings', 'paymentSettings')) || {};
      await setDoc('settings', 'paymentSettings', { ...existing, ...paymentSettings }, true);
    }
    if (pdfSettings) {
      const existing = (await getDoc('settings', 'pdfSettings')) || {};
      await setDoc('settings', 'pdfSettings', { ...existing, ...pdfSettings }, true);
    }

    await addAuditLog('Settings Updated', 'settings', 'app_settings', 'System Settings');
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Next Invoice Number
app.get('/api/invoices/next-number', async (req, res) => {
  try {
    let settings: any = await getDoc('settings', 'invoiceSettings');
    if (!settings) {
      settings = {
        prefix: 'A',
        startingNumber: 1,
        numberPadding: 6,
        nextSequence: 1
      };
    }
    const prefix = settings.prefix || 'A';
    const padding = Number(settings.numberPadding) || 6;
    const currentSeq = Number(settings.nextSequence) || 1;
    const invoiceNumber = `${prefix}${String(currentSeq).padStart(padding, '0')}`;

    res.json({ success: true, invoiceNumber, nextSequence: currentSeq });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CLIENTS CRUD
// -------------------------------------------------------------
app.get('/api/clients', async (req, res) => {
  try {
    const { page, pageSize, search, customerType } = req.query;
    const result = await listDocs('clients', {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      search: search as string,
      searchFields: ['name', 'clientNumber', 'email', 'phone', 'city', 'state', 'gstin'],
      filterFn: customerType && customerType !== 'all' ? (c) => c.customerType === customerType : undefined,
      orderByField: 'createdAt',
      orderDirection: 'desc'
    });

    // Auto-discover and ensure any clients from existing invoices or quotes are included
    try {
      const invoicesResult = await listDocs('invoices', { pageSize: 500 });
      const quotesResult = await listDocs('quotes', { pageSize: 500 });

      const existingNames = new Set(result.docs.map((c: any) => c.name?.toLowerCase().trim()));
      const existingIds = new Set(result.docs.map((c: any) => c.id));

      const discoverClient = (cl: any) => {
        if (!cl || !cl.name || typeof cl.name !== 'string' || !cl.name.trim()) return;
        const normName = cl.name.toLowerCase().trim();
        if (!existingNames.has(normName) && (!cl.id || !existingIds.has(cl.id))) {
          existingNames.add(normName);
          const cId = cl.id || `client_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          existingIds.add(cId);

          const clientDoc = {
            id: cId,
            clientNumber: cl.clientNumber || `CLI-${String(result.docs.length + 1).padStart(3, '0')}`,
            name: cl.name.trim(),
            contactPerson: cl.contactPerson || cl.name.trim(),
            email: cl.email || '',
            phone: cl.phone || '',
            billingAddress: cl.billingAddress || 'Not Provided',
            shippingAddress: cl.shippingAddress || '',
            city: cl.city || '',
            state: cl.state || 'Madhya Pradesh',
            stateCode: cl.stateCode || '23',
            country: cl.country || 'India',
            pinCode: cl.pinCode || '',
            gstin: cl.gstin || '',
            pan: cl.pan || '',
            customerType: cl.customerType || 'B2B',
            createdAt: cl.createdAt || new Date().toISOString()
          };

          result.docs.push(clientDoc);
          setDoc('clients', cId, clientDoc).catch(() => {});
        }
      };

      for (const inv of invoicesResult.docs) {
        const clientCandidate = inv.client || (inv.clientName ? {
          name: inv.clientName,
          phone: inv.phone || '',
          email: inv.email || '',
          billingAddress: inv.address || 'Not Provided',
          state: inv.placeOfSupply || 'Madhya Pradesh',
          stateCode: inv.placeOfSupplyCode || '23',
          gstin: inv.clientGstin || ''
        } : null);
        discoverClient(clientCandidate);
      }
      for (const q of quotesResult.docs) {
        const quoteClientCandidate = q.client || (q.clientName || q.customerName ? {
          name: q.clientName || q.customerName,
          phone: q.clientPhone || q.phone || '',
          email: q.clientEmail || q.email || '',
          billingAddress: q.clientAddress || q.address || 'Not Provided',
          state: q.placeOfSupply || 'Madhya Pradesh',
          stateCode: q.placeOfSupplyCode || '23',
          gstin: q.clientGstin || ''
        } : null);
        discoverClient(quoteClientCandidate);
      }
    } catch (e) {
      // Non-blocking discovery
    }

    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.docs.length,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: false
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await getDoc('clients', req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    // Get client's invoices
    const invoicesResult = await listDocs('invoices', {
      filterFn: (inv) => inv.clientId === req.params.id,
      pageSize: 500
    });

    const clientInvoices = invoicesResult.docs;
    const totalBilled = clientInvoices.reduce((sum, inv) => sum + (inv.status !== 'cancelled' ? inv.grandTotal : 0), 0);
    const totalPaid = clientInvoices.reduce((sum, inv) => sum + (inv.status !== 'cancelled' ? inv.amountPaid : 0), 0);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const parseResult = ClientSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = 'Invalid client data: ' + parseResult.error.issues.map(i => `${i.path.join('.') || 'field'}: ${i.message}`).join(', ');
      console.warn('POST /api/clients validation failed:', errorMsg, 'Payload:', req.body);
      return res.status(400).json({
        success: false,
        message: errorMsg,
        errors: parseResult.error.issues
      });
    }

    const currentCount = await countDocs('clients');
    const newId = `client_${Date.now()}`;
    const newClient = {
      id: newId,
      clientNumber: `CLI-${String(currentCount + 1).padStart(3, '0')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...parseResult.data
    };

    await setDoc('clients', newId, newClient);
    await addAuditLog('Client Created', 'client', newClient.id, newClient.name);

    res.status(201).json({ success: true, data: newClient });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const existing = await getDoc('clients', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const parseResult = ClientSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client update',
        errors: parseResult.error.issues
      });
    }

    const updatedClient = {
      ...existing,
      ...parseResult.data,
      updatedAt: new Date().toISOString()
    };

    await setDoc('clients', req.params.id, updatedClient, true);
    await addAuditLog('Client Updated', 'client', updatedClient.id, updatedClient.name);

    res.json({ success: true, data: updatedClient });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const clientId = req.params.id;
    const existing = await getDoc('clients', clientId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const force = req.query.force === 'true';

    // Check for dependent records
    const [linkedInvoices, linkedQuotes, linkedRecurring] = await Promise.all([
      listDocs('invoices', { pageSize: 50, filterFn: (inv: any) => inv.clientId === clientId }),
      listDocs('quotes', { pageSize: 50, filterFn: (q: any) => q.clientId === clientId }),
      listDocs('recurringInvoices', { pageSize: 50, filterFn: (r: any) => r.clientId === clientId })
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

    await deleteDoc('clients', clientId);
    await addAuditLog('Client Deleted', 'client', clientId, `${existing.name}${force ? ' (Force deleted with dependencies)' : ''}`);

    res.json({ success: true, message: 'Client deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// INVOICES & PAYMENTS LOGIC
// -------------------------------------------------------------

export function normalizeInvoicePayments(invoice: any): { invoice: any; hasChanged: boolean } {
  if (!invoice) return { invoice, hasChanged: false };
  let payments = Array.isArray(invoice.payments) ? [...invoice.payments] : [];
  let hasChanged = false;

  const advanceAmt = Number(invoice.advanceAmount) || 0;
  const paidAmt = Number(invoice.amountPaid) || 0;
  const initialRecorded = advanceAmt > 0 ? advanceAmt : paidAmt;

  if (payments.length === 0 && initialRecorded > 0) {
    const serviceName = (invoice.items && invoice.items.length > 0)
      ? invoice.items.map((i: any) => i.name).filter(Boolean).join(', ')
      : (invoice.servicePackage || 'Invoice Services');

    const initialAdvancePayment = {
      id: `pay_adv_${invoice.id}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientId: invoice.clientId || invoice.client?.id || '',
      clientName: invoice.client?.name || invoice.clientName || 'Client',
      serviceName,
      dealId: invoice.dealId || '',
      dealTitle: invoice.dealTitle || '',
      amount: round2(initialRecorded),
      paymentDate: invoice.invoiceDate || (invoice.createdAt ? invoice.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
      paymentType: (initialRecorded >= (Number(invoice.grandTotal) || 0) && (Number(invoice.grandTotal) || 0) > 0) ? 'Full Payment' : 'Advance',
      paymentMethod: invoice.paymentMethod || 'Bank Transfer',
      transactionId: 'INITIAL-ADVANCE',
      notes: 'Initial payment recorded at invoice creation',
      remainingBalance: round2(Math.max(0, (Number(invoice.grandTotal) || 0) - initialRecorded)),
      createdAt: invoice.createdAt || new Date().toISOString()
    };
    payments.push(initialAdvancePayment);
    invoice.payments = payments;
    invoice.amountPaid = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    invoice.balanceDue = round2(Math.max(0, (Number(invoice.grandTotal) || 0) - invoice.amountPaid));
    hasChanged = true;
  } else if (payments.length > 0) {
    // Ensure all existing payments have clientName, invoiceNumber, serviceName populated
    let paymentsUpdated = false;
    payments = payments.map((p: any) => {
      const clientName = p.clientName || invoice.client?.name || invoice.clientName || 'Client';
      const invoiceNumber = p.invoiceNumber || invoice.invoiceNumber || '';
      const serviceName = p.serviceName || (
        (invoice.items && invoice.items.length > 0)
          ? invoice.items.map((i: any) => i.name).filter(Boolean).join(', ')
          : (invoice.servicePackage || 'Invoice Services')
      );
      if (!p.clientName || !p.invoiceNumber || !p.serviceName) {
        paymentsUpdated = true;
        return {
          ...p,
          clientName,
          invoiceNumber,
          serviceName
        };
      }
      return p;
    });

    if (paymentsUpdated) {
      invoice.payments = payments;
      hasChanged = true;
    }

    const actualPaid = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const actualBal = round2(Math.max(0, (Number(invoice.grandTotal) || 0) - actualPaid));
    if (invoice.amountPaid !== actualPaid || invoice.balanceDue !== actualBal) {
      invoice.amountPaid = actualPaid;
      invoice.balanceDue = actualBal;
      hasChanged = true;
    }
  }

  // Update status if needed
  if (invoice.status !== 'draft' && invoice.status !== 'cancelled') {
    const bal = Number(invoice.balanceDue) || 0;
    const paid = Number(invoice.amountPaid) || 0;
    const grand = Number(invoice.grandTotal) || 0;
    if (bal <= 0.01 && grand > 0 && invoice.status !== 'paid') {
      invoice.status = 'paid';
      hasChanged = true;
    } else if (paid > 0 && bal > 0.01 && invoice.status !== 'partially_paid') {
      invoice.status = 'partially_paid';
      hasChanged = true;
    }
  }

  return { invoice, hasChanged };
}

app.get('/api/invoices', async (req, res) => {
  try {
    const { page, pageSize, status, search, financialYear, clientId, orderBy, orderDir } = req.query;

    const result = await listDocs('invoices', {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status: status as string,
      search: search as string,
      searchFields: ['invoiceNumber', 'poNumber'],
      filterFn: (inv) => {
        if (financialYear && financialYear !== 'All' && inv.financialYear !== financialYear) return false;
        if (clientId && clientId !== 'All' && inv.clientId !== clientId) return false;
        return true;
      },
      orderByField: (orderBy as string) || 'invoiceDate',
      orderDirection: (orderDir as any) || 'desc'
    });

    // Normalize each invoice so that amountPaid and balanceDue strictly reflect the payments array
    for (const inv of result.docs) {
      const { hasChanged } = normalizeInvoicePayments(inv);
      if (hasChanged) {
        setDoc('invoices', inv.id, inv, true).catch(() => {});
      }
    }

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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await getDoc('invoices', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const { hasChanged } = normalizeInvoicePayments(invoice);
    if (hasChanged) {
      await setDoc('invoices', invoice.id, invoice, true);
    }
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const parseResult = InvoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice data',
        errors: parseResult.error.issues
      });
    }

    let invoiceData: any = { ...req.body };

    // Get seller state code
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';

    // Invoice sequential numbering
    if (!invoiceData.invoiceNumber || invoiceData.invoiceNumber === 'AUTO' || invoiceData.invoiceNumber.startsWith('DRAFT-')) {
      if (invoiceData.status !== 'draft') {
        invoiceData.invoiceNumber = await generateNextInvoiceNumber();
      } else {
        invoiceData.invoiceNumber = invoiceData.invoiceNumber || `DRAFT-${Date.now().toString().slice(-4)}`;
      }
    } else {
      // Validate that provided invoice number doesn't already exist
      const existingInv = await listDocs('invoices', {
        pageSize: 1,
        filterFn: (inv: any) => inv.invoiceNumber === invoiceData.invoiceNumber
      });
      if (existingInv.docs.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invoice #${invoiceData.invoiceNumber} already exists in the system. Please use a unique invoice number.`
        });
      }
      await advanceSequenceIfHigher(invoiceData.invoiceNumber);
    }

    // Auto 30-day billing calculation
    const billingInfo = calculateBillingPeriod(invoiceData.billingStartDate || invoiceData.invoiceDate);
    invoiceData.billingStartDate = invoiceData.billingStartDate || billingInfo.startDate;
    invoiceData.billingEndDate = invoiceData.billingEndDate || billingInfo.endDate;
    invoiceData.billingPeriod = invoiceData.billingPeriod || billingInfo.formattedPeriod;

    // Resolve client
    if (invoiceData.clientId) {
      const client = await getDoc('clients', invoiceData.clientId);
      if (client) {
        invoiceData.client = { ...invoiceData.client, ...client };
      }
    } else if (invoiceData.client && invoiceData.client.name) {
      const existingClients = await listDocs('clients', {
        search: invoiceData.client.name,
        searchFields: ['name'],
        pageSize: 5
      });
      const matched = existingClients.docs.find(
        c => c.name.toLowerCase().trim() === invoiceData.client.name.toLowerCase().trim()
      );
      if (matched) {
        invoiceData.clientId = matched.id;
        invoiceData.client = { ...invoiceData.client, ...matched };
      } else {
        const count = await countDocs('clients');
        const newClientId = `client_${Date.now()}`;
        const createdClient = {
          id: newClientId,
          clientNumber: `CLI-${String(count + 1).padStart(3, '0')}`,
          name: invoiceData.client.name,
          contactPerson: invoiceData.client.contactPerson || '',
          email: invoiceData.client.email || '',
          phone: invoiceData.client.phone || '',
          billingAddress: invoiceData.client.billingAddress || '',
          city: invoiceData.client.city || '',
          state: invoiceData.client.state || invoiceData.placeOfSupply || 'Madhya Pradesh',
          stateCode: invoiceData.client.stateCode || invoiceData.placeOfSupplyCode || '23',
          country: invoiceData.client.country || 'India',
          pinCode: invoiceData.client.pinCode || '',
          gstin: invoiceData.client.gstin || '',
          pan: invoiceData.client.pan || '',
          customerType: invoiceData.client.customerType || 'B2B',
          createdAt: new Date().toISOString()
        };
        await setDoc('clients', newClientId, createdClient);
        invoiceData.clientId = newClientId;
        invoiceData.client = createdClient;
      }
    }

    const placeOfSupplyCode = invoiceData.placeOfSupplyCode || invoiceData.client?.stateCode || '23';
    const isInterState = sellerStateCode !== placeOfSupplyCode;

    // Canonical Server-Side GST & Totals Recalculation
    const advance = round2(Number(invoiceData.advanceAmount) || 0);
    const existingPayments = Array.isArray(invoiceData.payments) ? invoiceData.payments : [];
    const paymentsTotal = round2(existingPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0));

    const calculatedTotals = calculateInvoiceTotals(invoiceData.items, {
      isInterState,
      isReverseCharge: invoiceData.isReverseCharge,
      discountType: invoiceData.discountType,
      discountValue: invoiceData.discountValue,
      additionalCharges: invoiceData.additionalCharges,
      advanceAmount: advance,
      paymentsTotal
    }, invoiceData.status || 'draft');

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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', newId, newInvoice);
    await addAuditLog(
      newInvoice.status === 'draft' ? 'Draft Invoice Created' : 'Invoice Created & Finalized',
      'invoice',
      newInvoice.id,
      `${newInvoice.invoiceNumber} (${newInvoice.client?.name || 'Client'})`,
      'UDM Admin',
      `Total: ₹${newInvoice.grandTotal} | Bal: ₹${newInvoice.balanceDue}`
    );

    res.status(201).json({ success: true, data: newInvoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const existing = await getDoc('invoices', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const parseResult = InvoiceSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice update',
        errors: parseResult.error.issues
      });
    }

    const updateData: any = { ...req.body };

    // Finalize invoice number if transitioning from draft
    if (existing.status === 'draft' && updateData.status !== 'draft' && (!updateData.invoiceNumber || updateData.invoiceNumber.startsWith('DRAFT-'))) {
      updateData.invoiceNumber = await generateNextInvoiceNumber();
    } else if (updateData.invoiceNumber) {
      await advanceSequenceIfHigher(updateData.invoiceNumber);
    }

    // Auto 30-day billing calculation
    if (updateData.billingStartDate || updateData.invoiceDate) {
      const billingInfo = calculateBillingPeriod(updateData.billingStartDate || updateData.invoiceDate);
      updateData.billingStartDate = updateData.billingStartDate || billingInfo.startDate;
      updateData.billingEndDate = billingInfo.endDate;
      updateData.billingPeriod = billingInfo.formattedPeriod;
    }

    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const placeOfSupplyCode = updateData.placeOfSupplyCode || existing.placeOfSupplyCode || '23';
    const isInterState = sellerStateCode !== placeOfSupplyCode;

    const items = updateData.items || existing.items || [];
    const advance = updateData.advanceAmount !== undefined ? round2(Number(updateData.advanceAmount) || 0) : existing.advanceAmount;
    const payments = Array.isArray(updateData.payments) ? updateData.payments : (existing.payments || []);
    const paymentsTotal = round2(payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0));

    // Canonical server-side recalculation
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
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', req.params.id, updatedInvoice, true);
    await addAuditLog('Invoice Updated', 'invoice', updatedInvoice.id, updatedInvoice.invoiceNumber);

    res.json({ success: true, data: updatedInvoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const existing = await getDoc('invoices', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    await deleteDoc('invoices', req.params.id);
    await addAuditLog('Invoice Deleted', 'invoice', req.params.id, existing.invoiceNumber);

    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Payments for Invoice
app.get('/api/invoices/:id/payments', async (req, res) => {
  try {
    const rawInvoice = await getDoc('invoices', req.params.id);
    if (!rawInvoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const { invoice, hasChanged } = normalizeInvoicePayments(rawInvoice);
    if (hasChanged) {
      await setDoc('invoices', invoice.id, invoice, true);
    }
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    res.json({
      success: true,
      data: payments,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client?.name || invoice.clientName || 'Client',
      grandTotal: invoice.grandTotal || 0,
      amountPaid: invoice.amountPaid || 0,
      balanceDue: invoice.balanceDue || 0,
      status: invoice.status
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Global Payments Listing (filtered by invoiceId or clientId)
app.get('/api/payments', async (req, res) => {
  try {
    const { invoiceId, clientId, type } = req.query;
    const invoicesResult = await listDocs('invoices', { pageSize: 500 });
    let allPayments: any[] = [];
    for (const inv of invoicesResult.docs) {
      const { invoice: normalizedInv, hasChanged } = normalizeInvoicePayments(inv);
      if (hasChanged) {
        setDoc('invoices', normalizedInv.id, normalizedInv, true).catch(() => {});
      }
      const invPayments = Array.isArray(normalizedInv.payments) ? normalizedInv.payments : [];
      for (const p of invPayments) {
        allPayments.push({
          ...p,
          invoiceId: normalizedInv.id,
          invoiceNumber: normalizedInv.invoiceNumber,
          clientName: normalizedInv.client?.name || normalizedInv.clientName || p.clientName || 'Client',
          clientId: normalizedInv.clientId || normalizedInv.client?.id || p.clientId || '',
          invoiceGrandTotal: normalizedInv.grandTotal || 0,
          invoiceBalanceDue: normalizedInv.balanceDue || 0
        });
      }
    }

    // Also include Renewal Payments from recurring invoices (AMC)
    try {
      const recurringResult = await listDocs('recurringInvoices', { pageSize: 500 });
      for (const rec of recurringResult.docs) {
        const recPayments = Array.isArray(rec.renewalPayments) ? rec.renewalPayments : [];
        for (const rp of recPayments) {
          allPayments.push({
            id: rp.id,
            clientId: rp.clientId || rec.clientId,
            clientName: rp.clientName || rec.clientName || 'Client',
            serviceName: rp.serviceName || rec.serviceName || rec.title || 'Monthly AMC',
            recurringInvoiceId: rec.id,
            recurringNumber: rec.recurringNumber,
            renewalPeriod: rp.renewalPeriod || '',
            renewalAmount: Number(rp.renewalAmount || rec.monthlyRenewalAmount || rp.amount || 0),
            amount: Number(rp.amount || 0),
            paymentDate: rp.paymentDate || rp.createdAt?.split('T')[0],
            paymentType: 'Renewal Payment',
            paymentMethod: rp.paymentMethod || 'UPI',
            transactionId: rp.transactionId || rp.referenceId || '',
            referenceId: rp.referenceId || rp.transactionId || '',
            notes: rp.notes || '',
            paymentStatus: rp.paymentStatus || 'paid',
            remainingBalance: 0,
            dealId: '',
            dealTitle: '',
            createdAt: rp.createdAt || new Date().toISOString()
          });
        }
      }
    } catch (e) {
      // Non-blocking
    }

    if (invoiceId) {
      allPayments = allPayments.filter(p => p.invoiceId === invoiceId);
    }
    if (clientId) {
      allPayments = allPayments.filter(p => p.clientId === clientId);
    }
    if (type) {
      allPayments = allPayments.filter(p => p.paymentType === type);
    }

    allPayments.sort((a, b) => new Date(b.paymentDate || b.createdAt || 0).getTime() - new Date(a.paymentDate || a.createdAt || 0).getTime());

    res.json({ success: true, data: allPayments });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record Payment on Invoice
app.post('/api/invoices/:id/payments', async (req, res) => {
  try {
    const rawInvoice = await getDoc('invoices', req.params.id);
    if (!rawInvoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const { invoice } = normalizeInvoicePayments(rawInvoice);

    const parseResult = PaymentRecordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment data',
        errors: parseResult.error.issues
      });
    }

    const paymentAmount = round2(parseResult.data.amount);

    // Resolve client
    const clientId = parseResult.data.clientId || invoice.clientId || invoice.client?.id || '';
    const clientName = parseResult.data.clientName || invoice.client?.name || invoice.clientName || 'Client';

    // Resolve service names from items or package
    const serviceName = parseResult.data.serviceName || (
      (invoice.items && invoice.items.length > 0)
        ? invoice.items.map((i: any) => i.name).filter(Boolean).join(', ')
        : (invoice.servicePackage || 'Invoice Services')
    );

    // Resolve deal relationship from onboardings if available
    let dealId = parseResult.data.dealId || invoice.dealId || '';
    let dealTitle = parseResult.data.dealTitle || invoice.dealTitle || '';
    if (!dealId) {
      try {
        const dealsResult = await listDocs('onboardings', {
          pageSize: 10,
          filterFn: (o: any) => o.invoiceId === invoice.id || (clientId && o.clientId === clientId)
        });
        if (dealsResult.docs.length > 0) {
          const matchedDeal = dealsResult.docs[0];
          dealId = matchedDeal.id;
          dealTitle = matchedDeal.businessName || matchedDeal.servicePackage || matchedDeal.customerName || '';
        }
      } catch (e) {
        // Non-blocking
      }
    }

    // Existing payments list
    let existingPayments: any[] = Array.isArray(invoice.payments) ? [...invoice.payments] : [];

    const currentTotalPaidBefore = round2(existingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const newTotalPaid = round2(currentTotalPaidBefore + paymentAmount);
    const newBalanceDue = round2(Math.max(0, Number(invoice.grandTotal) - newTotalPaid));

    // Determine default paymentType if not explicitly chosen
    let paymentType = parseResult.data.paymentType;
    if (!paymentType) {
      if (newBalanceDue <= 0.01) {
        paymentType = currentTotalPaidBefore > 0 ? 'Balance Payment' : 'Full Payment';
      } else if (currentTotalPaidBefore === 0) {
        paymentType = 'Advance';
      } else {
        paymentType = 'Partial Payment';
      }
    }

    const newPayment = {
      id: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientId,
      clientName,
      serviceName,
      dealId,
      dealTitle,
      amount: paymentAmount,
      paymentDate: parseResult.data.paymentDate || new Date().toISOString().split('T')[0],
      paymentType,
      paymentMethod: parseResult.data.paymentMethod || 'UPI',
      transactionId: parseResult.data.transactionId || '',
      notes: parseResult.data.notes || '',
      remainingBalance: newBalanceDue,
      createdAt: new Date().toISOString()
    };

    const updatedPayments = [...existingPayments, newPayment];
    const totalPaid = round2(updatedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const balanceDue = round2(Math.max(0, Number(invoice.grandTotal) - totalPaid));

    let status = invoice.status;
    if (balanceDue <= 0.01) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partially_paid';
    }

    const updatedInvoice = {
      ...invoice,
      payments: updatedPayments,
      amountPaid: totalPaid,
      balanceDue,
      status,
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', invoice.id, updatedInvoice, true);

    // If dealId exists, also sync to deal's payment history (unless paymentType is 'Renewal Payment')
    if (dealId && paymentType !== 'Renewal Payment') {
      try {
        const deal = await getDoc('onboardings', dealId);
        if (deal) {
          deal.paymentHistory = deal.paymentHistory || [];
          deal.paymentHistory.push({
            id: newPayment.id,
            amount: paymentAmount,
            date: newPayment.paymentDate,
            method: newPayment.paymentMethod,
            type: newPayment.paymentType,
            notes: `Invoice #${invoice.invoiceNumber}: ${newPayment.notes || ''}`.trim()
          });
          const dealPaid = deal.paymentHistory.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
          deal.advancePaid = dealPaid;
          deal.totalReceived = dealPaid;
          deal.remainingBalance = Math.max(0, (deal.totalPackageValue || deal.totalDealValue || 0) - dealPaid);
          deal.paymentStatus = deal.remainingBalance <= 0.01 ? 'paid' : (dealPaid > 0 ? 'partially_paid' : 'unpaid');
          deal.updatedAt = new Date().toISOString();
          await setDoc('onboardings', deal.id, deal, true);
        }
      } catch (e) {
        console.warn('Failed to sync payment to onboarding deal:', e);
      }
    }

    await addAuditLog(
      'Payment Recorded',
      'payment',
      invoice.id,
      invoice.invoiceNumber,
      'UDM Admin',
      `Recorded ₹${paymentAmount} (${paymentType}) via ${newPayment.paymentMethod} for ${clientName} (Bal: ₹${balanceDue})`
    );

    res.json({ success: true, data: updatedInvoice, payment: newPayment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Payment from Invoice
app.delete('/api/invoices/:id/payments/:paymentId', async (req, res) => {
  try {
    const invoice = await getDoc('invoices', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const { paymentId } = req.params;
    const existingPayments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const filteredPayments = existingPayments.filter((p: any) => p.id !== paymentId);

    const totalPaid = round2(filteredPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0));
    const balanceDue = round2(Math.max(0, Number(invoice.grandTotal) - totalPaid));

    let status = invoice.status;
    if (balanceDue <= 0.01 && Number(invoice.grandTotal) > 0) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partially_paid';
    } else {
      status = invoice.status === 'paid' || invoice.status === 'partially_paid' ? 'sent' : invoice.status;
    }

    const updatedInvoice = {
      ...invoice,
      payments: filteredPayments,
      amountPaid: totalPaid,
      balanceDue,
      status,
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', invoice.id, updatedInvoice, true);
    await addAuditLog(
      'Payment Deleted',
      'payment',
      invoice.id,
      invoice.invoiceNumber,
      'UDM Admin',
      `Payment ${paymentId} removed. New Balance: ₹${balanceDue}`
    );

    res.json({ success: true, data: updatedInvoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Duplicate Invoice
app.post('/api/invoices/:id/duplicate', async (req, res) => {
  try {
    const original = await getDoc('invoices', req.params.id);
    if (!original) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const nextNumber = await generateNextInvoiceNumber();
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    const newId = `inv_${Date.now()}`;

    const duplicated = {
      ...original,
      id: newId,
      invoiceNumber: nextNumber,
      invoiceDate: today,
      dueDate,
      status: 'draft',
      payments: [],
      advanceAmount: 0,
      amountPaid: 0,
      balanceDue: original.grandTotal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', newId, duplicated);
    await addAuditLog('Invoice Duplicated', 'invoice', duplicated.id, `${duplicated.invoiceNumber} (from ${original.invoiceNumber})`);

    res.status(201).json({ success: true, data: duplicated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel Invoice
app.post('/api/invoices/:id/cancel', async (req, res) => {
  try {
    const invoice = await getDoc('invoices', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const updated = {
      ...invoice,
      status: 'cancelled',
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', invoice.id, updated, true);
    await addAuditLog('Invoice Cancelled', 'invoice', invoice.id, invoice.invoiceNumber);

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send Email simulation
app.post('/api/invoices/:id/send-email', async (req, res) => {
  try {
    const { to } = req.body;
    const invoice = await getDoc('invoices', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.status === 'draft') {
      invoice.status = 'sent';
      invoice.updatedAt = new Date().toISOString();
      await setDoc('invoices', invoice.id, invoice, true);
    }

    await addAuditLog('Invoice Sent by Email', 'invoice', invoice.id, invoice.invoiceNumber, 'UDM Admin', `Sent to ${to}`);
    res.json({ success: true, message: `Invoice ${invoice.invoiceNumber} successfully queued for delivery to ${to}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// QUOTES / ESTIMATES CRUD
// -------------------------------------------------------------
app.get('/api/quotes', async (req, res) => {
  try {
    const { page, pageSize, search, status } = req.query;
    const result = await listDocs('quotes', {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status: status as string,
      search: search as string,
      searchFields: ['quoteNumber'],
      orderByField: 'quoteDate',
      orderDirection: 'desc'
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/quotes', async (req, res) => {
  try {
    const parseResult = QuoteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quote data',
        errors: parseResult.error.issues
      });
    }

    const quoteData = req.body;
    const count = await countDocs('quotes');
    const newId = `quote_${Date.now()}`;
    const quoteNumber = quoteData.quoteNumber || `Q000${count + 101}`;

    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const placeOfSupplyCode = quoteData.placeOfSupplyCode || quoteData.client?.stateCode || '23';
    const isInterState = sellerStateCode !== placeOfSupplyCode;

    const totals = calculateInvoiceTotals(quoteData.items, {
      isInterState,
      discountType: quoteData.discountType,
      discountValue: quoteData.discountValue,
      additionalCharges: quoteData.additionalCharges
    }, quoteData.status || 'draft');

    // Ensure client is saved to clients collection
    if (quoteData.client && quoteData.client.name) {
      try {
        const cId = quoteData.client.id || quoteData.clientId || `client_${Date.now()}`;
        quoteData.clientId = cId;
        const existing = await getDoc('clients', cId);
        if (!existing) {
          const clientDoc = {
            id: cId,
            clientNumber: quoteData.client.clientNumber || `CLI-${Date.now().toString().slice(-4)}`,
            name: quoteData.client.name,
            contactPerson: quoteData.client.contactPerson || quoteData.client.name,
            email: quoteData.client.email || '',
            phone: quoteData.client.phone || '',
            billingAddress: quoteData.client.billingAddress || 'Not Provided',
            shippingAddress: quoteData.client.shippingAddress || '',
            city: quoteData.client.city || '',
            state: quoteData.client.state || quoteData.placeOfSupply || 'Madhya Pradesh',
            stateCode: quoteData.client.stateCode || quoteData.placeOfSupplyCode || '23',
            country: 'India',
            pinCode: quoteData.client.pinCode || '',
            gstin: quoteData.client.gstin || '',
            pan: quoteData.client.pan || '',
            customerType: quoteData.client.customerType || 'B2B',
            createdAt: new Date().toISOString()
          };
          await setDoc('clients', cId, clientDoc);
          quoteData.client = clientDoc;
        }
      } catch (e) {
        // Non-blocking
      }
    }

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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('quotes', newId, newQuote);
    await addAuditLog('Quote Created', 'quote', newQuote.id, newQuote.quoteNumber);

    res.status(201).json({ success: true, data: newQuote });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/quotes/:id', async (req, res) => {
  try {
    const existing = await getDoc('quotes', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Quote not found' });
    }

    const updatedData = { ...existing, ...req.body };
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const placeOfSupplyCode = updatedData.placeOfSupplyCode || updatedData.client?.stateCode || '23';
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
      updatedAt: new Date().toISOString()
    };

    await setDoc('quotes', req.params.id, updatedQuote, true);
    await addAuditLog('Quote Updated', 'quote', updatedQuote.id, updatedQuote.quoteNumber);

    res.json({ success: true, data: updatedQuote });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/quotes/:id', async (req, res) => {
  try {
    const existing = await getDoc('quotes', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Quote not found' });
    }

    await deleteDoc('quotes', req.params.id);
    await addAuditLog('Quote Deleted', 'quote', req.params.id, existing.quoteNumber);

    res.json({ success: true, message: 'Quote deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Convert Quote to Invoice
app.post('/api/quotes/:id/convert-to-invoice', async (req, res) => {
  try {
    const quote = await getDoc('quotes', req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, message: 'Quote not found' });
    }

    if (quote.status === 'converted' && quote.convertedToInvoiceId) {
      const existingInv = await getDoc('invoices', quote.convertedToInvoiceId);
      if (existingInv) {
        return res.json({ success: true, invoice: existingInv, alreadyConverted: true });
      }
    }

    let client = quote.client;
    if (!client && quote.clientId) {
      client = await getDoc('clients', quote.clientId);
    }
    if (!client) {
      const fallbackName = quote.clientName || quote.customerName || (quote as any).companyName || 'Customer';
      client = {
        id: quote.clientId || `client_auto_${Date.now()}`,
        name: fallbackName,
        contactPerson: quote.clientName || fallbackName,
        email: quote.clientEmail || quote.email || '',
        phone: quote.clientPhone || quote.phone || '',
        billingAddress: quote.clientAddress || quote.address || 'Not Provided',
        city: quote.clientCity || quote.city || '',
        state: quote.placeOfSupply || 'Madhya Pradesh',
        stateCode: quote.placeOfSupplyCode || '23',
        country: 'India',
        pinCode: '',
        gstin: quote.clientGstin || quote.gstin || '',
        pan: '',
        customerType: 'B2B',
        createdAt: new Date().toISOString()
      };
    }

    // Ensure converted client is saved to clients collection
    if (client && client.name) {
      try {
        const cId = client.id || `client_${Date.now()}`;
        client.id = cId;
        const existing = await getDoc('clients', cId);
        if (!existing) {
          const clientDoc = {
            id: cId,
            clientNumber: client.clientNumber || `CLI-${Date.now().toString().slice(-4)}`,
            name: client.name,
            contactPerson: client.contactPerson || client.name,
            email: client.email || '',
            phone: client.phone || '',
            billingAddress: client.billingAddress || 'Not Provided',
            shippingAddress: client.shippingAddress || '',
            city: client.city || '',
            state: client.state || quote.placeOfSupply || 'Madhya Pradesh',
            stateCode: client.stateCode || quote.placeOfSupplyCode || '23',
            country: client.country || 'India',
            pinCode: client.pinCode || '',
            gstin: client.gstin || '',
            pan: client.pan || '',
            customerType: client.customerType || 'B2B',
            createdAt: new Date().toISOString()
          };
          await setDoc('clients', cId, clientDoc);
          client = clientDoc;
        }
      } catch (e) {
        // Non-blocking
      }
    }

    const nextNumber = await generateNextInvoiceNumber();
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const invoiceSettings = (await getDoc('settings', 'invoiceSettings')) || {};

    const isInterState = quote.isInterState ?? ((client?.stateCode || '23') !== (businessProfile.stateCode || '23'));
    const rawItems = (quote.items || []).map((item: any, idx: number) => ({
      id: item.id || `item_${idx}_${Date.now()}`,
      name: item.name || 'Service',
      description: item.description || '',
      hsnSac: item.hsnSac || '998314',
      quantity: Number(item.quantity) || 1,
      unit: item.unit || 'NOS',
      rate: Number(item.rate) || 0,
      discountType: item.discountType || 'percentage',
      discountValue: Number(item.discountValue) || 0,
      discountAmount: Number(item.discountAmount) || 0,
      taxableAmount: Number(item.taxableAmount) || Math.max(0, (Number(item.rate) || 0) * (Number(item.quantity) || 1) - (Number(item.discountAmount) || 0)),
      gstRate: Number(item.gstRate) || 0
    }));

    const calculatedTotals = calculateInvoiceTotals(rawItems, {
      isInterState,
      isReverseCharge: quote.isReverseCharge,
      discountType: quote.discountType || 'percentage',
      discountValue: Number(quote.discountValue) || 0,
      additionalCharges: quote.additionalCharges || [],
      advanceAmount: 0,
      paymentsTotal: 0
    }, 'draft');

    const newInvoice: any = {
      id: `inv_${Date.now()}`,
      invoiceNumber: nextNumber,
      poNumber: `CONV-${quote.quoteNumber}`,
      invoiceDate: today,
      dueDate,
      billingStartDate: today,
      billingEndDate: dueDate,
      billingPeriod: `${today} to ${dueDate}`,
      placeOfSupply: quote.placeOfSupply || client?.state || 'Madhya Pradesh',
      placeOfSupplyCode: quote.placeOfSupplyCode || client?.stateCode || '23',
      currency: quote.currency || 'INR',
      financialYear: 'FY 2026-27',
      isInterState,
      status: 'draft',
      template: quote.template || 'classic',
      seller: businessProfile,
      clientId: client.id || quote.clientId,
      client: client,
      items: calculatedTotals.items,
      discountType: quote.discountType || 'percentage',
      discountValue: quote.discountValue || 0,
      discountAmount: calculatedTotals.globalDiscountAmount,
      additionalCharges: quote.additionalCharges || [],
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
      amountPaid: 0,
      balanceDue: calculatedTotals.grandTotal,
      payments: [],
      showBankDetails: true,
      showUpiQr: true,
      terms: quote.terms || invoiceSettings.defaultPaymentTerms || 'Payment due in 15 days.',
      customerNotes: quote.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', newInvoice.id, newInvoice);

    // Update Quote status
    quote.status = 'converted';
    quote.convertedToInvoiceId = newInvoice.id;
    quote.convertedToInvoiceNumber = newInvoice.invoiceNumber;
    quote.updatedAt = new Date().toISOString();
    await setDoc('quotes', quote.id, quote, true);

    await addAuditLog('Quote Converted to Invoice', 'invoice', newInvoice.id, `${newInvoice.invoiceNumber} (from ${quote.quoteNumber})`);

    res.json({ success: true, invoice: newInvoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CREDIT NOTES CRUD
// -------------------------------------------------------------
app.get('/api/credit-notes', async (req, res) => {
  try {
    const result = await listDocs('creditNotes', { pageSize: 500, orderByField: 'createdAt', orderDirection: 'desc' });
    res.json({ success: true, data: result.docs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/credit-notes', async (req, res) => {
  try {
    const body = { ...req.body };
    const cnDate = body.creditNoteDate || body.date || new Date().toISOString().split('T')[0];
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const totAmt = Number(body.totalAmount ?? (Number(body.taxableAmount || 0) + gstAmt));
    const taxAble = Number(body.taxableAmount ?? (totAmt - gstAmt));

    const normalizedBody = {
      ...body,
      creditNoteDate: cnDate,
      date: cnDate,
      totalAmount: totAmt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      taxableAmount: taxAble,
      status: body.status || 'active'
    };

    const parseResult = CreditNoteSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credit note data',
        errors: parseResult.error.issues
      });
    }

    const count = await countDocs('creditNotes');
    const newId = `cn_${Date.now()}`;
    const newCreditNote = {
      id: newId,
      creditNoteNumber: body.creditNoteNumber || `CN-2026-${String(count + 1).padStart(3, '0')}`,
      creditNoteDate: cnDate,
      date: cnDate,
      createdAt: new Date().toISOString(),
      ...parseResult.data
    };

    await setDoc('creditNotes', newId, newCreditNote);

    // Adjust linked invoice credited amount and balance due
    if (newCreditNote.invoiceId) {
      const inv = await getDoc('invoices', newCreditNote.invoiceId);
      if (inv) {
        const creditAmt = Number(newCreditNote.totalAmount) || 0;
        const currentCredited = Number(inv.creditedAmount) || 0;
        inv.creditedAmount = round2(currentCredited + creditAmt);
        const grandTotal = Number(inv.grandTotal) || 0;
        const amountPaid = Number(inv.amountPaid) || 0;
        inv.balanceDue = Math.max(0, round2(grandTotal - amountPaid - inv.creditedAmount));
        if (inv.balanceDue === 0 && grandTotal > 0) {
          inv.status = 'paid';
        }
        inv.updatedAt = new Date().toISOString();
        await setDoc('invoices', inv.id, inv, true);
      }
    }

    await addAuditLog('Credit Note Issued', 'credit_note', newCreditNote.id, `${newCreditNote.creditNoteNumber} against ${newCreditNote.invoiceNumber || 'Invoice'}`);

    res.status(201).json({ success: true, data: newCreditNote });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/credit-notes/:id', async (req, res) => {
  try {
    const existing = await getDoc('creditNotes', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    const oldTotal = Number(existing.totalAmount) || 0;
    const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
    const newTotal = Number(updated.totalAmount) || 0;

    await setDoc('creditNotes', req.params.id, updated, true);

    // Recalculate invoice balance
    if (updated.invoiceId) {
      const inv = await getDoc('invoices', updated.invoiceId);
      if (inv) {
        const diff = newTotal - oldTotal;
        inv.creditedAmount = Math.max(0, round2((Number(inv.creditedAmount) || 0) + diff));
        inv.balanceDue = Math.max(0, round2((Number(inv.grandTotal) || 0) - (Number(inv.amountPaid) || 0) - inv.creditedAmount));
        inv.updatedAt = new Date().toISOString();
        await setDoc('invoices', inv.id, inv, true);
      }
    }

    await addAuditLog('Credit Note Updated', 'credit_note', updated.id, updated.creditNoteNumber);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/credit-notes/:id', async (req, res) => {
  try {
    const existing = await getDoc('creditNotes', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    // Reverse credited amount on linked invoice
    if (existing.invoiceId) {
      const inv = await getDoc('invoices', existing.invoiceId);
      if (inv) {
        const creditAmt = Number(existing.totalAmount) || 0;
        inv.creditedAmount = Math.max(0, round2((Number(inv.creditedAmount) || 0) - creditAmt));
        inv.balanceDue = Math.max(0, round2((Number(inv.grandTotal) || 0) - (Number(inv.amountPaid) || 0) - inv.creditedAmount));
        inv.updatedAt = new Date().toISOString();
        await setDoc('invoices', inv.id, inv, true);
      }
    }

    await deleteDoc('creditNotes', req.params.id);
    await addAuditLog('Credit Note Deleted', 'credit_note', req.params.id, existing.creditNoteNumber);

    res.json({ success: true, message: 'Credit note deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// RECURRING INVOICES & AMC LOGIC
// -------------------------------------------------------------

function padRec2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateRecISO(d: Date): string {
  return `${d.getFullYear()}-${padRec2(d.getMonth() + 1)}-${padRec2(d.getDate())}`;
}

const REC_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const REC_MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function calculateMonthlyPeriodDates(startDateStr: string): {
  periodStartDate: string;
  currentExpiryDate: string;
  nextRenewalDate: string;
  periodName: string;
} {
  const parts = (startDateStr || formatDateRecISO(new Date())).split('T')[0].split('-').map(Number);
  const startYear = parts[0];
  const startMonth = parts[1] - 1;
  const startDay = parts[2];

  let expiryDate: Date;
  let nextRenewalDate: Date;
  let periodName: string;

  if (startDay === 1) {
    expiryDate = new Date(startYear, startMonth + 1, 0);
    nextRenewalDate = new Date(startYear, startMonth + 1, 1);
    periodName = `${REC_MONTH_NAMES[startMonth]} ${startYear}`;
  } else {
    expiryDate = new Date(startYear, startMonth + 1, startDay - 1);
    nextRenewalDate = new Date(startYear, startMonth + 1, startDay);
    periodName = `${padRec2(startDay)} ${REC_MONTH_SHORT[startMonth]} - ${padRec2(expiryDate.getDate())} ${REC_MONTH_SHORT[expiryDate.getMonth()]} ${expiryDate.getFullYear()}`;
  }

  return {
    periodStartDate: formatDateRecISO(new Date(startYear, startMonth, startDay)),
    currentExpiryDate: formatDateRecISO(expiryDate),
    nextRenewalDate: formatDateRecISO(nextRenewalDate),
    periodName
  };
}

export function determineRenewalStatusBackend(
  currentExpiryDateStr?: string,
  paymentStatus?: string,
  todayStr?: string
): 'active' | 'due_soon' | 'expired' | 'renewed' | 'payment_pending' {
  if (!currentExpiryDateStr) return 'active';

  const today = todayStr || formatDateRecISO(new Date());
  const expiryParts = currentExpiryDateStr.split('T')[0].split('-').map(Number);
  const todayParts = today.split('T')[0].split('-').map(Number);

  const expiry = new Date(expiryParts[0], expiryParts[1] - 1, expiryParts[2]);
  const current = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);

  const diffTime = expiry.getTime() - current.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'expired';
  }
  if (paymentStatus === 'pending' || paymentStatus === 'partially_paid') {
    return 'payment_pending';
  }
  if (diffDays <= 7) {
    return 'due_soon';
  }
  return 'active';
}

export function normalizeRecurringInvoice(rec: any): { rec: any; hasChanged: boolean } {
  if (!rec) return { rec, hasChanged: false };
  let hasChanged = false;

  if (!rec.serviceName) {
    rec.serviceName = rec.title || 'Monthly AMC';
    hasChanged = true;
  }

  if (rec.monthlyRenewalAmount === undefined) {
    rec.monthlyRenewalAmount = Number(
      rec.invoiceTemplateData?.grandTotal ||
      (Array.isArray(rec.items) && rec.items.length > 0 ? rec.items[0].rate : 0) ||
      3000
    );
    hasChanged = true;
  }

  const startDate = rec.startDate || formatDateRecISO(new Date());
  if (!rec.startDate) {
    rec.startDate = startDate;
    hasChanged = true;
  }

  const calculatedDates = calculateMonthlyPeriodDates(startDate);

  if (!rec.currentExpiryDate) {
    rec.currentExpiryDate = calculatedDates.currentExpiryDate;
    hasChanged = true;
  }

  if (!rec.nextRenewalDate) {
    rec.nextRenewalDate = calculatedDates.nextRenewalDate;
    hasChanged = true;
  }

  if (!rec.paymentStatus) {
    rec.paymentStatus = 'paid';
    hasChanged = true;
  }

  if (rec.lastPaymentAmount === undefined) {
    rec.lastPaymentAmount = rec.monthlyRenewalAmount;
    hasChanged = true;
  }

  if (!rec.lastPaymentDate) {
    rec.lastPaymentDate = rec.startDate;
    hasChanged = true;
  }

  // Renewal history initialization if empty
  if (!Array.isArray(rec.renewalHistory) || rec.renewalHistory.length === 0) {
    rec.renewalHistory = [
      {
        id: `ren_init_${rec.id}`,
        recurringInvoiceId: rec.id,
        periodName: calculatedDates.periodName,
        periodStartDate: calculatedDates.periodStartDate,
        periodEndDate: rec.currentExpiryDate || calculatedDates.currentExpiryDate,
        renewalAmount: rec.monthlyRenewalAmount,
        paidAmount: rec.paymentStatus === 'paid' ? rec.monthlyRenewalAmount : (rec.lastPaymentAmount || 0),
        paymentStatus: rec.paymentStatus || 'paid',
        paymentDate: rec.lastPaymentDate || rec.startDate,
        paymentMethod: 'UPI',
        referenceId: 'INITIAL-SETUP',
        notes: 'Initial recurring subscription period',
        createdAt: rec.createdAt || new Date().toISOString()
      }
    ];
    hasChanged = true;
  }

  // Renewal payments initialization if empty
  if (!Array.isArray(rec.renewalPayments)) {
    rec.renewalPayments = [];
    if (rec.paymentStatus === 'paid') {
      rec.renewalPayments.push({
        id: `pay_ren_${rec.id}_init`,
        clientId: rec.clientId,
        clientName: rec.clientName || rec.client?.name || 'Client',
        serviceName: rec.serviceName,
        recurringInvoiceId: rec.id,
        recurringNumber: rec.recurringNumber,
        renewalPeriod: calculatedDates.periodName,
        renewalAmount: rec.monthlyRenewalAmount,
        amount: rec.monthlyRenewalAmount,
        paymentDate: rec.lastPaymentDate || rec.startDate,
        paymentType: 'Renewal Payment',
        paymentMethod: 'UPI',
        transactionId: 'INITIAL-SETUP',
        referenceId: 'INITIAL-SETUP',
        notes: 'Initial monthly subscription payment',
        paymentStatus: 'paid',
        createdAt: rec.createdAt || new Date().toISOString()
      });
    }
    hasChanged = true;
  }

  // Clean any undefined properties from existing renewalHistory
  if (Array.isArray(rec.renewalHistory)) {
    rec.renewalHistory = rec.renewalHistory.map((item: any) => {
      const clean: any = {};
      for (const [k, v] of Object.entries(item || {})) {
        if (v !== undefined) {
          clean[k] = v;
        }
      }
      return clean;
    });
  }

  // Clean any undefined properties from existing renewalPayments
  if (Array.isArray(rec.renewalPayments)) {
    rec.renewalPayments = rec.renewalPayments.map((item: any) => {
      const clean: any = {};
      for (const [k, v] of Object.entries(item || {})) {
        if (v !== undefined) {
          clean[k] = v;
        }
      }
      return clean;
    });
  }

  // Determine renewal status automatically
  const computedStatus = determineRenewalStatusBackend(rec.currentExpiryDate, rec.paymentStatus);
  if (rec.renewalStatus !== computedStatus) {
    rec.renewalStatus = computedStatus;
    hasChanged = true;
  }

  return { rec, hasChanged };
}

app.get('/api/recurring-invoices', async (req, res) => {
  try {
    const result = await listDocs('recurringInvoices', { pageSize: 500, orderByField: 'createdAt', orderDirection: 'desc' });
    const normalizedDocs: any[] = [];
    for (const raw of result.docs) {
      const { rec, hasChanged } = normalizeRecurringInvoice(raw);
      if (hasChanged) {
        setDoc('recurringInvoices', rec.id, rec, true).catch(() => {});
      }
      normalizedDocs.push(rec);
    }
    res.json({ success: true, data: normalizedDocs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/recurring-invoices', async (req, res) => {
  try {
    const body = { ...req.body };

    // 1. Frequency normalization
    if (typeof body.frequency === 'string') {
      body.frequency = body.frequency.toLowerCase().trim();
    } else {
      body.frequency = 'monthly';
    }

    const serviceName = (body.serviceName || body.title || 'Monthly AMC').trim();
    const monthlyRenewalAmount = Number(body.monthlyRenewalAmount || body.rate || body.cycleRate || body.amount || 3000);
    const startDate = (body.startDate && typeof body.startDate === 'string' && body.startDate.trim())
      ? body.startDate.trim()
      : formatDateRecISO(new Date());

    const periodDates = calculateMonthlyPeriodDates(startDate);
    const currentExpiryDate = body.currentExpiryDate || periodDates.currentExpiryDate;
    const nextRenewalDate = body.nextRenewalDate || periodDates.nextRenewalDate;

    // Line items normalization & fallback
    if (!Array.isArray(body.items) || body.items.length === 0) {
      body.items = [
        {
          id: `rec_item_${Date.now()}`,
          name: serviceName,
          description: body.description || 'Monthly recurring AMC & retainer service',
          hsnSac: body.hsnSac || '998313',
          quantity: 1,
          unit: 'MONTH',
          rate: monthlyRenewalAmount,
          gstRate: body.gstRate !== undefined ? Number(body.gstRate) : 0,
          discountType: 'percentage',
          discountValue: 0,
          discountAmount: 0
        }
      ];
    } else {
      body.items = body.items.map((item: any, idx: number) => ({
        id: item.id || `item_${Date.now()}_${idx}`,
        name: String(item.name || serviceName).trim(),
        description: String(item.description || '').trim(),
        hsnSac: String(item.hsnSac || '998313').trim(),
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        unit: String(item.unit || 'MONTH').trim(),
        rate: Number(item.rate) >= 0 ? Number(item.rate) : monthlyRenewalAmount,
        discountType: item.discountType === 'fixed' ? 'fixed' : 'percentage',
        discountValue: Number(item.discountValue) || 0,
        discountAmount: Number(item.discountAmount) || 0,
        gstRate: Number(item.gstRate !== undefined ? item.gstRate : 0)
      }));
    }

    const client = (await getDoc('clients', body.clientId)) || body.client || {};
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const clientStateCode = client.stateCode || '23';
    const isInterState = sellerStateCode !== clientStateCode;

    // Calculate canonical GST totals for the recurring profile
    const totals = calculateInvoiceTotals(body.items as any, { isInterState }, 'draft');

    const count = await countDocs('recurringInvoices');
    const newId = `rec_${Date.now()}`;
    const newRecNumber = body.recurringNumber || `REC-00${count + 1}`;

    const isPaidInitial = body.isInitialPaymentPaid !== false;
    const initialPaymentAmount = isPaidInitial ? Number(body.initialPaymentAmount || monthlyRenewalAmount) : 0;
    const initialPaymentDate = body.initialPaymentDate || startDate;
    const initialPaymentMethod = body.initialPaymentMethod || 'UPI';
    const initialPaymentReference = body.initialPaymentReference || `AMC-${Date.now().toString(36).toUpperCase()}`;
    const paymentStatus = isPaidInitial ? 'paid' : 'pending';
    const renewalStatus = determineRenewalStatusBackend(currentExpiryDate, paymentStatus);

    const initialHistory = [
      {
        id: `ren_init_${newId}`,
        recurringInvoiceId: newId,
        periodName: periodDates.periodName,
        periodStartDate: periodDates.periodStartDate,
        periodEndDate: currentExpiryDate,
        renewalAmount: monthlyRenewalAmount,
        paidAmount: initialPaymentAmount,
        paymentStatus,
        paymentDate: initialPaymentDate,
        paymentMethod: initialPaymentMethod,
        referenceId: initialPaymentReference,
        notes: body.initialPaymentNotes || 'Initial subscription activation',
        createdAt: new Date().toISOString()
      }
    ];

    const initialRenewalPayments = [];
    if (isPaidInitial && initialPaymentAmount > 0) {
      initialRenewalPayments.push({
        id: `pay_ren_${Date.now()}_init`,
        clientId: client.id || body.clientId,
        clientName: client.name || body.clientName || 'Client',
        serviceName,
        recurringInvoiceId: newId,
        recurringNumber: newRecNumber,
        renewalPeriod: periodDates.periodName,
        renewalAmount: monthlyRenewalAmount,
        amount: initialPaymentAmount,
        paymentDate: initialPaymentDate,
        paymentType: 'Renewal Payment',
        paymentMethod: initialPaymentMethod,
        transactionId: initialPaymentReference,
        referenceId: initialPaymentReference,
        notes: body.initialPaymentNotes || 'Initial subscription activation payment',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString()
      });
    }

    const newRec = {
      id: newId,
      recurringNumber: newRecNumber,
      title: body.title || serviceName,
      serviceName,
      monthlyRenewalAmount,
      clientId: client.id || body.clientId,
      clientName: client.name || body.clientName || 'Client',
      client: client.name ? client : undefined,
      frequency: body.frequency,
      startDate,
      currentExpiryDate,
      nextRenewalDate,
      lastPaymentDate: isPaidInitial ? initialPaymentDate : undefined,
      lastPaymentAmount: isPaidInitial ? initialPaymentAmount : 0,
      paymentStatus,
      renewalStatus,
      renewalHistory: initialHistory,
      renewalPayments: initialRenewalPayments,
      nextInvoiceDate: nextRenewalDate,
      status: body.status || 'active',
      items: body.items,
      terms: body.terms || 'Standard AMC & Retainer SLA agreement applies.',
      autoSendEmail: Boolean(body.autoSendEmail),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      invoiceTemplateData: {
        ...(body.invoiceTemplateData || {}),
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

    await setDoc('recurringInvoices', newId, newRec);
    await addAuditLog('Recurring Schedule Created', 'invoice', newRec.id, newRec.recurringNumber);

    res.status(201).json({ success: true, data: newRec });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record Renewal Payment
app.post('/api/recurring-invoices/:id/renew', async (req, res) => {
  try {
    const rawRec = await getDoc('recurringInvoices', req.params.id);
    if (!rawRec) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }
    const { rec } = normalizeRecurringInvoice(rawRec);

    const {
      renewalPeriod,
      periodStartDate,
      periodEndDate,
      renewalAmount,
      paymentAmount,
      paymentDate,
      paymentMethod,
      referenceId,
      notes,
      paymentStatus,
      recordPayment,
      nextRenewalDate: explicitNextRenewalDate
    } = req.body;

    const renAmount = Number(renewalAmount !== undefined ? renewalAmount : (rec.monthlyRenewalAmount || 3000));
    const payAmount = Number(paymentAmount !== undefined ? paymentAmount : renAmount);
    const pDate = paymentDate || formatDateRecISO(new Date());
    const pMethod = paymentMethod || 'UPI';
    const refId = referenceId ? String(referenceId).trim() : `REN-${Date.now().toString(36).toUpperCase()}`;

    // Should we record a payment transaction?
    // If recordPayment is explicitly false, or paymentStatus is pending, or payAmount is 0, do not create a payment record
    const shouldRecordPayment = recordPayment !== false && paymentStatus !== 'pending' && payAmount > 0;
    const pStatus = paymentStatus || (shouldRecordPayment ? (payAmount >= renAmount ? 'paid' : 'partially_paid') : 'pending');

    // Calculate dates for next cycle if not explicitly passed
    let pStart = periodStartDate;
    let pEnd = periodEndDate;
    if (!pStart || !pEnd) {
      const nextStartBase = rec.nextRenewalDate || rec.currentExpiryDate;
      const nextDates = calculateMonthlyPeriodDates(nextStartBase);
      pStart = pStart || nextDates.periodStartDate;
      pEnd = pEnd || nextDates.currentExpiryDate;
    }

    // Next renewal date following this period (the day after pEnd)
    let nextRenewalDate = explicitNextRenewalDate;
    if (!nextRenewalDate) {
      const nextParts = pEnd.split('T')[0].split('-').map(Number);
      const nextFollowDate = new Date(nextParts[0], nextParts[1] - 1, nextParts[2]);
      nextFollowDate.setDate(nextFollowDate.getDate() + 1);
      nextRenewalDate = formatDateRecISO(nextFollowDate);
    }

    const periodLabel = renewalPeriod || calculateMonthlyPeriodDates(pStart).periodName;

    // 1. Create separate Renewal Payment record if payment was made
    let renewalPayment: any = null;
    rec.renewalPayments = Array.isArray(rec.renewalPayments) ? rec.renewalPayments : [];

    if (shouldRecordPayment) {
      // Prevent duplicate payment if identical referenceId already exists
      const isDuplicateRef = refId && rec.renewalPayments.some(
        (p: any) => p.referenceId === refId && p.amount === payAmount && p.renewalPeriod === periodLabel
      );

      if (!isDuplicateRef) {
        renewalPayment = {
          id: `pay_ren_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          clientId: rec.clientId,
          clientName: rec.clientName || rec.client?.name || 'Client',
          serviceName: rec.serviceName || rec.title || 'Monthly AMC',
          recurringInvoiceId: rec.id,
          recurringNumber: rec.recurringNumber,
          renewalPeriod: periodLabel,
          renewalAmount: renAmount,
          amount: payAmount,
          paymentDate: pDate,
          paymentType: 'Renewal Payment',
          paymentMethod: pMethod,
          transactionId: refId,
          referenceId: refId,
          notes: notes || '',
          paymentStatus: pStatus,
          createdAt: new Date().toISOString()
        };
        rec.renewalPayments.push(renewalPayment);
      }
    }

    // 2. Add or update renewalHistory (Never overwrite previous historical cycles)
    rec.renewalHistory = Array.isArray(rec.renewalHistory) ? rec.renewalHistory : [];
    const existingIndex = rec.renewalHistory.findIndex((h: any) => h.periodName === periodLabel);

    if (existingIndex >= 0) {
      const existingItem = rec.renewalHistory[existingIndex];
      const updatedHistoryItem: any = {
        ...existingItem,
        periodStartDate: pStart,
        periodEndDate: pEnd,
        renewalAmount: renAmount,
        paidAmount: shouldRecordPayment ? payAmount : (existingItem.paidAmount || 0),
        paymentStatus: pStatus,
        notes: notes || existingItem.notes || '',
        updatedAt: new Date().toISOString()
      };
      if (shouldRecordPayment) {
        updatedHistoryItem.paymentDate = pDate;
        updatedHistoryItem.paymentMethod = pMethod;
        updatedHistoryItem.referenceId = refId;
      } else if (existingItem.paymentDate) {
        updatedHistoryItem.paymentDate = existingItem.paymentDate;
        if (existingItem.paymentMethod) updatedHistoryItem.paymentMethod = existingItem.paymentMethod;
        if (existingItem.referenceId) updatedHistoryItem.referenceId = existingItem.referenceId;
      }
      rec.renewalHistory[existingIndex] = updatedHistoryItem;
    } else {
      const newHistoryItem: any = {
        id: `ren_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        recurringInvoiceId: rec.id,
        periodName: periodLabel,
        periodStartDate: pStart,
        periodEndDate: pEnd,
        renewalAmount: renAmount,
        paidAmount: shouldRecordPayment ? payAmount : 0,
        paymentStatus: pStatus,
        notes: notes || '',
        createdAt: new Date().toISOString()
      };
      if (shouldRecordPayment) {
        newHistoryItem.paymentDate = pDate;
        newHistoryItem.paymentMethod = pMethod;
        newHistoryItem.referenceId = refId;
      }
      rec.renewalHistory.push(newHistoryItem);
    }

    // 3. Update the recurring client's expiry and next renewal dates
    rec.currentExpiryDate = pEnd;
    rec.nextRenewalDate = nextRenewalDate;
    if (shouldRecordPayment) {
      rec.lastPaymentDate = pDate;
      rec.lastPaymentAmount = payAmount;
    }
    rec.paymentStatus = pStatus;
    rec.renewalStatus = determineRenewalStatusBackend(rec.currentExpiryDate, pStatus);
    rec.nextInvoiceDate = nextRenewalDate;
    rec.updatedAt = new Date().toISOString();

    await setDoc('recurringInvoices', rec.id, rec, true);

    await addAuditLog(
      shouldRecordPayment ? 'Renewal Payment Recorded' : 'Renewal Expiry Updated',
      'payment',
      rec.id,
      `${rec.clientName} - ${periodLabel} ${shouldRecordPayment ? `(₹${payAmount})` : '(Expiry Extended)'}`,
      'UDM Admin',
      JSON.stringify({
        clientId: rec.clientId,
        serviceName: rec.serviceName,
        renewalPeriod: periodLabel,
        amount: shouldRecordPayment ? payAmount : 0,
        paymentType: 'Renewal Payment',
        newExpiryDate: pEnd,
        paymentStatus: pStatus
      })
    );

    res.json({
      success: true,
      data: rec,
      payment: renewalPayment,
      message: shouldRecordPayment
        ? `Renewal payment of ₹${payAmount} recorded successfully for ${periodLabel}`
        : `Renewal expiry updated to ${pEnd} for ${periodLabel}`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add a renewal period to history (e.g. pending renewal period)
app.post('/api/recurring-invoices/:id/periods', async (req, res) => {
  try {
    const rawRec = await getDoc('recurringInvoices', req.params.id);
    if (!rawRec) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }
    const { rec } = normalizeRecurringInvoice(rawRec);

    const { periodName, periodStartDate, periodEndDate, renewalAmount, notes } = req.body;
    rec.renewalHistory = Array.isArray(rec.renewalHistory) ? rec.renewalHistory : [];

    const newPeriod = {
      id: `ren_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      recurringInvoiceId: rec.id,
      periodName: periodName,
      periodStartDate: periodStartDate,
      periodEndDate: periodEndDate,
      renewalAmount: Number(renewalAmount || rec.monthlyRenewalAmount || 3000),
      paidAmount: 0,
      paymentStatus: 'pending',
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    rec.renewalHistory.push(newPeriod);
    rec.updatedAt = new Date().toISOString();
    await setDoc('recurringInvoices', rec.id, rec, true);

    res.json({ success: true, data: rec, newPeriod });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Renewal History and Payments for a recurring schedule
app.get('/api/recurring-invoices/:id/renewals', async (req, res) => {
  try {
    const rawRec = await getDoc('recurringInvoices', req.params.id);
    if (!rawRec) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }
    const { rec, hasChanged } = normalizeRecurringInvoice(rawRec);
    if (hasChanged) {
      await setDoc('recurringInvoices', rec.id, rec, true);
    }
    res.json({
      success: true,
      renewalHistory: rec.renewalHistory || [],
      renewalPayments: rec.renewalPayments || [],
      recurring: rec
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/recurring-invoices/:id', async (req, res) => {
  try {
    const existing = await getDoc('recurringInvoices', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }

    const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
    await setDoc('recurringInvoices', req.params.id, updated, true);

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/recurring-invoices/:id', async (req, res) => {
  try {
    const existing = await getDoc('recurringInvoices', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }

    await deleteDoc('recurringInvoices', req.params.id);
    res.json({ success: true, message: 'Recurring schedule deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/recurring-invoices/:id/trigger', async (req, res) => {
  try {
    const rec = await getDoc('recurringInvoices', req.params.id);
    if (!rec) {
      return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
    }

    const client = (await getDoc('clients', rec.clientId)) || {
      id: rec.clientId,
      name: rec.clientName || 'Client',
      state: 'Madhya Pradesh',
      stateCode: '23'
    };

    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const isInterState = sellerStateCode !== (client.stateCode || '23');

    const nextNumber = await generateNextInvoiceNumber();
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];

    // Canonical calculations
    const totals = calculateInvoiceTotals(rec.items || [], { isInterState }, 'draft');

    const newInvoice: any = {
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
      currency: 'INR',
      financialYear: 'FY 2026-27',
      isInterState,
      status: 'draft',
      template: 'classic',
      seller: businessProfile,
      clientId: client.id,
      client,
      items: totals.items,
      discountType: 'percentage',
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
      terms: rec.terms || 'Automated recurring billing invoice.',
      customerNotes: 'Automated recurring billing invoice.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', newInvoice.id, newInvoice);

    // Advance nextInvoiceDate based on frequency
    const currentNext = new Date(rec.nextInvoiceDate || today);
    if (rec.frequency === 'weekly') {
      currentNext.setDate(currentNext.getDate() + 7);
    } else if (rec.frequency === 'quarterly') {
      currentNext.setMonth(currentNext.getMonth() + 3);
    } else if (rec.frequency === 'half_yearly') {
      currentNext.setMonth(currentNext.getMonth() + 6);
    } else if (rec.frequency === 'yearly') {
      currentNext.setFullYear(currentNext.getFullYear() + 1);
    } else {
      currentNext.setMonth(currentNext.getMonth() + 1); // default monthly
    }

    rec.nextInvoiceDate = currentNext.toISOString().split('T')[0];
    rec.lastGeneratedInvoiceId = newInvoice.id;
    rec.updatedAt = new Date().toISOString();
    await setDoc('recurringInvoices', rec.id, rec, true);

    await addAuditLog('Recurring Invoice Draft Generated', 'invoice', newInvoice.id, newInvoice.invoiceNumber);

    res.json({ success: true, invoice: newInvoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// EXPENSES CRUD
// -------------------------------------------------------------
app.get('/api/expenses', async (req, res) => {
  try {
    const { page, pageSize, category } = req.query;
    const result = await listDocs('expenses', {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      filterFn: category && category !== 'all' ? (e) => e.category === category : undefined,
      orderByField: 'date',
      orderDirection: 'desc'
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const body = { ...req.body };
    const titleVal = (body.title || body.description || 'Expense').trim();
    const descVal = (body.description || body.title || titleVal).trim();
    const vendorVal = (body.vendor || body.vendorName || '').trim();
    const vendorNameVal = (body.vendorName || body.vendor || vendorVal).trim();
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const amt = Number(body.amount) || 0;
    const totAmt = Number(body.totalAmount) || (amt + gstAmt);
    const itc = body.itcEligible !== undefined ? Boolean(body.itcEligible) : (body.isTaxDeductible !== undefined ? Boolean(body.isTaxDeductible) : true);
    const pMode = body.paymentMode || body.paymentMethod || 'Bank';
    const pMethod = body.paymentMethod || body.paymentMode || 'Bank';

    const normalizedBody = {
      ...body,
      title: titleVal,
      description: descVal,
      vendor: vendorVal,
      vendorName: vendorNameVal,
      vendorGstin: (body.vendorGstin || '').trim(),
      amount: amt,
      taxAmount: taxAmt,
      gstAmount: gstAmt,
      totalAmount: totAmt,
      paymentMode: pMode,
      paymentMethod: pMethod,
      itcEligible: itc,
      isTaxDeductible: itc,
      date: body.date || body.expenseDate || new Date().toISOString().split('T')[0]
    };

    const parseResult = ExpenseSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense data',
        errors: parseResult.error.issues
      });
    }

    const newId = `exp_${Date.now()}`;
    const newExp = {
      id: newId,
      createdAt: new Date().toISOString(),
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

    await setDoc('expenses', newId, newExp);
    await addAuditLog('Expense Added', 'expense', newExp.id, `${newExp.category}: ₹${newExp.totalAmount}`);

    res.status(201).json({ success: true, data: newExp });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  try {
    const existing = await getDoc('expenses', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    const body = { ...existing, ...req.body };
    const titleVal = (body.title || body.description || existing.title || existing.description || 'Expense').trim();
    const descVal = (body.description || body.title || titleVal).trim();
    const vendorVal = (body.vendor || body.vendorName || '').trim();
    const vendorNameVal = (body.vendorName || body.vendor || vendorVal).trim();
    const taxAmt = Number(body.taxAmount ?? body.gstAmount ?? 0);
    const gstAmt = Number(body.gstAmount ?? body.taxAmount ?? 0);
    const amt = Number(body.amount) || 0;
    const totAmt = Number(body.totalAmount) || (amt + gstAmt);
    const itc = body.itcEligible !== undefined ? Boolean(body.itcEligible) : (body.isTaxDeductible !== undefined ? Boolean(body.isTaxDeductible) : true);

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
      updatedAt: new Date().toISOString()
    };

    await setDoc('expenses', req.params.id, updated, true);
    await addAuditLog('Expense Updated', 'expense', updated.id, `${updated.category}: ₹${updated.totalAmount}`);

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const existing = await getDoc('expenses', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    await deleteDoc('expenses', req.params.id);
    await addAuditLog('Expense Deleted', 'expense', req.params.id, existing.category);

    res.json({ success: true, message: 'Expense deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CLIENT ONBOARDINGS & MONTHLY RETAINER CRM
// -------------------------------------------------------------
app.get('/api/onboardings', async (req, res) => {
  try {
    const { month, status, search, page, pageSize } = req.query;

    const result = await listDocs('onboardings', {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 500,
      status: status && status !== 'all' ? (status as string) : undefined,
      search: search as string,
      searchFields: ['customerName', 'businessName', 'phone', 'onboardingNumber'],
      filterFn: month && month !== 'all' ? (o) => o.monthYear === month || (o.onboardingDate && o.onboardingDate.startsWith(month as string)) : undefined,
      orderByField: 'onboardingDate',
      orderDirection: 'desc'
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/onboardings/analytics/month-wise', async (req, res) => {
  try {
    const result = await listDocs('onboardings', { pageSize: 1000 });
    const list = result.docs.map(processOnboardingRecord);

    const monthMap: Record<string, any> = {};

    list.forEach(item => {
      const month = item.monthYear || (item.onboardingDate ? item.onboardingDate.slice(0, 7) : '2026-09');
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
      if (item.status === 'active') m.activeClients += 1;
      m.totalSales += (item.totalPackageValue || 0);
      m.totalServiceFee += (item.serviceFee || 0);
      m.totalAdBudget += (item.adTotalBudget || 0);
      m.totalAdvanceReceived += (item.advancePaid || 0);
      m.totalRemainingBalance += (item.remainingBalance || 0);
      m.totalIncentives += (item.incentiveAmount || 0);

      if (item.isPaymentOverdue) m.overdueCount += 1;
      if (item.isAdExpired) m.adExpiredCount += 1;
    });

    const monthArray = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));

    const overall = {
      totalClients: list.length,
      activeClients: list.filter(o => o.status === 'active').length,
      totalSales: list.reduce((s, o) => s + (o.totalPackageValue || 0), 0),
      totalAdvanceReceived: list.reduce((s, o) => s + (o.advancePaid || 0), 0),
      totalRemainingBalance: list.reduce((s, o) => s + (o.remainingBalance || 0), 0),
      totalAdBudget: list.reduce((s, o) => s + (o.adTotalBudget || 0), 0),
      totalIncentives: list.reduce((s, o) => s + (o.incentiveAmount || 0), 0),
      overdueCount: list.filter(o => o.isPaymentOverdue).length,
      adExpiredCount: list.filter(o => o.isAdExpired).length
    };

    res.json({
      success: true,
      data: {
        overall,
        monthlyBreakdown: monthArray
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/onboardings/:id', async (req, res) => {
  try {
    const item = await getDoc('onboardings', req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
    }
    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/onboardings', async (req, res) => {
  try {
    const parseResult = OnboardingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid onboarding data',
        errors: parseResult.error.issues
      });
    }

    const body = req.body;
    const count = await countDocs('onboardings');
    const seqNum = String(count + 1).padStart(3, '0');
    const onboardingNumber = body.onboardingNumber || `ONB-${seqNum}`;

    const onboardingDate = body.onboardingDate || new Date().toISOString().split('T')[0];
    const billingCycleDays = body.billingCycleDays || 30;

    let nextPaymentDueDate = body.nextPaymentDueDate;
    if (!nextPaymentDueDate) {
      const obDate = new Date(onboardingDate);
      const dueDateObj = new Date(obDate.getTime() + billingCycleDays * 24 * 60 * 60 * 1000);
      nextPaymentDueDate = dueDateObj.toISOString().split('T')[0];
    }

    const hasAdsCampaign = Boolean(body.hasAdsCampaign);
    let adCampaignStartDate = body.adCampaignStartDate || onboardingDate;
    let adCampaignEndDate = body.adCampaignEndDate;
    const adDurationDays = body.adDurationDays || 15;
    if (hasAdsCampaign && !adCampaignEndDate) {
      const sDate = new Date(adCampaignStartDate);
      const eDate = new Date(sDate.getTime() + adDurationDays * 24 * 60 * 60 * 1000);
      adCampaignEndDate = eDate.toISOString().split('T')[0];
    }

    const serviceFee = Number(body.serviceFee) || 0;
    const adDailyBudget = Number(body.adDailyBudget) || 0;
    const adTotalBudget = hasAdsCampaign ? (Number(body.adTotalBudget) || (adDailyBudget * adDurationDays)) : 0;
    const totalPackageValue = Number(body.totalPackageValue) || (serviceFee + adTotalBudget);
    const advancePaid = Number(body.advancePaid) || 0;
    const remainingBalance = Math.max(0, totalPackageValue - advancePaid);

    let paymentStatus = 'unpaid';
    if (remainingBalance === 0 && totalPackageValue > 0) paymentStatus = 'paid';
    else if (advancePaid > 0) paymentStatus = 'partially_paid';

    const incentivePercentage = Number(body.incentivePercentage) || 10;
    const incentiveAmount = body.incentiveAmount !== undefined
      ? Number(body.incentiveAmount)
      : Math.round((serviceFee * incentivePercentage) / 100);

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
        ...(advancePaid > 0 ? [{
          id: `pay_${Date.now()}`,
          date: onboardingDate,
          amount: advancePaid,
          type: 'advance',
          paymentMethod: body.advancePaymentMethod || 'UPI',
          notes: 'Upfront advance payment recorded at onboarding'
        }] : [])
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc('onboardings', newId, newOnboarding);
    await addAuditLog('Customer Onboarded', 'onboarding', newOnboarding.id, `${newOnboarding.businessName} (₹${newOnboarding.totalPackageValue})`);

    res.status(201).json({ success: true, data: processOnboardingRecord(newOnboarding) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/onboardings/:id', async (req, res) => {
  try {
    const existing = await getDoc('onboardings', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
    }

    const updated = {
      ...existing,
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    if (Array.isArray(req.body.services)) {
      updated.services = req.body.services;
    }

    if (req.body.services && Array.isArray(req.body.services) && req.body.services.length > 0) {
      const sumMgmt = req.body.services.reduce((acc: number, s: any) => acc + (Number(s.managementFee) || 0), 0);
      const sumMgmtPaid = req.body.services.reduce((acc: number, s: any) => acc + (Number(s.managementFeePaid) || 0), 0);
      const sumAd = req.body.services.reduce((acc: number, s: any) => acc + (Number(s.adBudget) || 0), 0);
      const sumAdPaid = req.body.services.reduce((acc: number, s: any) => acc + (Number(s.adBudgetPaid) || 0), 0);
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
      updated.paymentStatus = updated.totalDue === 0 ? 'paid' : (sumRec > 0 ? 'partially_paid' : 'unpaid');
    } else if (req.body.serviceFee !== undefined || req.body.adTotalBudget !== undefined || req.body.advancePaid !== undefined) {
      const sFee = Number(updated.serviceFee) || 0;
      const adBudget = updated.hasAdsCampaign ? (Number(updated.adTotalBudget) || 0) : 0;
      updated.totalPackageValue = sFee + adBudget;

      const totalPayments = (updated.paymentHistory || []).reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
      const effectivePaid = Math.max(Number(updated.advancePaid) || 0, totalPayments);
      updated.remainingBalance = Math.max(0, updated.totalPackageValue - effectivePaid);

      if (updated.remainingBalance === 0 && updated.totalPackageValue > 0) {
        updated.paymentStatus = 'paid';
      } else if (effectivePaid > 0) {
        updated.paymentStatus = 'partially_paid';
      } else {
        updated.paymentStatus = 'unpaid';
      }
    }

    await setDoc('onboardings', req.params.id, updated, true);
    await addAuditLog('Customer Onboarding Updated', 'onboarding', updated.id, updated.businessName);

    res.json({ success: true, data: processOnboardingRecord(updated) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/onboardings/:id', async (req, res) => {
  try {
    const existing = await getDoc('onboardings', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
    }

    await deleteDoc('onboardings', req.params.id);
    await addAuditLog('Customer Onboarding Removed', 'onboarding', req.params.id, existing.businessName);

    res.json({ success: true, message: 'Onboarding record removed' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/onboardings/:id/renew-cycle', async (req, res) => {
  try {
    const item = await getDoc('onboardings', req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const cycleDays = item.billingCycleDays || 30;
    const baseDate = new Date();
    const nextDueDateObj = new Date(baseDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);
    const nextPaymentDueDate = nextDueDateObj.toISOString().split('T')[0];

    item.lastRenewalDate = todayStr;
    item.nextPaymentDueDate = nextPaymentDueDate;
    item.status = 'active';
    item.updatedAt = new Date().toISOString();

    if (req.body.resetBalance) {
      item.remainingBalance = item.serviceFee + (item.hasAdsCampaign ? item.adTotalBudget : 0);
      item.paymentStatus = 'unpaid';
    }

    await setDoc('onboardings', item.id, item, true);
    await addAuditLog('Billing Cycle Renewed (30 Days)', 'onboarding', item.id, `${item.businessName} next due on ${nextPaymentDueDate}`);

    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/onboardings/:id/record-payment', async (req, res) => {
  try {
    const item = await getDoc('onboardings', req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
    }

    const { amount, paymentMethod, type, notes, date, transactionId } = req.body;
    const payAmount = Number(amount) || 0;
    if (payAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const newPayment = {
      id: `pay_${Date.now()}`,
      date: date || new Date().toISOString().split('T')[0],
      amount: payAmount,
      type: type || 'Partial Payment',
      paymentMethod: paymentMethod || 'UPI',
      transactionId: transactionId || '',
      notes: notes || 'Payment received'
    };

    item.paymentHistory = item.paymentHistory || [];
    item.paymentHistory.push(newPayment);

    const totalPaid = item.paymentHistory.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
    item.remainingBalance = Math.max(0, item.totalPackageValue - totalPaid);

    if (item.remainingBalance === 0) {
      item.paymentStatus = 'paid';
      item.incentiveStatus = 'eligible';
    } else {
      item.paymentStatus = 'partially_paid';
    }

    item.updatedAt = new Date().toISOString();
    await setDoc('onboardings', item.id, item, true);

    // Sync to linked invoice if exists
    if (item.invoiceId) {
      try {
        const inv = await getDoc('invoices', item.invoiceId);
        if (inv) {
          const invPayment = {
            id: newPayment.id,
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            clientId: item.clientId || inv.clientId || '',
            clientName: item.businessName || item.customerName || inv.client?.name || 'Client',
            serviceName: item.servicePackage || 'Services',
            dealId: item.id,
            dealTitle: item.businessName || item.customerName,
            amount: payAmount,
            paymentDate: newPayment.date,
            paymentType: type || (item.remainingBalance <= 0.01 ? 'Balance Payment' : 'Partial Payment'),
            paymentMethod: paymentMethod || 'UPI',
            transactionId: transactionId || '',
            notes: notes || 'Payment received via Client Deals & Sales',
            remainingBalance: Math.max(0, (Number(inv.grandTotal) || 0) - (Number(inv.amountPaid || 0) + payAmount)),
            createdAt: new Date().toISOString()
          };
          inv.payments = Array.isArray(inv.payments) ? inv.payments : [];
          inv.payments.push(invPayment);
          inv.amountPaid = round2(inv.payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0));
          inv.balanceDue = round2(Math.max(0, (Number(inv.grandTotal) || 0) - inv.amountPaid));
          if (inv.balanceDue <= 0.01 && Number(inv.grandTotal) > 0) inv.status = 'paid';
          else if (inv.amountPaid > 0) inv.status = 'partially_paid';
          inv.updatedAt = new Date().toISOString();
          await setDoc('invoices', inv.id, inv, true);
        }
      } catch (e) {
        console.warn('Failed to sync onboarding payment to invoice:', e);
      }
    }

    await addAuditLog('Payment Recorded for Onboarded Client', 'onboarding', item.id, `₹${payAmount} (${newPayment.type}) received for ${item.businessName}`);

    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/onboardings/:id/topup-ads', async (req, res) => {
  try {
    const item = await getDoc('onboardings', req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Onboarding record not found' });
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
    item.adCampaignStartDate = new Date().toISOString().split('T')[0];

    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    item.adCampaignEndDate = endDate.toISOString().split('T')[0];
    item.totalPackageValue = (item.serviceFee || 0) + item.adTotalBudget;
    item.remainingBalance = (item.remainingBalance || 0) + addedBudget;
    item.updatedAt = new Date().toISOString();

    await setDoc('onboardings', item.id, item, true);
    await addAuditLog('Ad Campaign Budget Top-up', 'onboarding', item.id, `₹${addedBudget} added for ${item.businessName} (${days} days)`);

    res.json({ success: true, data: processOnboardingRecord(item) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// AUDIT LOGS
// -------------------------------------------------------------
app.get('/api/audit-logs', async (req, res) => {
  try {
    const result = await listDocs('auditLogs', { pageSize: 200, orderByField: 'timestamp', orderDirection: 'desc' });
    res.json({ success: true, data: result.docs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// REPORTS DATA
// -------------------------------------------------------------
app.get('/api/reports', async (req, res) => {
  try {
    const { financialYear, month, clientId } = req.query;

    const [invoicesResult, expensesResult] = await Promise.all([
      listDocs('invoices', {
        pageSize: 1000,
        filterFn: (inv) => {
          if (inv.status === 'cancelled') return false;
          if (financialYear && financialYear !== 'All' && inv.financialYear !== financialYear) return false;
          if (month && month !== 'All' && !inv.invoiceDate.startsWith(month as string)) return false;
          if (clientId && clientId !== 'All' && inv.clientId !== clientId) return false;
          return true;
        }
      }),
      listDocs('expenses', { pageSize: 500 })
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

    const allPayments = filteredInvoices.flatMap(inv =>
      (inv.payments || []).map((p: any) => ({
        ...p,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name || 'Client',
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function getFinancialYear(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-indexed: Apr = 3
    if (month >= 3) {
      return `FY ${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `FY ${year - 1}-${year.toString().slice(-2)}`;
    }
  } catch {
    return 'FY 2026-27';
  }
}

// -------------------------------------------------------------
// DASHBOARD ANALYTICS (Requirement 8 - Efficient Aggregations)
// -------------------------------------------------------------
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    // 1. Efficient parallel counts using countDocs
    const [
      totalCount,
      draftCount,
      sentCount,
      paidCount,
      partiallyPaidCount,
      expensesCount
    ] = await Promise.all([
      countDocs('invoices'),
      countDocs('invoices', 'draft'),
      countDocs('invoices', 'sent'),
      countDocs('invoices', 'paid'),
      countDocs('invoices', 'partially_paid'),
      countDocs('expenses')
    ]);

    // 2. Sample recent active invoices for live aggregates & charts
    const invoicesResult = await listDocs('invoices', {
      pageSize: 300,
      orderByField: 'invoiceDate',
      orderDirection: 'desc'
    });

    const activeInvoices = invoicesResult.docs.filter((inv: any) => inv.status !== 'cancelled');
    const now = new Date();

    const overdueCount = activeInvoices.filter((inv: any) => {
      if (inv.status === 'paid' || inv.status === 'draft') return false;
      return new Date(inv.dueDate) < now && (inv.balanceDue || 0) > 0;
    }).length;

    const totalSales = round2(activeInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.grandTotal) || 0), 0));
    const totalGstCollected = round2(activeInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.totalGst) || 0), 0));
    const outstandingAmount = round2(activeInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.balanceDue) || 0), 0));

    const currentMonthPrefix = now.toISOString().slice(0, 7);
    const thisMonthInvoices = activeInvoices.filter((inv: any) => inv.invoiceDate?.startsWith(currentMonthPrefix));
    const thisMonthRevenue = round2(thisMonthInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.grandTotal) || 0), 0));
    const thisMonthGst = round2(thisMonthInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.totalGst) || 0), 0));

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const last30DaysInvoices = activeInvoices.filter((inv: any) => new Date(inv.invoiceDate) >= thirtyDaysAgo);
    const last30DaysRevenue = round2(last30DaysInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.grandTotal) || 0), 0));

    // Calculate dynamic monthly revenue
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyMap: Record<string, { revenue: number; gst: number }> = {};
    for (const name of monthNames) monthlyMap[name] = { revenue: 0, gst: 0 };

    activeInvoices.forEach((inv: any) => {
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
      { name: 'Apr', revenue: round2(monthlyMap['Apr'].revenue), gst: round2(monthlyMap['Apr'].gst) },
      { name: 'May', revenue: round2(monthlyMap['May'].revenue), gst: round2(monthlyMap['May'].gst) },
      { name: 'Jun', revenue: round2(monthlyMap['Jun'].revenue), gst: round2(monthlyMap['Jun'].gst) },
      { name: 'Jul', revenue: round2(monthlyMap['Jul'].revenue), gst: round2(monthlyMap['Jul'].gst) },
      { name: 'Aug', revenue: round2(monthlyMap['Aug'].revenue), gst: round2(monthlyMap['Aug'].gst) },
      { name: 'Sep', revenue: round2(monthlyMap['Sep'].revenue), gst: round2(monthlyMap['Sep'].gst) },
      { name: 'Oct', revenue: round2(monthlyMap['Oct'].revenue), gst: round2(monthlyMap['Oct'].gst) },
      { name: 'Nov', revenue: round2(monthlyMap['Nov'].revenue), gst: round2(monthlyMap['Nov'].gst) },
      { name: 'Dec', revenue: round2(monthlyMap['Dec'].revenue), gst: round2(monthlyMap['Dec'].gst) },
      { name: 'Jan', revenue: round2(monthlyMap['Jan'].revenue), gst: round2(monthlyMap['Jan'].gst) },
      { name: 'Feb', revenue: round2(monthlyMap['Feb'].revenue), gst: round2(monthlyMap['Feb'].gst) },
      { name: 'Mar', revenue: round2(monthlyMap['Mar'].revenue), gst: round2(monthlyMap['Mar'].gst) }
    ];

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyMap: Record<string, { revenue: number; gst: number }> = {
      Mon: { revenue: 0, gst: 0 },
      Tue: { revenue: 0, gst: 0 },
      Wed: { revenue: 0, gst: 0 },
      Thu: { revenue: 0, gst: 0 },
      Fri: { revenue: 0, gst: 0 },
      Sat: { revenue: 0, gst: 0 },
      Sun: { revenue: 0, gst: 0 }
    };
    thisMonthInvoices.forEach((inv: any) => {
      if (inv.invoiceDate) {
        const day = dayNames[new Date(inv.invoiceDate).getDay()];
        if (dailyMap[day]) {
          dailyMap[day].revenue += Number(inv.grandTotal) || 0;
          dailyMap[day].gst += Number(inv.totalGst) || 0;
        }
      }
    });

    const dailyChart = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(name => ({
      name,
      revenue: round2(dailyMap[name].revenue),
      gst: round2(dailyMap[name].gst)
    }));

    const weeklyBuckets = [
      { name: 'Week 1', revenue: 0, gst: 0 },
      { name: 'Week 2', revenue: 0, gst: 0 },
      { name: 'Week 3', revenue: 0, gst: 0 },
      { name: 'Week 4', revenue: 0, gst: 0 }
    ];
    thisMonthInvoices.forEach((inv: any) => {
      if (inv.invoiceDate) {
        const dom = new Date(inv.invoiceDate).getDate();
        const bIdx = dom <= 7 ? 0 : dom <= 14 ? 1 : dom <= 21 ? 2 : 3;
        weeklyBuckets[bIdx].revenue += Number(inv.grandTotal) || 0;
        weeklyBuckets[bIdx].gst += Number(inv.totalGst) || 0;
      }
    });

    const weeklyChart = weeklyBuckets.map(b => ({
      name: b.name,
      revenue: round2(b.revenue),
      gst: round2(b.gst)
    }));

    const fyMap: Record<string, { revenue: number; gst: number }> = {};
    activeInvoices.forEach((inv: any) => {
      const fy = inv.financialYear || getFinancialYear(inv.invoiceDate || new Date().toISOString());
      if (!fyMap[fy]) fyMap[fy] = { revenue: 0, gst: 0 };
      fyMap[fy].revenue += Number(inv.grandTotal) || 0;
      fyMap[fy].gst += Number(inv.totalGst) || 0;
    });
    ['FY 2024-25', 'FY 2025-26', 'FY 2026-27'].forEach(fy => {
      if (!fyMap[fy]) fyMap[fy] = { revenue: 0, gst: 0 };
    });

    const yearlyChart = Object.keys(fyMap).sort().map(fy => ({
      name: fy,
      revenue: round2(fyMap[fy].revenue),
      gst: round2(fyMap[fy].gst)
    }));

    const creditNotesRes = await listDocs('creditNotes', { pageSize: 500 });
    const totalCreditsIssued = round2(creditNotesRes.docs.reduce((sum: number, cn: any) => sum + (Number(cn.totalAmount) || 0), 0));
    const netSales = Math.max(0, round2(totalSales - totalCreditsIssued));

    const expensesRes = await listDocs('expenses', { pageSize: 500 });
    const totalExpenses = round2(expensesRes.docs.reduce((sum: number, e: any) => sum + (Number(e.totalAmount) || 0), 0));

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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & STATIC SERVING
// -------------------------------------------------------------
async function startServer() {
  const isDev = process.env.npm_lifecycle_event === 'dev';
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  // Use Vite middlewares only in explicit dev mode or if dist hasn't been built yet.
  // In production / container deployment, serve static assets directly from dist.
  if (isDev || !hasDist) {
    console.log('Starting Vite in development middleware mode...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log(`Serving production static assets from ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`GST Billing CRM Server with Firestore running at http://${HOST}:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use!`);
      if (PORT !== 3000) {
        console.log('Attempting fallback to port 3000...');
        app.listen(3000, HOST, () => {
          console.log(`Fallback server listening at http://${HOST}:3000`);
        });
      }
    } else {
      console.error('Server listen error:', err);
    }
  });

  // Non-blocking background check for initial Firestore settings
  setTimeout(async () => {
    try {
      const profile = await getDoc('settings', 'businessProfile');
      if (!profile) {
        console.log('Bootstrapping initial settings into Firestore...');
        await runMigration();
      }
    } catch (e) {
      console.warn('Initial settings check:', e);
    }
  }, 500);
}

export default app;
export { app };

// Only start the standalone HTTP server when not running in a Vercel serverless environment
if (!process.env.VERCEL) {
  startServer();
}
