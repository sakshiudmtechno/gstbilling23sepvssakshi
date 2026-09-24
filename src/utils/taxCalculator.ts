/**
 * Canonical GST & Financial Calculation Engine
 * 
 * Provides unified, single-source-of-truth GST calculations for both
 * Express backend endpoints and React frontend components.
 * 
 * Complies with Indian Goods and Services Tax (GST) Act:
 * - Intra-State supply: CGST + SGST (50% each)
 * - Inter-State supply: IGST (100%)
 * - Reverse Charge Mechanism (RCM): Tax calculated for compliance, liability shifted to buyer
 * - Proportional allocation of global discounts across mixed HSN/SAC rate items
 * - Strict 2-decimal / paise rounding to eliminate JavaScript floating point drift
 */

export interface LineItemInput {
  id?: string;
  name: string;
  description?: string;
  hsnSac?: string;
  quantity: number;
  unit?: string;
  rate: number;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  discountAmount?: number;
  gstRate?: number;
}

export interface CalculatedLineItem extends LineItemInput {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGstAmount: number;
  total: number;
}

export interface AdditionalChargeInput {
  id?: string;
  name: string;
  amount: number;
  gstRate?: number;
}

export interface CalculationOptions {
  isInterState: boolean;
  isReverseCharge?: boolean;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  additionalCharges?: AdditionalChargeInput[];
  advanceAmount?: number;
  paymentsTotal?: number;
}

export interface InvoiceTotalsResult {
  items: CalculatedLineItem[];
  subtotal: number;
  totalItemDiscount: number;
  globalDiscountAmount: number;
  totalTaxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  totalAdditionalCharges: number;
  exactGrandTotal: number;
  grandTotal: number;
  roundOff: number;
  totalInWords: string;
  advanceAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
}

/**
 * Rounds any number to exact 2 decimal places (paise precision)
 */
