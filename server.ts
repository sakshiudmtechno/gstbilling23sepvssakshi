import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
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
        phone: '9826000000',
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
// INVOICES CRUD
// -------------------------------------------------------------
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

// Record Payment on Invoice
app.post('/api/invoices/:id/payments', async (req, res) => {
  try {
    const invoice = await getDoc('invoices', req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const parseResult = PaymentRecordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment data',
        errors: parseResult.error.issues
      });
    }

    const paymentAmount = round2(parseResult.data.amount);
    const newPayment = {
      id: `pay_${Date.now()}`,
      invoiceId: invoice.id,
      amount: paymentAmount,
      paymentDate: parseResult.data.paymentDate || new Date().toISOString().split('T')[0],
      paymentMethod: parseResult.data.paymentMethod || 'Bank Transfer',
      transactionId: parseResult.data.transactionId || '',
      notes: parseResult.data.notes || '',
      createdAt: new Date().toISOString()
    };

    const payments = [...(invoice.payments || []), newPayment];
    const advance = round2(Number(invoice.advanceAmount) || 0);
    const paymentsTotal = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const totalPaid = round2(advance + paymentsTotal);
    const balanceDue = round2(Math.max(0, invoice.grandTotal - totalPaid));

    let status = invoice.status;
    if (balanceDue <= 0.01) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partially_paid';
    }

    const updatedInvoice = {
      ...invoice,
      payments,
      amountPaid: totalPaid,
      balanceDue,
      status,
      updatedAt: new Date().toISOString()
    };

    await setDoc('invoices', invoice.id, updatedInvoice, true);
    await addAuditLog(
      'Payment Recorded',
      'payment',
      invoice.id,
      invoice.invoiceNumber,
      'UDM Admin',
      `Recorded ₹${paymentAmount} via ${newPayment.paymentMethod} (Bal: ₹${balanceDue})`
    );

    res.json({ success: true, data: updatedInvoice, payment: newPayment });
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

    const nextNumber = await generateNextInvoiceNumber();
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const invoiceSettings = (await getDoc('settings', 'invoiceSettings')) || {};

    const newInvoice: any = {
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
      currency: quote.currency || 'INR',
      financialYear: 'FY 2026-27',
      isInterState: quote.isInterState,
      status: 'draft',
      template: quote.template || 'classic',
      seller: businessProfile,
      clientId: quote.clientId,
      client: quote.client,
      items: quote.items || [],
      discountType: quote.discountType || 'percentage',
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
// RECURRING INVOICES CRUD
// -------------------------------------------------------------
app.get('/api/recurring-invoices', async (req, res) => {
  try {
    const result = await listDocs('recurringInvoices', { pageSize: 500, orderByField: 'createdAt', orderDirection: 'desc' });
    res.json({ success: true, data: result.docs });
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
    }

    // 2. Line Items normalization & fallback:
    // If items array is not provided or empty, synthesize from invoiceTemplateData.items or cycleRate/rate
    if (!Array.isArray(body.items) || body.items.length === 0) {
      if (Array.isArray(body.invoiceTemplateData?.items) && body.invoiceTemplateData.items.length > 0) {
        body.items = body.invoiceTemplateData.items;
      } else if (body.rate !== undefined || body.cycleRate !== undefined || body.amount !== undefined) {
        const flatRate = Number(body.rate || body.cycleRate || body.amount) || 0;
        const gstRate = Number(body.gstRate !== undefined ? body.gstRate : 18);
        body.items = [
          {
            id: `rec_item_${Date.now()}`,
            name: body.title || 'Recurring AMC & Retainer Service',
            description: body.description || 'Automated recurring retainer service',
            hsnSac: body.hsnSac || '9983',
            quantity: 1,
            unit: body.unit || 'MONTH',
            rate: flatRate,
            gstRate: gstRate,
            discountType: 'percentage',
            discountValue: 0,
            discountAmount: 0
          }
        ];
      }
    }

    // Normalize each item to ensure types conform to LineItemSchema
    if (Array.isArray(body.items)) {
      body.items = body.items.map((item: any, idx: number) => ({
        id: item.id || `item_${Date.now()}_${idx}`,
        name: String(item.name || body.title || 'Recurring Service Item').trim(),
        description: String(item.description || '').trim(),
        hsnSac: String(item.hsnSac || '9983').trim(),
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        unit: String(item.unit || 'MONTH').trim(),
        rate: Number(item.rate) >= 0 ? Number(item.rate) : 0,
        discountType: item.discountType === 'fixed' ? 'fixed' : 'percentage',
        discountValue: Number(item.discountValue) || 0,
        discountAmount: Number(item.discountAmount) || 0,
        gstRate: Number(item.gstRate !== undefined ? item.gstRate : 18)
      }));
    }

    const parseResult = RecurringInvoiceSchema.safeParse(body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recurring invoice data',
        errors: parseResult.error.issues
      });
    }

    const client = (await getDoc('clients', parseResult.data.clientId)) || parseResult.data.client || {};
    const businessProfile = (await getDoc('settings', 'businessProfile')) || {};
    const sellerStateCode = businessProfile.stateCode || '23';
    const clientStateCode = client.stateCode || '23';
    const isInterState = sellerStateCode !== clientStateCode;

    // Calculate canonical GST totals for the recurring profile
    const totals = calculateInvoiceTotals(parseResult.data.items as any, { isInterState }, 'draft');

    const count = await countDocs('recurringInvoices');
    const newId = `rec_${Date.now()}`;
    const newRec = {
      id: newId,
      recurringNumber: req.body.recurringNumber || `REC-00${count + 1}`,
      createdAt: new Date().toISOString(),
      ...parseResult.data,
      client: client.name ? client : parseResult.data.client,
      clientName: client.name || parseResult.data.clientName || 'Client',
      nextInvoiceDate: parseResult.data.nextInvoiceDate || parseResult.data.startDate,
      invoiceTemplateData: {
        ...(parseResult.data.invoiceTemplateData || {}),
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

    const { amount, paymentMethod, type, notes, date } = req.body;
    const payAmount = Number(amount) || 0;
    if (payAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const newPayment = {
      id: `pay_${Date.now()}`,
      date: date || new Date().toISOString().split('T')[0],
      amount: payAmount,
      type: type || 'balance',
      paymentMethod: paymentMethod || 'UPI',
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
    await addAuditLog('Payment Recorded for Onboarded Client', 'onboarding', item.id, `₹${payAmount} received for ${item.businessName}`);

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

startServer();
