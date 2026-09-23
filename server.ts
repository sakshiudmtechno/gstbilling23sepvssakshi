import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

const app = express();
const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

// CORS: only applies when ALLOWED_ORIGINS env is set. Default: same-origin only.
if (process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Data Directory & Persistence
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Database Structure
const initialDb = {
  users: [
    {
      id: 'usr_admin',
      email: 'sankalpnayakk@gmail.com',
      name: 'UDM Admin',
      role: 'admin'
    }
  ],
  businessProfile: {
    businessName: 'UDM Techno Solutions',
    legalName: 'UDM Techno Solutions Pvt. Ltd.',
    address: 'Shagun Tower, Office No.508, Plot No. 7 PU4, AB Rd, above Apna Sweets, Vijay Nagar, Scheme No 54',
    city: 'Indore',
    state: 'Madhya Pradesh',
    stateCode: '23',
    country: 'India',
    pinCode: '452010',
    gstin: '23AHWPH3168H2Z2',
    pan: 'AHWPH3168H',
    phone: '+91 99936 63668',
    email: 'Contact@udmtechno.com',
    website: 'https://Udmtechno.com',
    logoUrl: '/udm-logo.svg',
    signatureUrl: '',
    authorizedSignatoryName: '',
    bankName: 'Bank of Baroda',
    accountNumber: '05740100011588',
    accountHolderName: 'UDM Techno Solutions (Sankalp Nayak)',
    ifscCode: 'BARB0MEGHNA',
    branch: 'Indore',
    upiId: 'sankalpnayakk-2@okicici',
    upiQrImageUrl: '/upi-qr.png'
  },
  invoiceSettings: {
    prefix: 'A',
    startingNumber: 345,
    numberPadding: 6,
    nextSequence: 345,
    defaultCurrency: 'INR',
    defaultGstRate: 0,
    defaultPaymentTerms: 'Payment is due by the due date mentioned above. Please make payment using Bank of Baroda A/C 05740100011588 (IFSC: BARB0MEGHNA).',
    defaultNotes: 'Thank you for choosing UDM Techno Solutions for your technology and software needs.'
  },
  taxSettings: {
    gstRegistrationState: 'Madhya Pradesh',
    gstRegistrationStateCode: '23',
    businessGstin: '23AHWPH3168H2Z2',
    businessPan: 'AHWPH3168H',
    defaultRates: [0, 5, 12, 18, 28],
    commonHsnSac: [
      { code: '9983', description: 'IT, Software & Website Development Services', defaultGst: 18 },
      { code: '998314', description: 'Web & Mobile Application Design & Development', defaultGst: 18 },
      { code: '998315', description: 'Hosting, Infrastructure & Cloud Services', defaultGst: 18 }
    ]
  },
  paymentSettings: {
    bankName: 'Bank of Baroda',
    accountName: 'UDM Techno Solutions (Sankalp Nayak)',
    accountNumber: '05740100011588',
    ifsc: 'BARB0MEGHNA',
    branch: 'Indore',
    upiId: 'sankalpnayakk-2@okicici',
    enableUpiQr: true
  },
  pdfSettings: {
    defaultTemplate: 'classic',
    accentColor: '#1e40af',
    showLogo: true,
    showSignature: true,
    showBankDetails: true,
    showUpiQr: true,
    showTotalInWords: true,
    footerText: 'This is a computer-generated tax invoice issued in accordance with GST Rules.'
  },
  clients: [],
  invoices: [],
  quotes: [],
  creditNotes: [],
  recurringInvoices: [],
  expenses: [],
  auditLogs: [],
  onboardings: []
};

// Database helper
let db = initialDb;

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      db = { ...initialDb, ...JSON.parse(data) };
    } else {
      saveDb();
    }
    
    if (!Array.isArray(db.onboardings)) {
      db.onboardings = [];
    }

    if (db.onboardings.length === 0) {
      db.onboardings = [
        {
          id: 'onb_apex_01',
          onboardingNumber: 'ONB-001',
          customerName: 'Dr. Rajesh Sharma',
          businessName: 'Apex Healthcare & Multi-specialty Clinic',
          contactPerson: 'Dr. Rajesh Sharma',
          phone: '+91 98930 11223',
          email: 'rajesh@apexclinic.com',
          city: 'Indore',
          state: 'Madhya Pradesh',
          status: 'active',
          onboardingDate: '2026-08-15',
          billingCycleDays: 30,
          nextPaymentDueDate: '2026-09-14',
          lastRenewalDate: '2026-08-15',
          servicePackage: 'Meta Ads & Patient Lead Generation Retainer',
          hasAdsCampaign: true,
          adPlatform: 'meta',
          adDailyBudget: 300,
          adDurationDays: 15,
          adTotalBudget: 4500,
          adCampaignStartDate: '2026-08-15',
          adCampaignEndDate: '2026-08-30',
          adBudgetPaid: 4500,
          serviceFee: 15000,
          totalPackageValue: 19500,
          advancePaid: 10000,
          remainingBalance: 9500,
          paymentStatus: 'partially_paid',
          paymentHistory: [
            {
              id: 'pay_apex_1',
              date: '2026-08-15',
              amount: 10000,
              type: 'advance',
              paymentMethod: 'UPI',
              notes: 'Upfront advance payment via Google Pay'
            }
          ],
          assignedExecutive: 'Sankalp',
          salesManager: 'Sankalp',
          incentivePercentage: 10,
          incentiveAmount: 1500,
          incentiveStatus: 'pending',
          notes: 'High-intent patient appointments for dental & orthopedic OPD.',
          remarks: 'High-intent patient appointments for dental & orthopedic OPD.',
          monthYear: '2026-08',
          createdAt: '2026-08-15T10:00:00.000Z',
          updatedAt: '2026-08-15T10:00:00.000Z'
        },
        {
          id: 'onb_royal_02',
          onboardingNumber: 'ONB-002',
          customerName: 'Vikram Singhania',
          businessName: 'Royal Real Estate & Towers',
          contactPerson: 'Vikram Singhania',
          phone: '+91 98260 44556',
          email: 'vikram@royalrealestate.in',
          city: 'Indore',
          state: 'Madhya Pradesh',
          status: 'active',
          onboardingDate: '2026-08-01',
          billingCycleDays: 30,
          nextPaymentDueDate: '2026-08-31',
          lastRenewalDate: '2026-08-01',
          servicePackage: 'Google Search & Call Ads + Landing Page Retainer',
          hasAdsCampaign: true,
          adPlatform: 'google',
          adDailyBudget: 500,
          adDurationDays: 15,
          adTotalBudget: 7500,
          adCampaignStartDate: '2026-08-01',
          adCampaignEndDate: '2026-08-16',
          adBudgetPaid: 7500,
          serviceFee: 25000,
          totalPackageValue: 32500,
          advancePaid: 15000,
          remainingBalance: 17500,
          paymentStatus: 'partially_paid',
          paymentHistory: [
            {
              id: 'pay_royal_1',
              date: '2026-08-01',
              amount: 15000,
              type: 'advance',
              paymentMethod: 'Bank Transfer',
              notes: 'Advance transfer to Bank of Baroda account'
            }
          ],
          assignedExecutive: 'Mahendra',
          salesManager: 'Mahendra',
          incentivePercentage: 10,
          incentiveAmount: 2500,
          incentiveStatus: 'pending',
          notes: '3BHK Luxury Flats campaign at Super Corridor, Indore.',
          remarks: '3BHK Luxury Flats campaign at Super Corridor, Indore.',
          monthYear: '2026-08',
          createdAt: '2026-08-01T09:30:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z'
        },
        {
          id: 'onb_luxe_03',
          onboardingNumber: 'ONB-003',
          customerName: 'Ar. Meera Kapoor',
          businessName: 'Luxe Interior Architecture & Studios',
          contactPerson: 'Meera Kapoor',
          phone: '+91 94250 88990',
          email: 'meera@luxeinteriors.in',
          city: 'Indore',
          state: 'Madhya Pradesh',
          status: 'active',
          onboardingDate: '2026-09-01',
          billingCycleDays: 30,
          nextPaymentDueDate: '2026-10-01',
          lastRenewalDate: '2026-09-01',
          servicePackage: 'Complete Digital Marketing + Meta & Google Ads Retainer',
          hasAdsCampaign: true,
          adPlatform: 'both',
          adDailyBudget: 400,
          adDurationDays: 30,
          adTotalBudget: 12000,
          adCampaignStartDate: '2026-09-01',
          adCampaignEndDate: '2026-10-01',
          adBudgetPaid: 12000,
          serviceFee: 20000,
          totalPackageValue: 32000,
          advancePaid: 20000,
          remainingBalance: 12000,
          paymentStatus: 'partially_paid',
          paymentHistory: [
            {
              id: 'pay_luxe_1',
              date: '2026-09-01',
              amount: 20000,
              type: 'advance',
              paymentMethod: 'UPI',
              notes: 'Upfront advance paid upon onboarding'
            }
          ],
          assignedExecutive: 'Sankalp',
          salesManager: 'Sankalp',
          incentivePercentage: 10,
          incentiveAmount: 2000,
          incentiveStatus: 'pending',
          notes: 'Premium modular kitchen & turnkey interior design leads.',
          remarks: 'Premium modular kitchen & turnkey interior design leads.',
          monthYear: '2026-09',
          createdAt: '2026-09-01T11:00:00.000Z',
          updatedAt: '2026-09-01T11:00:00.000Z'
        }
      ];
      saveDb();
    }

    // Auto-migrate clients to have a clientNumber if they don't already
    let clientsModified = false;
    db.clients.forEach((client, index) => {
      if (!client.clientNumber) {
        client.clientNumber = `CLI-${String(index + 1).padStart(3, '0')}`;
        clientsModified = true;
      }
    });
    if (clientsModified) saveDb();
    
  } catch (err) {
    console.error('Error loading database:', err);
    db = initialDb;
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

// Log audit helper
function addAuditLog(action: string, entityType: any, entityId: string, entityName: string, user = 'UDM Admin', details?: string) {
  const newLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    action,
    entityType,
    entityId,
    entityName,
    user,
    details: details || '',
    timestamp: new Date().toISOString()
  };
  db.auditLogs.unshift(newLog);
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
  saveDb();
  return newLog;
}

