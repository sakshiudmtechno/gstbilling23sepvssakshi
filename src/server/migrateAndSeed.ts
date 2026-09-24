import fs from 'fs';
import path from 'path';
import { setDoc, getDoc, batchSet, countDocs } from './firestoreClient.ts';
import { calculateInvoiceTotals, round2 } from '../utils/taxCalculator.ts';

export async function runMigration(): Promise<{ migrated: Record<string, number>; message: string }> {
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.log('data/db.json not found, skipping local migration.');
    return { migrated: {}, message: 'data/db.json not found, skipped.' };
  }

  const raw = fs.readFileSync(dbPath, 'utf-8');
  const db = JSON.parse(raw);
  const counts: Record<string, number> = {};

  console.log('Starting migration from data/db.json to Firestore...');

  // 1. Settings
  if (db.businessProfile) {
    await setDoc('settings', 'businessProfile', db.businessProfile, true);
    counts['settings.businessProfile'] = 1;
  }
  if (db.invoiceSettings) {
    await setDoc('settings', 'invoiceSettings', db.invoiceSettings, true);
    counts['settings.invoiceSettings'] = 1;
  }
  if (db.taxSettings) {
    await setDoc('settings', 'taxSettings', db.taxSettings, true);
    counts['settings.taxSettings'] = 1;
  }
  if (db.paymentSettings) {
    await setDoc('settings', 'paymentSettings', db.paymentSettings, true);
    counts['settings.paymentSettings'] = 1;
  }
  if (db.pdfSettings) {
    await setDoc('settings', 'pdfSettings', db.pdfSettings, true);
    counts['settings.pdfSettings'] = 1;
  }

  // 2. Users
  if (Array.isArray(db.users) && db.users.length > 0) {
    await batchSet('users', db.users.map((u: any) => ({ id: u.id, data: u })));
    counts['users'] = db.users.length;
  }

  // 3. Clients
  if (Array.isArray(db.clients) && db.clients.length > 0) {
    await batchSet('clients', db.clients.map((c: any) => ({ id: c.id, data: c })));
    counts['clients'] = db.clients.length;
  }

  // 4. Invoices
  if (Array.isArray(db.invoices) && db.invoices.length > 0) {
    await batchSet('invoices', db.invoices.map((i: any) => ({ id: i.id, data: i })));
    counts['invoices'] = db.invoices.length;
  }

  // 5. Quotes
  if (Array.isArray(db.quotes) && db.quotes.length > 0) {
    await batchSet('quotes', db.quotes.map((q: any) => ({ id: q.id, data: q })));
    counts['quotes'] = db.quotes.length;
  }

  // 6. Credit Notes
  if (Array.isArray(db.creditNotes) && db.creditNotes.length > 0) {
    await batchSet('creditNotes', db.creditNotes.map((cn: any) => ({ id: cn.id, data: cn })));
    counts['creditNotes'] = db.creditNotes.length;
  }

  // 7. Recurring Invoices
  if (Array.isArray(db.recurringInvoices) && db.recurringInvoices.length > 0) {
    await batchSet('recurringInvoices', db.recurringInvoices.map((r: any) => ({ id: r.id, data: r })));
    counts['recurringInvoices'] = db.recurringInvoices.length;
  }

  // 8. Expenses
  if (Array.isArray(db.expenses) && db.expenses.length > 0) {
    await batchSet('expenses', db.expenses.map((e: any) => ({ id: e.id, data: e })));
    counts['expenses'] = db.expenses.length;
  }

  // 9. Onboardings
  if (Array.isArray(db.onboardings) && db.onboardings.length > 0) {
    await batchSet('onboardings', db.onboardings.map((o: any) => ({ id: o.id, data: o })));
    counts['onboardings'] = db.onboardings.length;
  }

  // 10. Audit Logs
  if (Array.isArray(db.auditLogs) && db.auditLogs.length > 0) {
    await batchSet('auditLogs', db.auditLogs.map((a: any) => ({ id: a.id, data: a })));
    counts['auditLogs'] = db.auditLogs.length;
  }

  console.log('Migration completed successfully:', counts);
  return { migrated: counts, message: 'Data migration completed successfully' };
}