export function round2(num: number): number {
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates a single line item before global discounts
 */
export function calculateLineItem(item: LineItemInput, isInterState: boolean): CalculatedLineItem {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const rate = Math.max(0, Number(item.rate) || 0);
  const rawSubtotal = round2(qty * rate);

  let discountAmount = 0;
  const dType = item.discountType || 'percentage';
  const dVal = Math.max(0, Number(item.discountValue) || 0);

  if (dType === 'percentage') {
    discountAmount = round2((rawSubtotal * dVal) / 100);
  } else {
    discountAmount = round2(dVal);
  }
  discountAmount = Math.min(rawSubtotal, discountAmount);

  const taxableAmount = round2(rawSubtotal - discountAmount);
  const gstRate = Math.max(0, Number(item.gstRate) || 0);
  const gstTotal = round2((taxableAmount * gstRate) / 100);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterState) {
    igst = gstTotal;
  } else {
    cgst = round2(gstTotal / 2);
    sgst = round2(gstTotal - cgst); // Ensure exact sum equals gstTotal
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

/**
 * Single source of truth: Calculates all monetary totals, tax splits, and balances for an invoice or quote.
 */
export function calculateInvoiceTotals(
  items: LineItemInput[],
  options: CalculationOptions,
  currentStatus: string = 'draft'
): InvoiceTotalsResult {
  const isInterState = Boolean(options.isInterState);
  const isReverseCharge = Boolean(options.isReverseCharge);

  // 1. Calculate base line items
  const baseItems = (items || []).map(item => calculateLineItem(item, isInterState));

  // 2. Subtotal & item discounts
  const subtotal = round2(baseItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0));
  const totalItemDiscount = round2(baseItems.reduce((sum, item) => sum + item.discountAmount, 0));
  const afterItemDiscount = Math.max(0, round2(subtotal - totalItemDiscount));

  // 3. Global discount
  let globalDiscountAmount = 0;
  const gType = options.discountType || 'percentage';
  const gVal = Math.max(0, Number(options.discountValue) || 0);

  if (gType === 'percentage') {
    globalDiscountAmount = round2((afterItemDiscount * gVal) / 100);
  } else {
    globalDiscountAmount = round2(gVal);
  }
  globalDiscountAmount = Math.min(afterItemDiscount, globalDiscountAmount);

  const totalTaxableAmount = Math.max(0, round2(afterItemDiscount - globalDiscountAmount));

  // 4. Proportional allocation of global discount to recalculate GST on final discounted taxable base
  const discountRatio = afterItemDiscount > 0 ? totalTaxableAmount / afterItemDiscount : 0;

  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const finalizedItems: CalculatedLineItem[] = baseItems.map(item => {
    const discountedTaxable = round2(item.taxableAmount * discountRatio);
    const gstRate = item.gstRate || 0;
    const itemGst = round2((discountedTaxable * gstRate) / 100);

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

  // 5. Additional charges
  const additionalCharges = options.additionalCharges || [];
  const totalAdditionalCharges = round2(
    additionalCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0)
  );

  // 6. Grand total calculation
  // Under Reverse Charge (RCM), buyer pays GST directly to government, so supplier invoice grandTotal excludes GST
  const taxablePlusGst = isReverseCharge
    ? totalTaxableAmount
    : round2(totalTaxableAmount + totalGst);

  const exactGrandTotal = round2(taxablePlusGst + totalAdditionalCharges);
  const grandTotal = Math.round(exactGrandTotal);
  const roundOff = round2(grandTotal - exactGrandTotal);

  // 7. Words representation
  const totalInWords = numberToIndianWords(grandTotal);

  // 8. Payment & Balance Due
  const advance = round2(Math.max(0, Number(options.advanceAmount) || 0));
  const paymentsTotal = round2(Math.max(0, Number(options.paymentsTotal) || 0));
  const amountPaid = round2(advance + paymentsTotal);
  const balanceDue = round2(Math.max(0, grandTotal - amountPaid));

  // 9. Status calculation
  let calculatedStatus = currentStatus as any;
  if (calculatedStatus !== 'draft' && calculatedStatus !== 'cancelled') {
    if (balanceDue <= 0.01 && grandTotal > 0) {
      calculatedStatus = 'paid';
    } else if (amountPaid > 0) {
      calculatedStatus = 'partially_paid';
    } else {
      calculatedStatus = currentStatus || 'sent';
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

/**
 * Convert number into Indian Currency Words (e.g. Five Thousand Nine Hundred Rupees Only)
 */
export function numberToIndianWords(num: number): string {
  if (isNaN(num) || num === 0) return 'Zero Rupees Only';

  const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n: number): string {
    if (n === 0) return '';
    if (n < 10) return singleDigits[n];
    if (n < 20) return teens[n - 10];
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    return `${tens[ten]}${unit > 0 ? ' ' + singleDigits[unit] : ''}`;
  }

  function convertThreeDigits(n: number): string {
    if (n === 0) return '';
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    let str = '';
    if (hundred > 0) {
      str += `${singleDigits[hundred]} Hundred`;
      if (remainder > 0) str += ' ';
    }
    if (remainder > 0) {
      str += convertTwoDigits(remainder);
    }
    return str.trim();
  }

  function convertUnderTenMillion(n: number): string {
    if (n === 0) return '';
    const lakhs = Math.floor(n / 100000);
    const thousands = Math.floor((n % 100000) / 1000);
    const hundreds = n % 1000;
    const parts: string[] = [];
    if (lakhs > 0) parts.push(`${convertTwoDigits(lakhs)} Lakh`);
    if (thousands > 0) parts.push(`${convertTwoDigits(thousands)} Thousand`);
    if (hundreds > 0) parts.push(convertThreeDigits(hundreds));
    return parts.join(' ').trim();
  }

  const rounded = Math.round(num * 100) / 100;
  const integerPart = Math.floor(Math.abs(rounded));
  const paise = Math.round((Math.abs(rounded) - integerPart) * 100);

  const crores = Math.floor(integerPart / 10000000);
  const remainder = integerPart % 10000000;

  let words = '';
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
    words = 'Zero';
  }

  words += integerPart === 1 ? ' Rupee' : ' Rupees';

  if (paise > 0) {
    words += ` and ${convertTwoDigits(paise)} Paise`;
  }

  words += ' Only';
  return words;
}