// Helper to compute and format sequential invoice number server-side
function getCalculatedNextSequence(): { prefix: string; nextSequence: number; padding: number; invoiceNumber: string } {
  const settings = db.invoiceSettings || { prefix: 'A', startingNumber: 345, numberPadding: 6, nextSequence: 348 };
  const prefix = settings.prefix || 'A';
  const padding = settings.numberPadding || 6;

  // Scan all existing invoices to find the highest number in this prefix series
  let maxFound = (settings.startingNumber || 345) - 1;
  if (settings.nextSequence && settings.nextSequence > maxFound) {
    maxFound = settings.nextSequence - 1;
  }

  const prefixRegex = new RegExp(`^${prefix}0*(\\d+)$`, 'i');

  if (Array.isArray(db.invoices)) {
    for (const inv of db.invoices) {
      if (inv.invoiceNumber) {
        const match = inv.invoiceNumber.trim().match(prefixRegex);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxFound) {
            maxFound = num;
          }
        }
      }
    }
  }

  const nextSeq = maxFound + 1;
  const paddedNum = nextSeq.toString().padStart(padding, '0');
  const invoiceNumber = `${prefix}${paddedNum}`;

  return { prefix, nextSequence: nextSeq, padding, invoiceNumber };
}

function generateNextInvoiceNumber(): string {
  const { invoiceNumber, nextSequence } = getCalculatedNextSequence();

  // Update sequence and persist
  db.invoiceSettings.nextSequence = nextSequence + 1;
  saveDb();

  return invoiceNumber;
}

// Helper to advance sequence if user provided a specific series number (e.g. A000348)
function advanceSequenceIfHigher(invNumber: string) {
  if (!invNumber) return;
  const prefix = db.invoiceSettings.prefix || 'A';
  const prefixRegex = new RegExp(`^${prefix}0*(\\d+)$`, 'i');
  const match = invNumber.trim().match(prefixRegex);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num >= (db.invoiceSettings.nextSequence || 345)) {
      db.invoiceSettings.nextSequence = num + 1;
      saveDb();
    }
  }
}

// Load initial database
loadDb();

// -------------------------------------------------------------
// API ROUTES
// -------------------------------------------------------------

// Auth
app.get('/api/auth/me', (req, res) => {
  res.json({ success: true, user: db.users[0] });
});

app.post('/api/auth/login', (req, res) => {
  const { email, username, password } = req.body;
  const rawIdentifier = (email || username || '').trim();
  const userIdentifier = rawIdentifier.toLowerCase();
  const rawPassword = (password || '').trim();

  const isValidUser =
    userIdentifier === 'sankalp123' ||
    userIdentifier === 'sankalpnayakk@gmail.com' ||
    userIdentifier === 'sankalp' ||
    userIdentifier === 'sankap123' ||
    userIdentifier === 'sankap' ||
    userIdentifier === 'admin';

  // Support exact password Sankalp@321 as well as case-insensitive / minor typo variants
  const isValidPassword =
    rawPassword === 'Sankalp@321' ||
    rawPassword === 'sankalp@321' ||
    rawPassword === 'SANKALP@321' ||
    rawPassword === 'sankap@321' ||
    rawPassword === 'Sankap@321' ||
    rawPassword === 'Sankalp123' ||
    rawPassword === 'sankalp123' ||
    rawPassword.toLowerCase() === 'sankalp@321' ||
    rawPassword.toLowerCase() === 'sankap@321';

  if (!isValidUser || !isValidPassword) {
    return res.status(401).json({
      success: false,
      message: 'Invalid username or password. Please use your authorized login credentials.'
    });
  }

  const user = {
    id: 'usr_sankalp',
    username: 'sankalp123',
    email: 'sankalpnayakk@gmail.com',
    name: 'Sankalp Nayak',
    role: 'Administrator'
  };

  addAuditLog('User Login Successful', 'auth', 'user', 'sankalp123');

  res.json({
    success: true,
    user,
    token: `udm-token-${Date.now()}`
  });
});

// Business Profile
app.get('/api/business-profile', (req, res) => {
  res.json({ success: true, data: db.businessProfile });
});

app.put('/api/business-profile', (req, res) => {
  db.businessProfile = { ...db.businessProfile, ...req.body };
  saveDb();
  addAuditLog('Updated Business Profile', 'settings', 'profile', db.businessProfile.businessName);
  res.json({ success: true, data: db.businessProfile });
});

// Settings (Invoice, Tax, Payment, PDF)
app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    data: {
      invoiceSettings: db.invoiceSettings,
      taxSettings: db.taxSettings,
      paymentSettings: db.paymentSettings,
      pdfSettings: db.pdfSettings
    }
  });
});