/**
 * Seed realistic business data (~1000+ records) with proper GSTINs,
 * relational client IDs, HSN codes, and exact GST calculations.
 */
export async function seedRealisticDataset(targetCount: number = 1000): Promise<{ seeded: Record<string, number> }> {
  console.log(`Starting generation of realistic dataset (~${targetCount} records)...`);

  const businessProfile = (await getDoc('settings', 'businessProfile')) || {
    stateCode: '23',
    businessName: 'UDM Techno Solutions'
  };
  const sellerStateCode = businessProfile.stateCode || '23';

  // 1. Generate 50 realistic Clients across India
  const clientNames = [
    { name: 'Apex Digital Agency', city: 'Indore', state: 'Madhya Pradesh', code: '23', gstin: '23AABCA1234F1Z1', type: 'B2B' },
    { name: 'TechMatrix Software Pvt Ltd', city: 'Bhopal', state: 'Madhya Pradesh', code: '23', gstin: '23AAACT1984Q1Z5', type: 'B2B' },
    { name: 'Zenith Logistics Hub', city: 'Mumbai', state: 'Maharashtra', code: '27', gstin: '27AABCZ9876K1ZY', type: 'B2B' },
    { name: 'Bharat Cloud Infotech', city: 'Pune', state: 'Maharashtra', code: '27', gstin: '27AAFCB5432D1Z9', type: 'B2B' },
    { name: 'Kaveri Retailers & Mart', city: 'Bengaluru', state: 'Karnataka', code: '29', gstin: '29AABCK1122P1Z0', type: 'B2B' },
    { name: 'Sunrise Healthcare Clinic', city: 'Hyderabad', state: 'Telangana', code: '36', gstin: '36AABCS3344M1Z2', type: 'B2C' },
    { name: 'Royal Rajputana Exports', city: 'Jaipur', state: 'Rajasthan', code: '08', gstin: '08AABCR5566T1Z4', type: 'B2B' },
    { name: 'Ganga Valley Agro Products', city: 'Lucknow', state: 'Uttar Pradesh', code: '09', gstin: '09AABCG7788L1Z6', type: 'B2B' },
    { name: 'Delhi Techventures LLP', city: 'New Delhi', state: 'Delhi', code: '07', gstin: '07AABCD9900H1Z8', type: 'B2B' },
    { name: 'Gujarat Diamond Impex', city: 'Surat', state: 'Gujarat', code: '24', gstin: '24AABCG1357J1Z3', type: 'B2B' }
  ];

  const generatedClients: any[] = [];
  for (let i = 0; i < 50; i++) {
    const base = clientNames[i % clientNames.length];
    const clientNumber = `CLI-${String(i + 1).padStart(3, '0')}`;
    const clientId = `client_${String(i + 1).padStart(4, '0')}`;
    generatedClients.push({
      id: clientId,
      clientNumber,
      name: i < clientNames.length ? base.name : `${base.name} - Branch ${Math.floor(i / 10) + 1}`,
      contactPerson: `Manager ${i + 1}`,
      email: `contact${i + 1}@${base.name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      phone: `9826${String(100000 + i).slice(-6)}`,
      billingAddress: `Plot No. ${i + 10}, Industrial Area`,
      shippingAddress: `Plot No. ${i + 10}, Industrial Area`,
      city: base.city,
      state: base.state,
      stateCode: base.code,
      country: 'India',
      pinCode: '452001',
      gstin: base.gstin,
      pan: base.gstin.substring(2, 12),
      customerType: base.type,
      notes: 'Corporate client registered under GST',
      createdAt: new Date(Date.now() - (180 - i) * 86400000).toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await batchSet('clients', generatedClients.map(c => ({ id: c.id, data: c })));

  // 2. Generate Invoices (~500 records)
  const itemsPool = [
    { name: 'Custom ERP Software Module Development', hsnSac: '998314', rate: 45000, gstRate: 18 },
    { name: 'Monthly Cloud Infrastructure & Server AMC', hsnSac: '998315', rate: 25000, gstRate: 18 },
    { name: 'Meta Ads Campaign Strategy & Execution', hsnSac: '998313', rate: 18000, gstRate: 18 },
    { name: 'Google Ads PPC Management Retainer', hsnSac: '998313', rate: 15000, gstRate: 18 },
    { name: 'Technical Support & System Maintenance', hsnSac: '9987', rate: 12000, gstRate: 12 },
    { name: 'Server Hardware Peripheral Replacement', hsnSac: '8471', rate: 8000, gstRate: 18 },
    { name: 'GST Audit & Compliance Software Setup', hsnSac: '9982', rate: 30000, gstRate: 18 }
  ];

  const generatedInvoices: any[] = [];
  const generatedCreditNotes: any[] = [];
  const now = Date.now();

  for (let i = 1; i <= 500; i++) {
    const client = generatedClients[(i - 1) % generatedClients.length];
    const isInterState = client.stateCode !== sellerStateCode;
    const invId = `inv_${String(i).padStart(5, '0')}`;
    const invoiceNumber = `A${String(i).padStart(6, '0')}`;

    // Date spread over last 180 days
    const daysAgo = Math.floor(Math.random() * 150);
    const invoiceDate = new Date(now - daysAgo * 86400000).toISOString().split('T')[0];
    const dueDate = new Date(new Date(invoiceDate).getTime() + 15 * 86400000).toISOString().split('T')[0];

    // Pick 1 to 3 items
    const numItems = (i % 3) + 1;
    const items = [];
    for (let k = 0; k < numItems; k++) {
      const templateItem = itemsPool[(i + k) % itemsPool.length];
      items.push({
        id: `item_${i}_${k}`,
        name: templateItem.name,
        description: `Delivered per scope of agreement SOW-${i}`,
        hsnSac: templateItem.hsnSac,
        quantity: 1,
        unit: 'NOS',
        rate: templateItem.rate,
        discountType: 'percentage' as const,
        discountValue: i % 5 === 0 ? 5 : 0,
        discountAmount: 0,
        gstRate: templateItem.gstRate
      });
    }

    // Status distribution
    const statusCycle = i % 10;
    let initialStatus = 'paid';
    let advanceAmount = 0;
    let paymentsTotal = 0;
    const payments = [];

    if (statusCycle === 0) {
      initialStatus = 'draft';
    } else if (statusCycle === 1) {
      initialStatus = 'sent';
    } else if (statusCycle === 2) {
      initialStatus = 'partially_paid';
      advanceAmount = 5000;
    } else {
      initialStatus = 'paid';
    }

    // Server GST Calculation Engine
    const totals = calculateInvoiceTotals(items, {
      isInterState,
      advanceAmount,
      paymentsTotal
    }, initialStatus);

    if (initialStatus === 'paid') {
      payments.push({
        id: `pay_${invId}_1`,
        amount: totals.grandTotal,
        paymentDate: invoiceDate,
        paymentMethod: i % 2 === 0 ? 'UPI' : 'Bank Transfer',
        transactionId: `TXN${100000 + i}`,
        notes: 'Full payment received'
      });
      totals.amountPaid = totals.grandTotal;
      totals.balanceDue = 0;
      totals.status = 'paid';
    } else if (initialStatus === 'partially_paid') {
      payments.push({
        id: `pay_${invId}_1`,
        amount: advanceAmount,
        paymentDate: invoiceDate,
        paymentMethod: 'UPI',
        transactionId: `TXN${100000 + i}`,
        notes: 'Advance deposit received'
      });
      totals.amountPaid = advanceAmount;
      totals.balanceDue = round2(totals.grandTotal - advanceAmount);
      totals.status = 'partially_paid';
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
      currency: 'INR',
      financialYear: 'FY 2026-27',
      isInterState,
      status: totals.status,
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
      terms: 'Payment due in 15 days.',
      customerNotes: 'Thank you for your business.',
      createdAt: new Date(invoiceDate).toISOString(),
      updatedAt: new Date().toISOString()
    };

    generatedInvoices.push(invoiceDoc);

    // Link a few credit notes to paid invoices
    if (i % 25 === 0) {
      generatedCreditNotes.push({
        id: `cn_${String(generatedCreditNotes.length + 1).padStart(3, '0')}`,
        creditNoteNumber: `CN-2026-${String(generatedCreditNotes.length + 1).padStart(3, '0')}`,
        creditNoteDate: invoiceDate,
        invoiceId: invId,
        invoiceNumber,
        clientId: client.id,
        client,
        reason: 'Service scope alteration & rate adjustment',
        items: [{ description: 'Scope adjustment', amount: 5000 }],
        taxAmount: 900,
        totalAmount: 5900,
        createdAt: new Date(invoiceDate).toISOString()
      });
    }
  }

  await batchSet('invoices', generatedInvoices.map(i => ({ id: i.id, data: i })));
  if (generatedCreditNotes.length > 0) {
    await batchSet('creditNotes', generatedCreditNotes.map(cn => ({ id: cn.id, data: cn })));
  }

  // 3. Generate Quotes (~100 records)
  const generatedQuotes: any[] = [];
  for (let i = 1; i <= 100; i++) {
    const client = generatedClients[(i + 5) % generatedClients.length];
    const isInterState = client.stateCode !== sellerStateCode;
    const qId = `quote_${String(i).padStart(4, '0')}`;
    const quoteNumber = `Q000${100 + i}`;
    const quoteDate = new Date(now - (i * 2) * 86400000).toISOString().split('T')[0];
    const validUntil = new Date(new Date(quoteDate).getTime() + 30 * 86400000).toISOString().split('T')[0];

    const items = [{
      name: 'Custom Mobile & Web Application Suite',
      hsnSac: '998314',
      quantity: 1,
      unit: 'NOS',
      rate: 75000,
      gstRate: 18
    }];

    const totals = calculateInvoiceTotals(items, { isInterState }, 'draft');

    generatedQuotes.push({
      id: qId,
      quoteNumber,
      quoteDate,
      validUntil,
      placeOfSupply: client.state,
      placeOfSupplyCode: client.stateCode,
      currency: 'INR',
      status: i % 4 === 0 ? 'accepted' : (i % 3 === 0 ? 'sent' : 'draft'),
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
      updatedAt: new Date().toISOString()
    });
  }
  await batchSet('quotes', generatedQuotes.map(q => ({ id: q.id, data: q })));

  // 4. Generate Recurring Schedules (~30 records)
  const generatedRecurring: any[] = [];
  for (let i = 1; i <= 30; i++) {
    const client = generatedClients[i % generatedClients.length];
    generatedRecurring.push({
      id: `rec_${String(i).padStart(3, '0')}`,
      recurringNumber: `REC-00${i}`,
      clientId: client.id,
      clientName: client.name,
      frequency: i % 2 === 0 ? 'monthly' : 'quarterly',
      startDate: '2026-04-01',
      nextDueDate: '2026-10-01',
      status: 'active',
      items: [{
        name: 'Managed Cloud Retainer',
        hsnSac: '998315',
        quantity: 1,
        rate: 20000,
        gstRate: 18
      }],
      terms: 'Billed monthly on the 1st.',
      createdAt: new Date().toISOString()
    });
  }
  await batchSet('recurringInvoices', generatedRecurring.map(r => ({ id: r.id, data: r })));

  // 5. Generate Expenses (~150 records)
  const expenseCategories = ['Server & Cloud Hosting', 'Office Rent', 'Salaries & Contractors', 'Marketing & Ads', 'Software Subscriptions', 'Utilities'];
  const generatedExpenses: any[] = [];
  for (let i = 1; i <= 150; i++) {
    const cat = expenseCategories[i % expenseCategories.length];
    const amount = 3000 + (i * 250);
    const taxAmount = round2((amount * 18) / 100);
    const totalAmount = round2(amount + taxAmount);
    const daysAgo = Math.floor(Math.random() * 120);
    const date = new Date(now - daysAgo * 86400000).toISOString().split('T')[0];

    generatedExpenses.push({
      id: `exp_${String(i).padStart(4, '0')}`,
      category: cat,
      description: `Monthly payment for ${cat} - Reference ${i}`,
      amount,
      taxAmount,
      totalAmount,
      paymentMethod: 'Bank Transfer',
      vendor: `Vendor ${i}`,
      invoiceNumber: `V-INV-${1000 + i}`,
      date,
      isTaxDeductible: true,
      createdAt: new Date(date).toISOString()
    });
  }
  await batchSet('expenses', generatedExpenses.map(e => ({ id: e.id, data: e })));

  // 6. Generate Onboardings (~100 records)
  const generatedOnboardings: any[] = [];
  for (let i = 1; i <= 100; i++) {
    const client = generatedClients[i % generatedClients.length];
    const daysAgo = Math.floor(Math.random() * 120);
    const obDate = new Date(now - daysAgo * 86400000).toISOString().split('T')[0];
    const dueDate = new Date(new Date(obDate).getTime() + 30 * 86400000).toISOString().split('T')[0];
    const serviceFee = 25000;
    const adDailyBudget = 250;
    const adDurationDays = 15;
    const adTotalBudget = adDailyBudget * adDurationDays;
    const totalPackageValue = serviceFee + adTotalBudget;
    const advancePaid = i % 3 === 0 ? 15000 : (i % 2 === 0 ? totalPackageValue : 0);
    const remainingBalance = Math.max(0, totalPackageValue - advancePaid);
    const paymentStatus = remainingBalance === 0 ? 'paid' : (advancePaid > 0 ? 'partially_paid' : 'unpaid');

    generatedOnboardings.push({
      id: `onb_${String(i).padStart(4, '0')}`,
      onboardingNumber: `ONB-${String(i).padStart(3, '0')}`,
      clientId: client.id,
      customerName: client.contactPerson || client.name,
      businessName: client.name,
      phone: client.phone,
      email: client.email,
      city: client.city,
      state: client.state,
      status: i % 8 === 0 ? 'churned' : 'active',
      onboardingDate: obDate,
      billingCycleDays: 30,
      nextPaymentDueDate: dueDate,
      lastRenewalDate: obDate,
      servicePackage: 'Meta & Google Ads Growth Retainer',
      hasAdsCampaign: true,
      adPlatform: 'meta',
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
        type: 'advance',
        paymentMethod: 'UPI',
        notes: 'Deposit received'
      }] : [],
      assignedExecutive: i % 2 === 0 ? 'Sankalp' : 'Mahendra',
      salesManager: i % 2 === 0 ? 'Sankalp' : 'Mahendra',
      incentivePercentage: 10,
      incentiveAmount: 2500,
      incentiveStatus: paymentStatus === 'paid' ? 'eligible' : 'pending',
      monthYear: obDate.slice(0, 7),
      notes: 'Active growth marketing client',
      remarks: 'Active growth marketing client',
      createdAt: new Date(obDate).toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  await batchSet('onboardings', generatedOnboardings.map(o => ({ id: o.id, data: o })));

  // 7. Audit Logs (~100 records)
  const generatedLogs: any[] = [];
  for (let i = 1; i <= 100; i++) {
    generatedLogs.push({
      id: `log_${String(i).padStart(4, '0')}`,
      action: i % 2 === 0 ? 'Invoice Created & Finalized' : 'Payment Recorded',
      entityType: i % 2 === 0 ? 'invoice' : 'payment',
      entityId: `inv_${String(i).padStart(5, '0')}`,
      entityName: `A${String(i).padStart(6, '0')}`,
      user: 'UDM Admin',
      details: 'Automated verified transaction',
      timestamp: new Date(now - i * 3600000).toISOString()
    });
  }
  await batchSet('auditLogs', generatedLogs.map(l => ({ id: l.id, data: l })));

  const resultCounts = {
    clients: generatedClients.length,
    invoices: generatedInvoices.length,
    creditNotes: generatedCreditNotes.length,
    quotes: generatedQuotes.length,
    recurringInvoices: generatedRecurring.length,
    expenses: generatedExpenses.length,
    onboardings: generatedOnboardings.length,
    auditLogs: generatedLogs.length,
    totalRecords: generatedClients.length + generatedInvoices.length + generatedCreditNotes.length +
      generatedQuotes.length + generatedRecurring.length + generatedExpenses.length +
      generatedOnboardings.length + generatedLogs.length
  };

  console.log('Seeding completed successfully:', resultCounts);
  return { seeded: resultCounts };
}
