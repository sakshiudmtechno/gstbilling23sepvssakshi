import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateLineItem,
  calculateInvoiceTotals,
  round2,
  numberToIndianWords
} from '../src/utils/taxCalculator';

describe('GST Calculation Engine Unit Tests', () => {
  it('Scenario 1: Intra-state supply (CGST 9% + SGST 9%)', () => {
    const items = [
      {
        name: 'Web Application Development',
        hsnSac: '998314',
        quantity: 1,
        rate: 100000,
        gstRate: 18
      }
    ];

    const result = calculateInvoiceTotals(items, {
      isInterState: false,
      isReverseCharge: false
    });

    assert.strictEqual(result.subtotal, 100000);
    assert.strictEqual(result.totalTaxableAmount, 100000);
    assert.strictEqual(result.totalCgst, 9000);
    assert.strictEqual(result.totalSgst, 9000);
    assert.strictEqual(result.totalIgst, 0);
    assert.strictEqual(result.totalGst, 18000);
    assert.strictEqual(result.grandTotal, 118000);
    assert.strictEqual(result.balanceDue, 118000);
    assert.strictEqual(result.totalInWords, 'One Lakh Eighteen Thousand Rupees Only');
  });

  it('Scenario 2: Inter-state supply (IGST 18%)', () => {
    const items = [
      {
        name: 'Cloud Hosting Services',
        hsnSac: '998315',
        quantity: 2,
        rate: 25000,
        gstRate: 18
      }
    ];

    const result = calculateInvoiceTotals(items, {
      isInterState: true,
      isReverseCharge: false
    });

    assert.strictEqual(result.subtotal, 50000);
    assert.strictEqual(result.totalTaxableAmount, 50000);
    assert.strictEqual(result.totalCgst, 0);
    assert.strictEqual(result.totalSgst, 0);
    assert.strictEqual(result.totalIgst, 9000);
    assert.strictEqual(result.totalGst, 9000);
    assert.strictEqual(result.grandTotal, 59000);
  });

  it('Scenario 3: Mixed HSN/SAC rates (0%, 5%, 12%, 18%, 28%) with line discounts', () => {
    const items = [
      { name: 'Exempt IT Consultation', hsnSac: '9983', quantity: 1, rate: 10000, gstRate: 0 },
      { name: 'Hardware Spares (5%)', hsnSac: '8471', quantity: 2, rate: 5000, gstRate: 5 },
      { name: 'Support Contract (12%)', hsnSac: '9987', quantity: 1, rate: 20000, gstRate: 12 },
      { name: 'Custom Software (18%)', hsnSac: '998314', quantity: 1, rate: 50000, gstRate: 18, discountType: 'percentage' as const, discountValue: 10 } // 50000 - 5000 = 45000
    ];

    const result = calculateInvoiceTotals(items, {
      isInterState: false
    });

    // Subtotal = 10000 + 10000 + 20000 + 50000 = 90000
    assert.strictEqual(result.subtotal, 90000);
    // Item discount on item 4 = 5000
    assert.strictEqual(result.totalItemDiscount, 5000);
    // Taxable = 10000 + 10000 + 20000 + 45000 = 85000
    assert.strictEqual(result.totalTaxableAmount, 85000);

    // GST Breakdown:
    // Item 1: 0% on 10000 = 0
    // Item 2: 5% on 10000 = 500 (CGST 250, SGST 250)
    // Item 3: 12% on 20000 = 2400 (CGST 1200, SGST 1200)
    // Item 4: 18% on 45000 = 8100 (CGST 4050, SGST 4050)
    // Total GST = 0 + 500 + 2400 + 8100 = 11000
    assert.strictEqual(result.totalGst, 11000);
    assert.strictEqual(result.totalCgst, 5500);
    assert.strictEqual(result.totalSgst, 5500);
    assert.strictEqual(result.grandTotal, 96000);
  });

  it('Scenario 4: Reverse Charge Mechanism (RCM)', () => {
    const items = [
      {
        name: 'Legal & Advocacy Services',
        hsnSac: '9982',
        quantity: 1,
        rate: 40000,
        gstRate: 18
      }
    ];

    const result = calculateInvoiceTotals(items, {
      isInterState: false,
      isReverseCharge: true
    });

    assert.strictEqual(result.totalTaxableAmount, 40000);
    assert.strictEqual(result.totalGst, 7200);
    // Under RCM, supplier does not collect GST from customer, so customer pays 40000 to supplier
    assert.strictEqual(result.grandTotal, 40000);
  });

  it('Scenario 5: Global discount with proportional GST distribution', () => {
    const items = [
      { name: 'Item A (18%)', quantity: 1, rate: 10000, gstRate: 18 },
      { name: 'Item B (12%)', quantity: 1, rate: 10000, gstRate: 12 }
    ];

    // 10% global discount
    const result = calculateInvoiceTotals(items, {
      isInterState: false,
      discountType: 'percentage',
      discountValue: 10
    });

    assert.strictEqual(result.subtotal, 20000);
    assert.strictEqual(result.globalDiscountAmount, 2000);
    assert.strictEqual(result.totalTaxableAmount, 18000);

    // Each item discounted to 9000
    // Item A: 18% on 9000 = 1620
    // Item B: 12% on 9000 = 1080
    // Total GST = 2700
    assert.strictEqual(result.totalGst, 2700);
    assert.strictEqual(result.grandTotal, 20700);
  });

  it('Scenario 6: Advance payments and partial paid status', () => {
    const items = [
      { name: 'Service', quantity: 1, rate: 50000, gstRate: 18 }
    ];

    const result = calculateInvoiceTotals(items, {
      isInterState: false,
      advanceAmount: 20000,
      paymentsTotal: 10000
    }, 'sent');

    assert.strictEqual(result.grandTotal, 59000);
    assert.strictEqual(result.amountPaid, 30000);
    assert.strictEqual(result.balanceDue, 29000);
    assert.strictEqual(result.status, 'partially_paid');
  });

  it('Scenario 7: Number to Indian Currency Words Edge Cases', () => {
    assert.strictEqual(numberToIndianWords(0), 'Zero Rupees Only');
    assert.strictEqual(numberToIndianWords(1), 'One Rupee Only');
    assert.strictEqual(numberToIndianWords(50.75), 'Fifty Rupees and Seventy Five Paise Only');
    assert.strictEqual(numberToIndianWords(100000), 'One Lakh Rupees Only');
    assert.strictEqual(numberToIndianWords(10000000), 'One Crore Rupees Only');
    assert.strictEqual(numberToIndianWords(125000000), 'Twelve Crore Fifty Lakh Rupees Only');
    assert.strictEqual(numberToIndianWords(1250000000), 'One Hundred Twenty Five Crore Rupees Only');
  });

  it('Scenario 8: Fully discounted / Zero-amount invoice', () => {
    const items = [
      { name: 'Complimentary Onboarding Audit', quantity: 1, rate: 10000, discountType: 'percentage' as const, discountValue: 100, gstRate: 18 }
    ];

    const result = calculateInvoiceTotals(items, { isInterState: false });
    assert.strictEqual(result.subtotal, 10000);
    assert.strictEqual(result.totalItemDiscount, 10000);
    assert.strictEqual(result.totalTaxableAmount, 0);
    assert.strictEqual(result.totalGst, 0);
    assert.strictEqual(result.grandTotal, 0);
    assert.strictEqual(result.balanceDue, 0);
    assert.strictEqual(result.totalInWords, 'Zero Rupees Only');
  });
});