app.put('/api/settings', (req, res) => {
  const { invoiceSettings, taxSettings, paymentSettings, pdfSettings } = req.body;
  if (invoiceSettings) db.invoiceSettings = { ...db.invoiceSettings, ...invoiceSettings };
  if (taxSettings) db.taxSettings = { ...db.taxSettings, ...taxSettings };
  if (paymentSettings) db.paymentSettings = { ...db.paymentSettings, ...paymentSettings };
  if (pdfSettings) db.pdfSettings = { ...db.pdfSettings, ...pdfSettings };
  saveDb();
  addAuditLog('Updated Application Settings', 'settings', 'all', 'Settings');
  res.json({ success: true, message: 'Settings updated successfully' });
});

// Server-side Sequential Number Allocation
app.get('/api/invoices/next-number', (req, res) => {
  const { invoiceNumber, nextSequence } = getCalculatedNextSequence();
  res.json({ success: true, invoiceNumber, nextSequence });
});

// Helper: Calculate 30-day billing period
function calculateServerBillingPeriod(startDateStr?: string) {
  const cleanStart = startDateStr || new Date().toISOString().split('T')[0];
  const parts = cleanStart.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const end = new Date(parts[0], parts[1] - 1, parts[2] + 29); // 30 days inclusive

  const endYear = end.getFullYear();
  const endMonth = String(end.getMonth() + 1).padStart(2, '0');
  const endDay = String(end.getDate()).padStart(2, '0');
  const endDateStr = `${endYear}-${endMonth}-${endDay}`;

  const formatOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const formattedStart = start.toLocaleDateString('en-IN', formatOptions);
  const formattedEnd = end.toLocaleDateString('en-IN', formatOptions);

  return {
    billingStartDate: cleanStart,
    billingEndDate: endDateStr,
    billingPeriod: `${formattedStart} – ${formattedEnd} (30 Days)`
  };
}

// Helper: Hydrate invoice with latest client data from CRM to prevent stale data
function hydrateInvoiceClient(inv: any) {
  if (!inv) return inv;
  const client = db.clients.find(c => c.id === inv.clientId);
  if (client) {
    return {
      ...inv,
      client: {
        ...inv.client,
        ...client
      }
    };
  }
  return inv;
}

// Helper: Hydrate quote with latest client data
function hydrateQuoteClient(quote: any) {
  if (!quote) return quote;
  const client = db.clients.find(c => c.id === quote.clientId);
  if (client) {
    return {
      ...quote,
      client: {
        ...quote.client,
        ...client
      }
    };
  }
  return quote;
}

// Clients CRUD
app.get('/api/clients', (req, res) => {
  res.json({ success: true, data: db.clients });
});

app.get('/api/clients/:id', (req, res) => {
  const client = db.clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

  // Calculate client stats & invoice history
  const clientInvoices = db.invoices
    .filter(inv => inv.clientId === client.id)
    .map(hydrateInvoiceClient);
  const totalBilled = clientInvoices.reduce((sum, inv) => sum + (inv.status !== 'cancelled' ? inv.grandTotal : 0), 0);
  const totalPaid = clientInvoices.reduce((sum, inv) => sum + (inv.status !== 'cancelled' ? inv.amountPaid : 0), 0);
  const outstanding = totalBilled - totalPaid;
  const lastInvoice = clientInvoices.sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime())[0];

  res.json({
    success: true,
    data: {
      client,
      stats: {
        totalInvoices: clientInvoices.length,
        totalBilled,
        totalPaid,
        outstanding,
        lastInvoiceDate: lastInvoice ? lastInvoice.invoiceDate : null,
        lastInvoiceNumber: lastInvoice ? lastInvoice.invoiceNumber : null
      },
      invoices: clientInvoices
    }
  });
});

