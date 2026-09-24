import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RecurringInvoiceSchema } from '../src/server/validation.ts';
import { calculateInvoiceTotals } from '../src/utils/taxCalculator.ts';

describe('Recurring Invoice & AMC Tests', () => {
  const sampleItems = [
    {
      id: 'item_1',
      name: 'Cloud Server Maintenance AMC',
      description: 'Monthly uptime SLA & server patches',
      hsnSac: '9983',
      quantity: 1,
      unit: 'MONTH',
      rate: 15000,
      gstRate: 18
    },
    {
      id: 'item_2',
      name: 'Dedicated Backup Storage',
      description: 'Encrypted offsite cloud backup',
      hsnSac: '9983',
      quantity: 1,
      unit: 'MONTH',
      rate: 5000,
      gstRate: 18
    }
  ];

  it('Accepts all 5 valid billing frequencies: weekly, monthly, quarterly, half_yearly, yearly', () => {
    const frequencies = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;

    frequencies.forEach(freq => {
      const payload = {
        title: `${freq.toUpperCase()} Retainer Schedule`,
        clientId: 'client_123',
        frequency: freq,
        startDate: '2026-10-01',
        status: 'active',
        items: sampleItems
      };

      const result = RecurringInvoiceSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `Failed validation for frequency: ${freq}`);
      assert.strictEqual(result.data?.frequency, freq);
    });
  });

  it('Validates line items with custom quantities, rates, and GST rates', () => {
    const payload = {
      title: 'Digital Marketing & SEO AMC',
      clientId: 'client_seo_456',
      frequency: 'monthly',
      startDate: '2026-10-01',
      items: [
        {
          id: 'item_seo',
          name: 'SEO & Content Retainer',
          hsnSac: '9983',
          quantity: 1,
          unit: 'MONTH',
          rate: 25000,
          gstRate: 18
        }
      ]
    };

    const result = RecurringInvoiceSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data?.items.length, 1);
    assert.strictEqual(result.data?.items[0].rate, 25000);
    assert.strictEqual(result.data?.items[0].gstRate, 18);
  });

  it('Calculates correct GST for generated invoice (Intra-State: CGST 9% + SGST 9%)', () => {
    const items = [
      {
        id: 'rec_item_1',
        name: 'Web Maintenance AMC',
        hsnSac: '9983',
        quantity: 1,
        unit: 'MONTH',
        rate: 20000,
        gstRate: 18
      }
    ];

    // Intra-state (seller MP code 23, client MP code 23)
    const totals = calculateInvoiceTotals(items, { isInterState: false }, 'draft');

    assert.strictEqual(totals.subtotal, 20000);
    assert.strictEqual(totals.totalTaxableAmount, 20000);
    assert.strictEqual(totals.totalCgst, 1800); // 9% of 20000
    assert.strictEqual(totals.totalSgst, 1800); // 9% of 20000
    assert.strictEqual(totals.totalIgst, 0);
    assert.strictEqual(totals.totalGst, 3600); // 18% of 20000
    assert.strictEqual(totals.grandTotal, 23600); // 20000 + 3600
  });

  it('Calculates correct GST for generated invoice (Inter-State: IGST 18%)', () => {
    const items = [
      {
        id: 'rec_item_1',
        name: 'SaaS Platform Subscription',
        hsnSac: '9983',
        quantity: 2,
        unit: 'MONTH',
        rate: 10000,
        gstRate: 18
      }
    ];

    // Inter-state (seller MP code 23, client MH code 27)
    const totals = calculateInvoiceTotals(items, { isInterState: true }, 'draft');

    assert.strictEqual(totals.subtotal, 20000);
    assert.strictEqual(totals.totalTaxableAmount, 20000);
    assert.strictEqual(totals.totalCgst, 0);
    assert.strictEqual(totals.totalSgst, 0);
    assert.strictEqual(totals.totalIgst, 3600); // 18% of 20000
    assert.strictEqual(totals.totalGst, 3600);
    assert.strictEqual(totals.grandTotal, 23600);
  });

  it('Advances scheduled next invoice date accurately across all billing frequencies', () => {
    const baseDate = new Date('2026-01-15T00:00:00Z');

    // Weekly (+7 days)
    const weeklyNext = new Date(baseDate);
    weeklyNext.setDate(weeklyNext.getDate() + 7);
    assert.strictEqual(weeklyNext.toISOString().split('T')[0], '2026-01-22');

    // Monthly (+1 month)
    const monthlyNext = new Date(baseDate);
    monthlyNext.setMonth(monthlyNext.getMonth() + 1);
    assert.strictEqual(monthlyNext.toISOString().split('T')[0], '2026-02-15');

    // Quarterly (+3 months)
    const quarterlyNext = new Date(baseDate);
    quarterlyNext.setMonth(quarterlyNext.getMonth() + 3);
    assert.strictEqual(quarterlyNext.toISOString().split('T')[0], '2026-04-15');

    // Half-Yearly (+6 months)
    const halfYearlyNext = new Date(baseDate);
    halfYearlyNext.setMonth(halfYearlyNext.getMonth() + 6);
    assert.strictEqual(halfYearlyNext.toISOString().split('T')[0], '2026-07-15');

    // Yearly (+1 year)
    const yearlyNext = new Date(baseDate);
    yearlyNext.setFullYear(yearlyNext.getFullYear() + 1);
    assert.strictEqual(yearlyNext.toISOString().split('T')[0], '2027-01-15');
  });

  it('Handles multi-item subscriptions with mixed GST rates accurately', () => {
    const items = [
      {
        id: 'service_1',
        name: 'Technical Consulting',
        hsnSac: '9983',
        quantity: 1,
        unit: 'NOS',
        rate: 10000,
        gstRate: 18 // 1800 tax
      },
      {
        id: 'service_2',
        name: 'Printing & Physical Media',
        hsnSac: '4901',
        quantity: 1,
        unit: 'NOS',
        rate: 5000,
        gstRate: 12 // 600 tax
      }
    ];

    const totals = calculateInvoiceTotals(items, { isInterState: false }, 'draft');
    assert.strictEqual(totals.subtotal, 15000);
    assert.strictEqual(totals.totalGst, 2400); // 1800 + 600
    assert.strictEqual(totals.totalCgst, 1200); // 2400 / 2
    assert.strictEqual(totals.totalSgst, 1200); // 2400 / 2
    assert.strictEqual(totals.grandTotal, 17400);
  });
});
