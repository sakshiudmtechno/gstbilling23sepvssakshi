import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ExpenseSchema,
  CreditNoteSchema,
  QuoteSchema,
  InvoiceSchema,
  RecurringInvoiceSchema,
  ClientSchema,
  OnboardingSchema,
  PaymentRecordSchema
} from '../src/server/validation';

describe('Comprehensive Form Audit & Validation Alignment Tests', () => {

  // ==========================================
  // 1. EXPENSE TRACKER FORM TESTS
  // ==========================================
  describe('Expense Form Validation', () => {
    test('Validates successfully when only Title is supplied (maps to description without failure)', () => {
      const frontendFormPayload = {
        title: 'AWS Cloud Hosting - March 2026',
        category: 'Software & Cloud',
        vendorName: 'Amazon Web Services',
        vendorGstin: '27AABCA1234D1ZP',
        date: '2026-03-24',
        amount: 10000,
        gstAmount: 1800,
        totalAmount: 11800,
        paymentMode: 'Bank',
        itcEligible: true
      };

      const result = ExpenseSchema.safeParse(frontendFormPayload);
      assert.strictEqual(result.success, true, 'Expense form without separate description should succeed');
      if (result.success) {
        assert.strictEqual(result.data.title, 'AWS Cloud Hosting - March 2026');
        assert.strictEqual(result.data.amount, 10000);
        assert.strictEqual(result.data.gstAmount, 1800);
        assert.strictEqual(result.data.totalAmount, 11800);
        assert.strictEqual(result.data.itcEligible, true);
        assert.strictEqual(result.data.vendorName, 'Amazon Web Services');
      }
    });

    test('Validates successfully with both Title and custom Description / Notes', () => {
      const fullExpense = {
        title: 'Google Workspace Licenses',
        description: 'Annual domain email accounts for 15 executives',
        category: 'Software & Cloud',
        vendorName: 'Google Cloud India Pvt Ltd',
        date: '2026-03-20',
        amount: 25000,
        gstAmount: 4500,
        totalAmount: 29500,
        paymentMode: 'Card',
        itcEligible: true
      };

      const result = ExpenseSchema.safeParse(fullExpense);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.title, 'Google Workspace Licenses');
        assert.strictEqual(result.data.description, 'Annual domain email accounts for 15 executives');
        assert.strictEqual(result.data.totalAmount, 29500);
      }
    });

    test('Accepts seed expense format (using description instead of title)', () => {
      const seedExpense = {
        id: 'exp_0001',
        category: 'Office Rent',
        description: 'Monthly payment for Office Rent - Reference 1',
        amount: 3250,
        taxAmount: 585,
        totalAmount: 3835,
        paymentMethod: 'Bank Transfer',
        vendor: 'Vendor 1',
        invoiceNumber: 'V-INV-1001',
        date: '2026-02-15',
        isTaxDeductible: true
      };

      const result = ExpenseSchema.safeParse(seedExpense);
      assert.strictEqual(result.success, true, 'Seed expense with description only must validate');
    });

    test('Defaults date to current date if omitted in expense payload', () => {
      const minimalExpense = {
        category: 'Utilities & Internet',
        title: 'Broadband Bill',
        amount: 1500,
        totalAmount: 1770
      };

      const result = ExpenseSchema.safeParse(minimalExpense);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.data.date, 'Date should default to a valid string');
      }
    });
  });

  // ==========================================
  // 2. CREDIT NOTE FORM TESTS
  // ==========================================
  describe('Credit Note Form Validation', () => {
    test('Validates credit note using frontend form payload (date, taxableAmount, gstAmount)', () => {
      const frontendCreditNote = {
        creditNoteNumber: 'CN-2026-009',
        invoiceId: 'inv_1001',
        invoiceNumber: 'A000120',
        clientId: 'client_101',
        date: '2026-03-24',
        reason: 'Post-sales discount adjustment agreed by management',
        taxableAmount: 5000,
        gstAmount: 900,
        totalAmount: 5900,
        status: 'active'
      };

      const result = CreditNoteSchema.safeParse(frontendCreditNote);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.invoiceId, 'inv_1001');
        assert.strictEqual(result.data.totalAmount, 5900);
        assert.strictEqual(result.data.taxableAmount, 5000);
        assert.strictEqual(result.data.gstAmount, 900);
      }
    });

    test('Fails when required invoiceId or reason is missing', () => {
      const invalidCN = {
        totalAmount: 5000
      };
      const result = CreditNoteSchema.safeParse(invalidCN);
      assert.strictEqual(result.success, false);
    });
  });

  // ==========================================
  // 3. QUOTES / ESTIMATES FORM TESTS
  // ==========================================
  describe('Quote Form Validation', () => {
    test('Validates quote generated from QuoteManager with dynamic items and date fallbacks', () => {
      const quotePayload = {
        quoteNumber: 'EST-2026-001',
        clientName: 'Rahul Sharma (Apex Retail)',
        clientId: 'client_202',
        client: { name: 'Rahul Sharma (Apex Retail)', stateCode: '23' },
        quoteDate: '2026-03-24',
        validUntil: '2026-04-24',
        items: [
          {
            name: 'Meta Ads & Social Media Package',
            description: '15-day campaign setup and management',
            quantity: 1,
            rate: 25000,
            gstRate: 18,
            hsnSac: '9983'
          }
        ],
        subtotal: 25000,
        totalGst: 4500,
        grandTotal: 29500
      };

      const result = QuoteSchema.safeParse(quotePayload);
      assert.strictEqual(result.success, true);
    });

    test('Handles missing quoteDate and validUntil gracefully with defaults', () => {
      const payloadWithoutDates = {
        items: [
          {
            name: 'Consulting Session',
            quantity: 2,
            rate: 5000
          }
        ]
      };

      const result = QuoteSchema.safeParse(payloadWithoutDates);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.data.quoteDate, 'quoteDate should have default');
        assert.ok(result.data.validUntil, 'validUntil should have default');
      }
    });
  });

  // ==========================================
  // 4. INVOICES FORM TESTS
  // ==========================================
  describe('Invoice Form Validation', () => {
    test('Validates standard invoice with items, billing period, and GST details', () => {
      const invoicePayload = {
        invoiceNumber: 'A000501',
        invoiceDate: '2026-03-24',
        dueDate: '2026-04-08',
        placeOfSupply: 'Madhya Pradesh',
        placeOfSupplyCode: '23',
        clientId: 'client_301',
        items: [
          {
            name: 'Website Redesign & SEO Retainer',
            description: 'Comprehensive technical audit and on-page optimization',
            hsnSac: '998314',
            quantity: 1,
            rate: 35000,
            gstRate: 18
          }
        ],
        advanceAmount: 10000,
        terms: 'Net 15 days payment terms apply.'
      };

      const result = InvoiceSchema.safeParse(invoicePayload);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.invoiceNumber, 'A000501');
        assert.strictEqual(result.data.items.length, 1);
      }
    });

    test('Requires at least one line item in invoice', () => {
      const emptyInvoice = {
        invoiceDate: '2026-03-24',
        dueDate: '2026-04-08',
        items: []
      };

      const result = InvoiceSchema.safeParse(emptyInvoice);
      assert.strictEqual(result.success, false);
    });
  });

  // ==========================================
  // 5. RECURRING INVOICES / AMC FORM TESTS
  // ==========================================
  describe('Recurring Invoice & AMC Form Validation', () => {
    test('Validates all 5 frequencies and ensures items array is preserved', () => {
      const frequencies = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;

      for (const freq of frequencies) {
        const payload = {
          title: `SLA Retainer - ${freq}`,
          clientId: 'client_401',
          frequency: freq,
          startDate: '2026-04-01',
          items: [
            {
              name: 'Cloud Maintenance SLA',
              quantity: 1,
              rate: 12000,
              gstRate: 18
            }
          ]
        };

        const result = RecurringInvoiceSchema.safeParse(payload);
        assert.strictEqual(result.success, true, `Frequency ${freq} should validate cleanly`);
        if (result.success) {
          assert.strictEqual(result.data.frequency, freq);
        }
      }
    });
  });

  // ==========================================
  // 6. CLIENTS CRM FORM TESTS
  // ==========================================
  describe('Client CRM Form Validation', () => {
    test('Validates client with only name and checks default values', () => {
      const minimalClient = {
        name: 'Nexus Technologies'
      };

      const result = ClientSchema.safeParse(minimalClient);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.name, 'Nexus Technologies');
        assert.strictEqual(result.data.state, 'Madhya Pradesh');
        assert.strictEqual(result.data.stateCode, '23');
        assert.strictEqual(result.data.country, 'India');
        assert.strictEqual(result.data.customerType, 'B2B');
      }
    });

    test('Preserves full CRM contact and address information', () => {
      const fullClient = {
        name: 'Zenith Logistics Ltd',
        contactPerson: 'Vikram Mehta',
        email: 'vikram@zenith.in',
        phone: '+91 98260 12345',
        billingAddress: '402 Apollo Premier, Vijay Nagar',
        city: 'Indore',
        state: 'Madhya Pradesh',
        stateCode: '23',
        gstin: '23AAACZ1234F1ZU',
        customerType: 'B2B'
      };

      const result = ClientSchema.safeParse(fullClient);
      assert.strictEqual(result.success, true);
    });
  });

  // ==========================================
  // 7. CLIENT DEALS (ONBOARDING) FORM TESTS
  // ==========================================
  describe('Client Deals (Onboarding) Form Validation', () => {
    test('Validates multi-service client deal with nested service breakdowns', () => {
      const multiDealPayload = {
        customerName: 'Aarav Fashion',
        businessName: 'Aarav Fashion',
        phone: '+91 91111 22222',
        onboardingDate: '2026-03-24',
        servicePackage: 'Social Media Management, Google Ads',
        services: [
          {
            serviceName: 'Social Media Management',
            managementFee: 15000,
            managementFeePaid: 15000,
            adBudget: 0,
            adBudgetPaid: 0,
            dealValue: 15000,
            totalReceived: 15000,
            totalDue: 0
          },
          {
            serviceName: 'Google Ads',
            managementFee: 10000,
            managementFeePaid: 5000,
            adBudget: 15000,
            adBudgetPaid: 10000,
            dealValue: 25000,
            totalReceived: 15000,
            totalDue: 10000
          }
        ],
        managementFee: 25000,
        adBudget: 15000,
        totalDealValue: 40000,
        advancePaid: 30000,
        totalReceived: 30000,
        totalDue: 10000,
        salesManager: 'Mahendra'
      };

      const result = OnboardingSchema.safeParse(multiDealPayload);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.services?.length, 2);
        assert.strictEqual(result.data.totalDealValue, 40000);
      }
    });
  });

  // ==========================================
  // 8. PAYMENT RECORD FORM TESTS
  // ==========================================
  describe('Payment Record Form Validation', () => {
    test('Validates positive payment amount and payment methods', () => {
      const payment = {
        amount: 5000,
        paymentDate: '2026-03-24',
        paymentMethod: 'UPI',
        transactionId: 'UPI-78901234',
        notes: 'Second milestone payment'
      };

      const result = PaymentRecordSchema.safeParse(payment);
      assert.strictEqual(result.success, true);
    });

    test('Rejects non-positive payment amounts', () => {
      const invalidPayment = {
        amount: 0
      };
      const result = PaymentRecordSchema.safeParse(invalidPayment);
      assert.strictEqual(result.success, false);
    });
  });
});