app.post('/api/clients', (req, res) => {
  const nextNumber = db.clients.length + 1;
  const newClient = {
    id: `client_${Date.now()}`,
    clientNumber: `CLI-${String(nextNumber).padStart(3, '0')}`,
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.clients.unshift(newClient);
  saveDb();
  addAuditLog('Client Created', 'client', newClient.id, newClient.name);
  res.status(201).json({ success: true, data: newClient });
});

app.put('/api/clients/:id', (req, res) => {
  const index = db.clients.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Client not found' });

  const updatedClient = {
    ...db.clients[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  db.clients[index] = updatedClient;

  // Real-time synchronization: Update client data everywhere it is used (invoices, quotes, recurring)
  db.invoices.forEach((inv, i) => {
    if (inv.clientId === req.params.id) {
      db.invoices[i] = {
        ...inv,
        client: { ...inv.client, ...updatedClient },
        updatedAt: new Date().toISOString()
      };
    }
  });

  db.quotes.forEach((q, i) => {
    if (q.clientId === req.params.id) {
      db.quotes[i] = {
        ...q,
        client: { ...q.client, ...updatedClient },
        updatedAt: new Date().toISOString()
      };
    }
  });

  db.recurringInvoices.forEach((r, i) => {
    if (r.clientId === req.params.id) {
      db.recurringInvoices[i] = {
        ...r,
        client: { ...r.client, ...updatedClient },
        clientName: updatedClient.name,
        updatedAt: new Date().toISOString()
      };
    }
  });

  saveDb();
  addAuditLog('Client Updated', 'client', db.clients[index].id, db.clients[index].name);
  res.json({ success: true, data: db.clients[index] });
});

app.delete('/api/clients/:id', (req, res) => {
  const index = db.clients.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Client not found' });
  const clientName = db.clients[index].name;
  db.clients.splice(index, 1);

  // Sync deletion note across all invoices for this client
  db.invoices.forEach((inv, i) => {
    if (inv.clientId === req.params.id) {
      db.invoices[i] = {
        ...inv,
        client: { ...inv.client, name: `${inv.client.name} (Archived/Deleted)` },
        updatedAt: new Date().toISOString()
      };
    }
  });

  saveDb();
  addAuditLog('Client Deleted', 'client', req.params.id, clientName);
  res.json({ success: true, message: 'Client deleted successfully' });
});

// Invoices CRUD
app.get('/api/invoices', (req, res) => {
  const hydrated = db.invoices.map(hydrateInvoiceClient);
  res.json({ success: true, data: hydrated });
});

app.get('/api/invoices/:id', (req, res) => {
  const invoice = db.invoices.find(inv => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
  res.json({ success: true, data: hydrateInvoiceClient(invoice) });
});

app.post('/api/invoices', (req, res) => {
  let invoiceData = req.body;
  
  // If invoice number is empty or placeholder, assign next atomic server sequential number
  if (!invoiceData.invoiceNumber || invoiceData.invoiceNumber === 'AUTO' || invoiceData.invoiceNumber.startsWith('DRAFT-')) {
    if (invoiceData.status !== 'draft') {
      invoiceData.invoiceNumber = generateNextInvoiceNumber();
    } else {
      invoiceData.invoiceNumber = invoiceData.invoiceNumber || `DRAFT-${Date.now().toString().slice(-4)}`;
    }
  } else {
    // A specific invoice number was provided (e.g. A000348 from next-number endpoint)
    advanceSequenceIfHigher(invoiceData.invoiceNumber);
  }

  // Automatic 30-day Billing Period Calculation
  const billingInfo = calculateServerBillingPeriod(invoiceData.billingStartDate || invoiceData.invoiceDate);
  invoiceData.billingStartDate = invoiceData.billingStartDate || billingInfo.billingStartDate;
  invoiceData.billingEndDate = invoiceData.billingEndDate || billingInfo.billingEndDate;
  invoiceData.billingPeriod = invoiceData.billingPeriod || billingInfo.billingPeriod;

  // Advance Payment & Balance Calculations
  const advance = Number(invoiceData.advanceAmount) || 0;
  const existingPayments = Array.isArray(invoiceData.payments) ? invoiceData.payments : [];
  const paymentsTotal = existingPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  const totalPaid = advance + paymentsTotal;
  const balanceDue = Math.max(0, (Number(invoiceData.grandTotal) || 0) - totalPaid);

  let calculatedStatus = invoiceData.status || 'draft';
  if (calculatedStatus !== 'draft' && calculatedStatus !== 'cancelled') {
    if (balanceDue <= 0.01 && totalPaid > 0) {
      calculatedStatus = 'paid';
    } else if (totalPaid > 0) {
      calculatedStatus = 'partially_paid';
    }
  }

  // Ensure latest client snapshot is captured or auto-create client in CRM if new
  if (invoiceData.clientId) {
    const latestClient = db.clients.find(c => c.id === invoiceData.clientId);
    if (latestClient) {
      invoiceData.client = { ...invoiceData.client, ...latestClient };
    } else if (invoiceData.client && invoiceData.client.name) {
      // Client ID was generated client-side or temporary; register in CRM
      const nextNum = db.clients.length + 1;
      const createdClient = {
        id: invoiceData.clientId,
        clientNumber: `CLI-${String(nextNum).padStart(3, '0')}`,
        name: invoiceData.client.name,
        contactPerson: invoiceData.client.contactPerson || '',
        email: invoiceData.client.email || '',
        phone: invoiceData.client.phone || '',
        billingAddress: invoiceData.client.billingAddress || '',
        shippingAddress: invoiceData.client.shippingAddress || invoiceData.client.billingAddress || '',
        city: invoiceData.client.city || '',
        state: invoiceData.client.state || invoiceData.placeOfSupply || 'Madhya Pradesh',
        stateCode: invoiceData.client.stateCode || invoiceData.placeOfSupplyCode || '23',
        country: invoiceData.client.country || 'India',
        pinCode: invoiceData.client.pinCode || '',
        gstin: invoiceData.client.gstin || '',
        pan: invoiceData.client.pan || '',
        customerType: invoiceData.client.customerType || 'B2B',
        notes: invoiceData.client.notes || '',
        createdAt: new Date().toISOString()
      };
      db.clients.unshift(createdClient);
      invoiceData.client = createdClient;
      addAuditLog('Client Created', 'client', createdClient.id, createdClient.name);
    }
  } else if (invoiceData.client && invoiceData.client.name) {
    // No clientId provided, check if client already exists by name
    const existingClient = db.clients.find(c => c.name.toLowerCase().trim() === invoiceData.client.name.toLowerCase().trim());
    if (existingClient) {
      invoiceData.clientId = existingClient.id;
      invoiceData.client = { ...invoiceData.client, ...existingClient };
    } else {
      const nextNum = db.clients.length + 1;
      const newClientId = `client_${Date.now()}`;
      const createdClient = {
        id: newClientId,
        clientNumber: `CLI-${String(nextNum).padStart(3, '0')}`,
        name: invoiceData.client.name,
        contactPerson: invoiceData.client.contactPerson || '',
        email: invoiceData.client.email || '',
        phone: invoiceData.client.phone || '',
        billingAddress: invoiceData.client.billingAddress || '',
        shippingAddress: invoiceData.client.shippingAddress || invoiceData.client.billingAddress || '',
        city: invoiceData.client.city || '',
        state: invoiceData.client.state || invoiceData.placeOfSupply || 'Madhya Pradesh',
        stateCode: invoiceData.client.stateCode || invoiceData.placeOfSupplyCode || '23',
        country: invoiceData.client.country || 'India',
        pinCode: invoiceData.client.pinCode || '',
        gstin: invoiceData.client.gstin || '',
        pan: invoiceData.client.pan || '',
        customerType: invoiceData.client.customerType || 'B2B',
        notes: invoiceData.client.notes || '',
        createdAt: new Date().toISOString()
      };
      db.clients.unshift(createdClient);
      invoiceData.clientId = createdClient.id;
      invoiceData.client = createdClient;
      addAuditLog('Client Created', 'client', createdClient.id, createdClient.name);
    }
  }

  const newInvoice = {
    id: `inv_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payments: existingPayments,
    advanceAmount: advance,
    amountPaid: totalPaid,
    balanceDue,
    ...invoiceData,
    status: calculatedStatus
  };

  db.invoices.unshift(newInvoice);
  saveDb();

  addAuditLog(
    newInvoice.status === 'draft' ? 'Draft Invoice Created' : 'Invoice Created & Finalized',
    'invoice',
    newInvoice.id,
    `${newInvoice.invoiceNumber} (${newInvoice.client?.name || 'Client'})`,
    'UDM Admin',
    `Total: ₹${newInvoice.grandTotal} | Advance: ₹${advance} | Bal: ₹${balanceDue}`
  );

  res.status(201).json({ success: true, data: hydrateInvoiceClient(newInvoice) });
});

app.put('/api/invoices/:id', (req, res) => {
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const existing = db.invoices[index];
  let updateData = { ...req.body };

  // If transitioning from draft to finalized, generate official invoice number if it had a draft number
  if (existing.status === 'draft' && updateData.status !== 'draft' && (!updateData.invoiceNumber || updateData.invoiceNumber.startsWith('DRAFT-'))) {
    updateData.invoiceNumber = generateNextInvoiceNumber();
  } else if (updateData.invoiceNumber) {
    advanceSequenceIfHigher(updateData.invoiceNumber);
  }

  // Auto 30-day billing calculation if start date provided or modified
  if (updateData.billingStartDate || updateData.invoiceDate) {
    const billingInfo = calculateServerBillingPeriod(updateData.billingStartDate || updateData.invoiceDate);
    updateData.billingStartDate = updateData.billingStartDate || billingInfo.billingStartDate;
    updateData.billingEndDate = billingInfo.billingEndDate;
    updateData.billingPeriod = billingInfo.billingPeriod;
  }

  // Advance Payment & Balance Calculations
  const advance = updateData.advanceAmount !== undefined ? Number(updateData.advanceAmount) || 0 : (existing.advanceAmount || 0);
  const currentPayments = Array.isArray(updateData.payments) ? updateData.payments : (existing.payments || []);
  const paymentsTotal = currentPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  const totalPaid = advance + paymentsTotal;
  const grandTotal = updateData.grandTotal !== undefined ? Number(updateData.grandTotal) : existing.grandTotal;
  const balanceDue = Math.max(0, grandTotal - totalPaid);

  let calculatedStatus = updateData.status || existing.status;
  if (calculatedStatus !== 'draft' && calculatedStatus !== 'cancelled') {
    if (balanceDue <= 0.01 && totalPaid > 0) {
      calculatedStatus = 'paid';
    } else if (totalPaid > 0) {
      calculatedStatus = 'partially_paid';
    }
  }

  // Ensure latest client data from CRM is attached
  const clientId = updateData.clientId || existing.clientId;
  if (clientId) {
    const latestClient = db.clients.find(c => c.id === clientId);
    if (latestClient) {
      updateData.client = { ...(existing.client || {}), ...(updateData.client || {}), ...latestClient };
    }
  }

  db.invoices[index] = {
    ...existing,
    ...updateData,
    advanceAmount: advance,
    amountPaid: totalPaid,
    balanceDue,
    status: calculatedStatus,
    updatedAt: new Date().toISOString()
  };
  saveDb();

  addAuditLog('Invoice Updated', 'invoice', db.invoices[index].id, db.invoices[index].invoiceNumber);
  res.json({ success: true, data: hydrateInvoiceClient(db.invoices[index]) });
});

app.delete('/api/invoices/:id', (req, res) => {
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Invoice not found' });
  const inv = db.invoices[index];
  db.invoices.splice(index, 1);
  saveDb();
  addAuditLog('Invoice Deleted', 'invoice', inv.id, inv.invoiceNumber);
  res.json({ success: true, message: 'Invoice deleted successfully' });
});

// Record Payment on Invoice
app.post('/api/invoices/:id/payments', (req, res) => {
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const invoice = db.invoices[index];
  const { amount, paymentDate, paymentMethod, transactionId, notes } = req.body;

  const paymentAmount = Number(amount) || 0;
  const newPayment = {
    id: `pay_${Date.now()}`,
    invoiceId: invoice.id,
    amount: paymentAmount,
    paymentDate: paymentDate || new Date().toISOString().split('T')[0],
    paymentMethod: paymentMethod || 'Bank Transfer',
    transactionId: transactionId || '',
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  const payments = [...(invoice.payments || []), newPayment];
  const advance = Number(invoice.advanceAmount) || 0;
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalPaid = advance + paymentsTotal;
  const balanceDue = Math.max(0, invoice.grandTotal - totalPaid);

  let status = invoice.status;
  if (balanceDue <= 0.01) {
    status = 'paid';
  } else if (totalPaid > 0) {
    status = 'partially_paid';
  }

  db.invoices[index] = {
    ...invoice,
    payments,
    amountPaid: totalPaid,
    balanceDue,
    status,
    updatedAt: new Date().toISOString()
  };
  saveDb();

  addAuditLog(
    'Payment Recorded',
    'payment',
    invoice.id,
    invoice.invoiceNumber,
    'UDM Admin',
    `Recorded ₹${paymentAmount} via ${paymentMethod} (Bal: ₹${balanceDue})`
  );

  res.json({ success: true, data: hydrateInvoiceClient(db.invoices[index]), payment: newPayment });
});

// Duplicate Invoice
app.post('/api/invoices/:id/duplicate', (req, res) => {
  const original = db.invoices.find(inv => inv.id === req.params.id);
  if (!original) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const nextNumber = generateNextInvoiceNumber();
  const today = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];

  const duplicated = {
    ...original,
    id: `inv_${Date.now()}`,
    invoiceNumber: nextNumber,
    invoiceDate: today,
    dueDate,
    status: 'draft' as const,
    payments: [],
    amountPaid: 0,
    balanceDue: original.grandTotal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.invoices.unshift(duplicated);
  saveDb();

  addAuditLog('Invoice Duplicated', 'invoice', duplicated.id, `${duplicated.invoiceNumber} (from ${original.invoiceNumber})`);
  res.status(201).json({ success: true, data: duplicated });
});

// Cancel Invoice
app.post('/api/invoices/:id/cancel', (req, res) => {
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Invoice not found' });

  db.invoices[index].status = 'cancelled';
  db.invoices[index].updatedAt = new Date().toISOString();
  saveDb();

  addAuditLog('Invoice Cancelled', 'invoice', db.invoices[index].id, db.invoices[index].invoiceNumber);
  res.json({ success: true, data: db.invoices[index] });
});

// Send Invoice Email Simulation
app.post('/api/invoices/:id/send-email', (req, res) => {
  const { to, cc, subject, message } = req.body;
  const invoice = db.invoices.find(inv => inv.id === req.params.id);
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  if (invoice.status === 'draft') {
    invoice.status = 'sent';
    saveDb();
  }

  addAuditLog(
    'Invoice Sent by Email',
    'invoice',
    invoice.id,
    invoice.invoiceNumber,
    'UDM Admin',
    `Sent to ${to}`
  );

  res.json({
    success: true,
    message: `Invoice ${invoice.invoiceNumber} successfully queued for delivery to ${to}`
  });
});

// Quotes / Estimates CRUD
app.get('/api/quotes', (req, res) => {
  res.json({ success: true, data: db.quotes });
});

app.post('/api/quotes', (req, res) => {
  const newQuote = {
    id: `quote_${Date.now()}`,
    quoteNumber: req.body.quoteNumber || `Q000${db.quotes.length + 101}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...req.body
  };
  db.quotes.unshift(newQuote);
  saveDb();
  addAuditLog('Quote Created', 'quote', newQuote.id, newQuote.quoteNumber);
  res.status(201).json({ success: true, data: newQuote });
});

app.put('/api/quotes/:id', (req, res) => {
  const index = db.quotes.findIndex(q => q.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Quote not found' });
  db.quotes[index] = { ...db.quotes[index], ...req.body, updatedAt: new Date().toISOString() };
  saveDb();
  addAuditLog('Quote Updated', 'quote', db.quotes[index].id, db.quotes[index].quoteNumber);
  res.json({ success: true, data: db.quotes[index] });
});

app.delete('/api/quotes/:id', (req, res) => {
  const index = db.quotes.findIndex(q => q.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Quote not found' });
  const quoteNumber = db.quotes[index].quoteNumber;
  db.quotes.splice(index, 1);
  saveDb();
  addAuditLog('Quote Deleted', 'quote', req.params.id, quoteNumber);
  res.json({ success: true, message: 'Quote deleted' });
});

// Convert Quote to Invoice
app.post('/api/quotes/:id/convert-to-invoice', (req, res) => {
  const quote = db.quotes.find(q => q.id === req.params.id);
  if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });

  const nextNumber = generateNextInvoiceNumber();
  const today = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];

  const newInvoice: any = {
    id: `inv_${Date.now()}`,
    invoiceNumber: nextNumber,
    poNumber: `CONV-${quote.quoteNumber}`,
    invoiceDate: today,
    dueDate,
    placeOfSupply: quote.placeOfSupply,
    placeOfSupplyCode: quote.placeOfSupplyCode,
    currency: quote.currency || 'INR',
    financialYear: quote.financialYear || 'FY 2026-27',
    isInterState: quote.isInterState,
    status: 'draft' as const,
    template: quote.template || 'classic',
    seller: quote.seller || db.businessProfile,
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
    terms: quote.terms || db.invoiceSettings.defaultPaymentTerms,
    customerNotes: quote.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  (db.invoices as any).unshift(newInvoice);

  // Update quote status
  quote.status = 'converted';
  (quote as any).convertedToInvoiceId = newInvoice.id;
  (quote as any).convertedToInvoiceNumber = newInvoice.invoiceNumber;
  saveDb();

  addAuditLog('Quote Converted to Invoice', 'invoice', newInvoice.id, `${newInvoice.invoiceNumber} (from ${quote.quoteNumber})`);
  res.json({ success: true, invoice: newInvoice });
});

// Credit Notes CRUD
app.get('/api/credit-notes', (req, res) => {
  res.json({ success: true, data: db.creditNotes });
});

app.post('/api/credit-notes', (req, res) => {
  const newCreditNote = {
    id: `cn_${Date.now()}`,
    creditNoteNumber: req.body.creditNoteNumber || `CN-00${db.creditNotes.length + 1}`,
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.creditNotes.unshift(newCreditNote);
  saveDb();
  addAuditLog('Credit Note Issued', 'credit_note', newCreditNote.id, newCreditNote.creditNoteNumber);
  res.status(201).json({ success: true, data: newCreditNote });
});

app.delete('/api/credit-notes/:id', (req, res) => {
  const index = db.creditNotes.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Credit note not found' });
  const cn = db.creditNotes[index];
  db.creditNotes.splice(index, 1);
  saveDb();
  addAuditLog('Credit Note Deleted', 'credit_note', cn.id, cn.creditNoteNumber);
  res.json({ success: true, message: 'Credit note deleted' });
});

// Recurring Invoices CRUD
app.get('/api/recurring-invoices', (req, res) => {
  res.json({ success: true, data: db.recurringInvoices });
});

app.post('/api/recurring-invoices', (req, res) => {
  const newRec = {
    id: `rec_${Date.now()}`,
    recurringNumber: req.body.recurringNumber || `REC-00${db.recurringInvoices.length + 1}`,
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.recurringInvoices.unshift(newRec);
  saveDb();
  addAuditLog('Recurring Schedule Created', 'invoice', newRec.id, newRec.recurringNumber);
  res.status(201).json({ success: true, data: newRec });
});

app.put('/api/recurring-invoices/:id', (req, res) => {
  const index = db.recurringInvoices.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
  db.recurringInvoices[index] = { ...db.recurringInvoices[index], ...req.body };
  saveDb();
  res.json({ success: true, data: db.recurringInvoices[index] });
});

app.delete('/api/recurring-invoices/:id', (req, res) => {
  const index = db.recurringInvoices.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Recurring schedule not found' });
  db.recurringInvoices.splice(index, 1);
  saveDb();
  res.json({ success: true, message: 'Recurring schedule deleted' });
});

// Trigger next recurring draft invoice
app.post('/api/recurring-invoices/:id/trigger', (req, res) => {
  const rec = db.recurringInvoices.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ success: false, message: 'Recurring schedule not found' });

  const client = db.clients.find(c => c.id === rec.clientId) || {
    id: rec.clientId,
    name: rec.clientName,
    state: 'Maharashtra',
    stateCode: '27',
    gstin: '27BDSPJ2691A1ZG',
    pan: 'BDSPJ2691A',
    billingAddress: '',
    city: 'Pune',
    country: 'India',
    pinCode: '411017',
    contactPerson: '',
    email: '',
    phone: '',
    customerType: 'B2B' as const,
    createdAt: ''
  };

  const nextNumber = generateNextInvoiceNumber();
  const today = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];

  const subtotal = rec.items.reduce((s, i) => s + (i.rate * i.quantity), 0);
  const isInterState = client.stateCode !== db.businessProfile.stateCode;

  // Calculate GST per item based on actual HSN/SAC rates (not hardcoded 18%)
  let totalCgst = 0, totalSgst = 0, totalIgst = 0;
  rec.items.forEach(item => {
    const gstRate = Number(item.gstRate) || 18;
    const itemTaxable = (item.rate || 0) * (item.quantity || 0);
    const itemDiscount = item.discountAmount || 0;
    const itemTaxableAmount = Math.max(0, itemTaxable - itemDiscount);
    const itemGst = (itemTaxableAmount * gstRate) / 100;

    if (isInterState) {
      totalIgst += itemGst;
    } else {
      totalCgst += itemGst / 2;
      totalSgst += itemGst / 2;
    }
  });

  const totalTaxableAmount = subtotal;
  const totalGst = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;
  const grandTotal = Math.round((totalTaxableAmount + totalGst) * 100) / 100;

  const newInvoice: any = {
    id: `inv_${Date.now()}`,
    invoiceNumber: nextNumber,
    poNumber: `REC-${rec.recurringNumber}`,
    invoiceDate: today,
    dueDate,
    placeOfSupply: client.state,
    placeOfSupplyCode: client.stateCode,
    currency: 'INR',
    financialYear: 'FY 2026-27',
    isInterState,
    status: 'draft' as const,
    template: 'classic' as const,
    seller: db.businessProfile,
    clientId: client.id,
    client,
    items: rec.items,
    discountType: 'percentage' as const,
    discountValue: 0,
    discountAmount: 0,
    additionalCharges: [],
    subtotal,
    totalItemDiscount: 0,
    totalTaxableAmount: totalTaxableAmount,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalGst: totalGst,
    totalAdditionalCharges: 0,
    roundOff: Math.round((grandTotal - totalTaxableAmount - totalGst) * 100) / 100,
    grandTotal,
    totalInWords: 'Recurring Invoice Amount',
    amountPaid: 0,
    balanceDue: grandTotal,
    payments: [],
    showBankDetails: true,
    showUpiQr: true,
    terms: rec.terms || db.invoiceSettings.defaultPaymentTerms,
    customerNotes: 'Automated recurring billing invoice.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  (db.invoices as any).unshift(newInvoice);
  (rec as any).lastGeneratedInvoiceId = newInvoice.id;
  saveDb();

  addAuditLog('Recurring Invoice Draft Generated', 'invoice', newInvoice.id, newInvoice.invoiceNumber);
  res.json({ success: true, invoice: newInvoice });
});

// Expenses CRUD
app.get('/api/expenses', (req, res) => {
  res.json({ success: true, data: db.expenses });
});

app.post('/api/expenses', (req, res) => {
  const newExp = {
    id: `exp_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.expenses.unshift(newExp);
  saveDb();
  addAuditLog('Expense Added', 'expense', newExp.id, `${newExp.category}: ₹${newExp.totalAmount}`);
  res.status(201).json({ success: true, data: newExp });
});

app.delete('/api/expenses/:id', (req, res) => {
  const index = db.expenses.findIndex(e => e.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Expense not found' });
  const exp = db.expenses[index];
  db.expenses.splice(index, 1);
  saveDb();
  addAuditLog('Expense Deleted', 'expense', exp.id, exp.category);
  res.json({ success: true, message: 'Expense deleted' });
});

// -------------------------------------------------------------
// CLIENT ONBOARDING & MONTHLY RETAINER LIFECYCLE CRUD
// -------------------------------------------------------------

// Helper to compute live status & dates for an onboarding record
function processOnboardingRecord(onb: any) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Management Fee & Ad Budget breakdowns
  const mgmtFee = onb.managementFee !== undefined ? Number(onb.managementFee) : (Number(onb.serviceFee) || 0);
  const adBudgetVal = onb.adBudget !== undefined ? Number(onb.adBudget) : (Number(onb.adTotalBudget) || 0);
  const totalDealVal = onb.totalDealValue !== undefined ? Number(onb.totalDealValue) : (mgmtFee + adBudgetVal);
  
  const mgmtReceived = onb.managementFeePaid !== undefined ? Number(onb.managementFeePaid) : 0;
  const adReceived = onb.adBudgetPaid !== undefined ? Number(onb.adBudgetPaid) : 0;
  const totalRec = onb.advancePaid !== undefined ? Number(onb.advancePaid) : (mgmtReceived + adReceived);
  const totalDueVal = Math.max(0, totalDealVal - totalRec);

  // Billing & Payment Overdue Calculations (default 30 days billing cycle)
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

  // Meta & Google Ads Budget Expiry Calculations
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
    salesManager: onb.salesManager || onb.assignedExecutive || 'Mahendra',
    assignedExecutive: onb.salesManager || onb.assignedExecutive || 'Mahendra',
    remarks: onb.remarks || onb.notes || '',
    notes: onb.remarks || onb.notes || '',
    nextPaymentDueDate: nextDueDate,
    isPaymentOverdue,
    daysUntilPaymentDue,
    isAdExpired,
    daysUntilAdExpiry
  };
}

// Get all Onboardings (with optional month/status filter)
app.get('/api/onboardings', (req, res) => {
  const { month, status, search } = req.query;
  let list = db.onboardings || [];

  if (month && month !== 'all') {
    list = list.filter(o => o.monthYear === month || (o.onboardingDate && o.onboardingDate.startsWith(month as string)));
  }

  if (status && status !== 'all') {
    list = list.filter(o => o.status === status);
  }

  if (search) {
    const q = (search as string).toLowerCase();
    list = list.filter(o =>
      (o.customerName && o.customerName.toLowerCase().includes(q)) ||
      (o.businessName && o.businessName.toLowerCase().includes(q)) ||
      (o.phone && o.phone.includes(q)) ||
      (o.onboardingNumber && o.onboardingNumber.toLowerCase().includes(q))
    );
  }

  const processedList = list.map(processOnboardingRecord);
  res.json({ success: true, data: processedList });
});

// Get Month-wise Analytics & Sales Summary
app.get('/api/onboardings/analytics/month-wise', (req, res) => {
  const list = (db.onboardings || []).map(processOnboardingRecord);

  // Group by Month (e.g. 2026-09, 2026-08, 2026-07)
  const monthMap: { [month: string]: any } = {};

  list.forEach(item => {
    const month = item.monthYear || (item.onboardingDate ? item.onboardingDate.slice(0, 7) : '2026-09');
    if (!monthMap[month]) {
      monthMap[month] = {
        month,
        totalClients: 0,
        activeClients: 0,
        totalSales: 0, // Total deal value
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

  // Overall Totals
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
});

// Get Single Onboarding
app.get('/api/onboardings/:id', (req, res) => {
  const item = (db.onboardings || []).find(o => o.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const processed = processOnboardingRecord(item);
  res.json({ success: true, data: processed });
});

// Create Onboarding
app.post('/api/onboardings', (req, res) => {
  const body = req.body;
  const count = (db.onboardings || []).length + 1;
  const seqNum = String(count).padStart(3, '0');
  const onboardingNumber = body.onboardingNumber || `ONB-${seqNum}`;

  const onboardingDate = body.onboardingDate || new Date().toISOString().split('T')[0];
  const billingCycleDays = body.billingCycleDays || 30;

  // Compute Next Payment Due Date = Onboarding Date + billingCycleDays
  let nextPaymentDueDate = body.nextPaymentDueDate;
  if (!nextPaymentDueDate) {
    const obDate = new Date(onboardingDate);
    const dueDateObj = new Date(obDate.getTime() + billingCycleDays * 24 * 60 * 60 * 1000);
    nextPaymentDueDate = dueDateObj.toISOString().split('T')[0];
  }

  // Calculate ad campaign dates if provided
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

  // Sales Incentive
  const incentivePercentage = Number(body.incentivePercentage) || 10;
  const incentiveAmount = body.incentiveAmount !== undefined
    ? Number(body.incentiveAmount)
    : Math.round((serviceFee * incentivePercentage) / 100);

  const monthYear = onboardingDate.slice(0, 7);

  const newOnboarding = {
    id: `onb_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    onboardingNumber,
    clientId: body.clientId || null,
    customerName: body.customerName || 'Client Name',
    businessName: body.businessName || body.customerName || 'Business Name',
    contactPerson: body.contactPerson || '',
    email: body.email || '',
    phone: body.phone || '',
    city: body.city || 'Indore',
    state: body.state || 'Madhya Pradesh',
    status: body.status || 'active',
    onboardingDate,
    billingCycleDays,
    nextPaymentDueDate,
    lastRenewalDate: onboardingDate,
    servicePackage: body.servicePackage || 'Meta Ads & Lead Gen Retainer',
    hasAdsCampaign,
    adPlatform: body.adPlatform || 'meta',
    adDailyBudget,
    adDurationDays,
    adTotalBudget,
    adCampaignStartDate,
    adCampaignEndDate,
    adBudgetPaid: Number(body.adBudgetPaid) || (hasAdsCampaign ? adTotalBudget : 0),
    serviceFee,
    totalPackageValue,
    advancePaid,
    remainingBalance,
    paymentStatus,
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
    assignedExecutive: body.salesManager || body.assignedExecutive || 'Sankalp',
    salesManager: body.salesManager || body.assignedExecutive || 'Sankalp',
    incentivePercentage,
    incentiveAmount,
    incentiveStatus: body.incentiveStatus || 'pending',
    notes: body.remarks || body.notes || '',
    remarks: body.remarks || body.notes || '',
    monthYear,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.onboardings.unshift(newOnboarding);
  saveDb();

  addAuditLog('Customer Onboarded', 'onboarding', newOnboarding.id, `${newOnboarding.businessName} (₹${newOnboarding.totalPackageValue})`);
  res.status(201).json({ success: true, data: processOnboardingRecord(newOnboarding) });
});

// Update Onboarding
app.put('/api/onboardings/:id', (req, res) => {
  const index = (db.onboardings || []).findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const existing = db.onboardings[index];
  const updated = {
    ...existing,
    ...req.body,
    updatedAt: new Date().toISOString()
  };

  // Recalculate remaining balance
  if (req.body.serviceFee !== undefined || req.body.adTotalBudget !== undefined || req.body.advancePaid !== undefined) {
    const sFee = Number(updated.serviceFee) || 0;
    const adBudget = updated.hasAdsCampaign ? (Number(updated.adTotalBudget) || 0) : 0;
    updated.totalPackageValue = sFee + adBudget;
    
    // Total payments recorded
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

  db.onboardings[index] = updated;
  saveDb();

  addAuditLog('Customer Onboarding Updated', 'onboarding', updated.id, updated.businessName);
  res.json({ success: true, data: processOnboardingRecord(updated) });
});

// Delete Onboarding
app.delete('/api/onboardings/:id', (req, res) => {
  const index = (db.onboardings || []).findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const item = db.onboardings[index];
  db.onboardings.splice(index, 1);
  saveDb();

  addAuditLog('Customer Onboarding Removed', 'onboarding', item.id, item.businessName);
  res.json({ success: true, message: 'Onboarding record removed' });
});

// Renew 30-Day Billing Cycle
app.post('/api/onboardings/:id/renew-cycle', (req, res) => {
  const index = (db.onboardings || []).findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const item = db.onboardings[index];
  const todayStr = new Date().toISOString().split('T')[0];
  const cycleDays = item.billingCycleDays || 30;

  // Current due date or today + 30 days
  const baseDate = new Date();
  const nextDueDateObj = new Date(baseDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);
  const nextPaymentDueDate = nextDueDateObj.toISOString().split('T')[0];

  item.lastRenewalDate = todayStr;
  item.nextPaymentDueDate = nextPaymentDueDate;
  item.status = 'active';
  item.updatedAt = new Date().toISOString();

  // If new cycle also renews service fee balance
  if (req.body.resetBalance) {
    item.remainingBalance = item.serviceFee + (item.hasAdsCampaign ? item.adTotalBudget : 0);
    item.paymentStatus = 'unpaid';
  }

  db.onboardings[index] = item;
  saveDb();

  addAuditLog('Billing Cycle Renewed (30 Days)', 'onboarding', item.id, `${item.businessName} next due on ${nextPaymentDueDate}`);
  res.json({ success: true, data: processOnboardingRecord(item) });
});

// Record Payment (Advance / Balance / Ad topup)
app.post('/api/onboardings/:id/record-payment', (req, res) => {
  const index = (db.onboardings || []).findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const item = db.onboardings[index];
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

  // Recalculate advance vs balance
  const totalPaid = item.paymentHistory.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  item.remainingBalance = Math.max(0, item.totalPackageValue - totalPaid);

  if (item.remainingBalance === 0) {
    item.paymentStatus = 'paid';
    item.incentiveStatus = 'eligible';
  } else {
    item.paymentStatus = 'partially_paid';
  }

  item.updatedAt = new Date().toISOString();
  db.onboardings[index] = item;
  saveDb();

  addAuditLog('Payment Recorded for Onboarded Client', 'onboarding', item.id, `₹${payAmount} received for ${item.businessName}`);
  res.json({ success: true, data: processOnboardingRecord(item) });
});

// Top-up / Extend Ad Budget
app.post('/api/onboardings/:id/topup-ads', (req, res) => {
  const index = (db.onboardings || []).findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Onboarding record not found' });

  const item = db.onboardings[index];
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

  db.onboardings[index] = item;
  saveDb();

  addAuditLog('Ad Campaign Budget Top-up', 'onboarding', item.id, `₹${addedBudget} added for ${item.businessName} (${days} days)`);
  res.json({ success: true, data: processOnboardingRecord(item) });
});

// Audit Logs
app.get('/api/audit-logs', (req, res) => {
  res.json({ success: true, data: db.auditLogs });
});

// Reports Data
app.get('/api/reports', (req, res) => {
  const { type, financialYear, month, clientId } = req.query;

  let filteredInvoices = db.invoices.filter(inv => inv.status !== 'cancelled');

  if (financialYear && financialYear !== 'All') {
    filteredInvoices = filteredInvoices.filter(inv => inv.financialYear === financialYear);
  }
  if (month && month !== 'All') {
    filteredInvoices = filteredInvoices.filter(inv => inv.invoiceDate.startsWith(month as string));
  }
  if (clientId && clientId !== 'All') {
    filteredInvoices = filteredInvoices.filter(inv => inv.clientId === clientId);
  }

  // Summary Metrics
  const totalSales = filteredInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalTaxable = filteredInvoices.reduce((sum, inv) => sum + inv.totalTaxableAmount, 0);
  const totalCgst = filteredInvoices.reduce((sum, inv) => sum + inv.totalCgst, 0);
  const totalSgst = filteredInvoices.reduce((sum, inv) => sum + inv.totalSgst, 0);
  const totalIgst = filteredInvoices.reduce((sum, inv) => sum + inv.totalIgst, 0);
  const totalGst = totalCgst + totalSgst + totalIgst;
  const totalPaid = filteredInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
  const totalOutstanding = filteredInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0);

  // All Payments List
  const allPayments = filteredInvoices.flatMap(inv => 
    (inv.payments || []).map(p => ({
      ...p,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client?.name || 'Unknown Client',
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
      expenses: db.expenses
    }
  });
});

// Dashboard Analytics Endpoint
app.get('/api/dashboard/stats', (req, res) => {
  const activeInvoices = db.invoices.filter(inv => inv.status !== 'cancelled');

  const draftCount = db.invoices.filter(inv => inv.status === 'draft').length;
  const sentCount = db.invoices.filter(inv => inv.status === 'sent').length;
  const paidCount = db.invoices.filter(inv => inv.status === 'paid').length;
  const partiallyPaidCount = db.invoices.filter(inv => inv.status === 'partially_paid').length;
  
  // Overdue check
  const now = new Date();
  const overdueCount = activeInvoices.filter(inv => {
    if (inv.status === 'paid' || inv.status === 'draft') return false;
    return new Date(inv.dueDate) < now && inv.balanceDue > 0;
  }).length;

  const totalSales = activeInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalGstCollected = activeInvoices.reduce((sum, inv) => sum + inv.totalGst, 0);
  const outstandingAmount = activeInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0);

  // Current month
  const currentMonthPrefix = now.toISOString().slice(0, 7); // e.g. 2026-08
  const thisMonthInvoices = activeInvoices.filter(inv => inv.invoiceDate.startsWith(currentMonthPrefix));
  const thisMonthRevenue = thisMonthInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const thisMonthGst = thisMonthInvoices.reduce((sum, inv) => sum + inv.totalGst, 0);

  // Last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const last30DaysInvoices = activeInvoices.filter(inv => new Date(inv.invoiceDate) >= thirtyDaysAgo);
  const last30DaysRevenue = last30DaysInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);

  // Revenue chart data (Daily, Weekly, Monthly, Yearly)
  const monthlyChart = [
    { name: 'Apr', revenue: 45000, gst: 8100 },
    { name: 'May', revenue: 62000, gst: 11160 },
    { name: 'Jun', revenue: 58000, gst: 10440 },
    { name: 'Jul', revenue: 75000, gst: 13500 },
    { name: 'Aug', revenue: thisMonthRevenue || 84960, gst: thisMonthGst || 12960 },
    { name: 'Sep', revenue: 0, gst: 0 },
    { name: 'Oct', revenue: 0, gst: 0 },
    { name: 'Nov', revenue: 0, gst: 0 },
    { name: 'Dec', revenue: 0, gst: 0 },
    { name: 'Jan', revenue: 0, gst: 0 },
    { name: 'Feb', revenue: 0, gst: 0 },
    { name: 'Mar', revenue: 0, gst: 0 }
  ];

  const weeklyChart = [
    { name: 'Week 1', revenue: 15000, gst: 2700 },
    { name: 'Week 2', revenue: 22000, gst: 3960 },
    { name: 'Week 3', revenue: 35400, gst: 5400 },
    { name: 'Week 4', revenue: 12560, gst: 900 }
  ];

  const dailyChart = [
    { name: 'Mon', revenue: 5900, gst: 900 },
    { name: 'Tue', revenue: 0, gst: 0 },
    { name: 'Wed', revenue: 29500, gst: 4500 },
    { name: 'Thu', revenue: 0, gst: 0 },
    { name: 'Fri', revenue: 49560, gst: 7560 },
    { name: 'Sat', revenue: 0, gst: 0 },
    { name: 'Sun', revenue: 0, gst: 0 }
  ];

  const yearlyChart = [
    { name: 'FY 2024-25', revenue: 420000, gst: 75600 },
    { name: 'FY 2025-26', revenue: 680000, gst: 122400 },
    { name: 'FY 2026-27', revenue: totalSales || 180000, gst: totalGstCollected || 32400 }
  ];

  const totalExpenses = db.expenses.reduce((sum, e) => sum + e.totalAmount, 0);

  res.json({
    success: true,
    data: {
      metrics: {
        totalInvoices: db.invoices.length,
        draftInvoices: draftCount,
        sentInvoices: sentCount,
        paidInvoices: paidCount,
        partiallyPaid: partiallyPaidCount,
        overdueInvoices: overdueCount,
        totalSales,
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
      recentInvoices: db.invoices.slice(0, 7)
    }
  });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & STATIC SERVING
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`GST Billing CRM Server running at http://${HOST}:${PORT}`);
  });
}

startServer();
