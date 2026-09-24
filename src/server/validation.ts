import { z } from 'zod';

const nullableString = z.preprocess((val) => {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}, z.string());

const sanitizedEmail = z.preprocess((val) => {
  if (!val || typeof val !== 'string') return '';
  return val.trim();
}, z.string().optional().default(''));

export const ClientSchema = z.object({
  name: z.preprocess((val) => String(val || '').trim(), z.string().min(1, 'Client name is required')),
  contactPerson: nullableString.default(''),
  email: sanitizedEmail,
  phone: nullableString.default(''),
  billingAddress: nullableString.default(''),
  shippingAddress: nullableString.default(''),
  city: nullableString.default(''),
  state: z.preprocess((val) => String(val || 'Madhya Pradesh').trim(), z.string().default('Madhya Pradesh')),
  stateCode: z.preprocess((val) => {
    if (!val) return '23';
    return String(val).trim().padStart(2, '0');
  }, z.string().default('23')),
  country: nullableString.default('India'),
  pinCode: nullableString.default(''),
  gstin: nullableString.default(''),
  pan: nullableString.default(''),
  customerType: z.preprocess((val) => {
    if (!val || typeof val !== 'string') return 'B2B';
    const upper = val.toUpperCase().trim();
    if (['B2B', 'B2C', 'SEZ', 'EXPORT'].includes(upper)) {
      return upper === 'EXPORT' ? 'Export' : (upper as 'B2B' | 'B2C' | 'SEZ');
    }
    return 'B2B';
  }, z.enum(['B2B', 'B2C', 'SEZ', 'Export']).default('B2B')),
  notes: nullableString.default('')
}).passthrough();

export const LineItemSchema = z.object({
  id: z.string().optional(),
  name: z.preprocess((val) => String(val || '').trim(), z.string().min(1, 'Item name is required')),
  description: z.string().optional().default(''),
  hsnSac: z.string().optional().default('9983'),
  quantity: z.preprocess((val) => Number(val) || 1, z.number().min(0.001, 'Quantity must be greater than 0')),
  unit: z.string().optional().default('NOS'),
  rate: z.preprocess((val) => Number(val) || 0, z.number().min(0, 'Rate cannot be negative')),
  discountType: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  discountValue: z.number().optional().default(0),
  discountAmount: z.number().optional().default(0),
  gstRate: z.number().optional().default(0)
}).passthrough();

export const AdditionalChargeSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  amount: z.number(),
  gstRate: z.number().optional().default(0)
}).passthrough();

export const InvoiceSchema = z.object({
  invoiceNumber: z.string().optional(),
  poNumber: z.string().optional().default(''),
  invoiceDate: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date().toISOString().split('T')[0],
    z.string().default(new Date().toISOString().split('T')[0])
  ),
  dueDate: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
    z.string().default(new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0])
  ),
  billingStartDate: z.string().optional(),
  billingEndDate: z.string().optional(),
  billingPeriod: z.string().optional(),
  placeOfSupply: z.string().optional().default('Madhya Pradesh'),
  placeOfSupplyCode: z.string().optional().default('23'),
  currency: z.string().optional().default('INR'),
  financialYear: z.string().optional(),
  isInterState: z.boolean().optional(),
  isReverseCharge: z.boolean().optional().default(false),
  status: z.enum(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled']).optional().default('draft'),
  template: z.string().optional().default('classic'),
  clientId: z.string().optional(),
  client: z.any().optional(),
  items: z.array(LineItemSchema).min(1, 'At least one line item is required'),
  discountType: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  discountValue: z.number().optional().default(0),
  additionalCharges: z.array(AdditionalChargeSchema).optional().default([]),
  advanceAmount: z.number().optional().default(0),
  terms: z.string().optional().default(''),
  customerNotes: z.string().optional().default(''),
  internalNotes: z.string().optional().default('')
}).passthrough();

export const QuoteSchema = z.object({
  quoteNumber: z.string().optional(),
  quoteDate: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date().toISOString().split('T')[0],
    z.string().default(new Date().toISOString().split('T')[0])
  ),
  validUntil: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    z.string().default(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0])
  ),
  placeOfSupply: z.string().optional().default('Madhya Pradesh'),
  placeOfSupplyCode: z.string().optional().default('23'),
  currency: z.string().optional().default('INR'),
  clientId: z.string().optional(),
  client: z.any().optional(),
  items: z.array(LineItemSchema).min(1),
  discountType: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  discountValue: z.number().optional().default(0),
  additionalCharges: z.array(AdditionalChargeSchema).optional().default([]),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'converted']).optional().default('draft'),
  terms: z.string().optional().default(''),
  notes: z.string().optional().default('')
}).passthrough();

export const CreditNoteSchema = z.object({
  creditNoteNumber: z.string().optional(),
  creditNoteDate: z.string().optional(),
  date: z.string().optional(),
  invoiceId: z.string().min(1, 'Linked invoice ID is required'),
  invoiceNumber: z.string().optional(),
  clientId: z.string().optional(),
  client: z.any().optional(),
  reason: z.string().min(1, 'Reason for credit note is required'),
  items: z.array(z.any()).optional().default([]),
  taxableAmount: z.number().optional().default(0),
  totalAmount: z.number().min(0),
  taxAmount: z.number().optional().default(0),
  gstAmount: z.number().optional().default(0),
  status: z.string().optional().default('active'),
  notes: z.string().optional().default('')
}).passthrough();

export const RecurringInvoiceSchema = z.object({
  title: z.string().optional().default('Recurring AMC & Retainer'),
  recurringNumber: z.string().optional(),
  clientId: z.string().min(1, 'Client ID is required'),
  clientName: z.string().optional(),
  client: z.any().optional(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']).default('monthly'),
  startDate: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date().toISOString().split('T')[0],
    z.string().default(new Date().toISOString().split('T')[0])
  ),
  endDate: z.string().optional(),
  nextInvoiceDate: z.string().optional(),
  nextDueDate: z.string().optional(),
  status: z.enum(['active', 'paused', 'cancelled', 'completed']).default('active'),
  items: z.array(LineItemSchema).min(1, 'At least one line item is required'),
  invoiceTemplateData: z.any().optional(),
  terms: z.string().optional().default(''),
  autoSendEmail: z.boolean().optional().default(false)
}).passthrough();

export const ExpenseSchema = z.object({
  date: z.preprocess(
    (val) => (val && typeof val === 'string' && val.trim()) ? val.trim() : new Date().toISOString().split('T')[0],
    z.string().default(new Date().toISOString().split('T')[0])
  ),
  category: z.string().min(1, 'Category is required'),
  title: nullableString.default(''),
  description: z.preprocess((val) => {
    if (val === null || val === undefined) return '';
    return String(val).trim();
  }, z.string().optional().default('')),
  amount: z.number().min(0, 'Amount must be positive'),
  taxAmount: z.number().optional().default(0),
  gstAmount: z.number().optional().default(0),
  totalAmount: z.number().min(0),
  paymentMethod: z.string().optional().default('UPI'),
  paymentMode: z.string().optional().default('Bank'),
  vendor: z.string().optional().default(''),
  vendorName: z.string().optional().default(''),
  vendorGstin: z.string().optional().default(''),
  invoiceNumber: z.string().optional().default(''),
  receiptUrl: z.string().optional().default(''),
  isTaxDeductible: z.boolean().optional().default(true),
  itcEligible: z.boolean().optional().default(true),
  notes: z.string().optional().default('')
}).passthrough();

export const DealServiceItemSchema = z.object({
  id: z.string().optional(),
  serviceName: z.string().optional().default(''),
  service: z.string().optional(),
  managementFee: z.number().optional().default(0),
  managementFeePaid: z.number().optional().default(0),
  adBudget: z.number().optional().default(0),
  adBudgetPaid: z.number().optional().default(0),
  dealValue: z.number().optional().default(0),
  totalReceived: z.number().optional().default(0),
  totalDue: z.number().optional().default(0)
}).passthrough();

export const OnboardingSchema = z.object({
  onboardingNumber: z.string().optional(),
  clientId: z.string().nullable().optional(),
  customerName: z.preprocess((val) => String(val || '').trim(), z.string().min(1, 'Customer name is required')),
  businessName: z.preprocess((val) => String(val || '').trim(), z.string().min(1, 'Business name is required')),
  contactPerson: z.string().optional().default(''),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  city: z.string().optional().default('Indore'),
  state: z.string().optional().default('Madhya Pradesh'),
  status: z.enum(['active', 'paused', 'completed', 'churned']).optional().default('active'),
  onboardingDate: z.string().optional(),
  billingCycleDays: z.number().optional().default(30),
  nextPaymentDueDate: z.string().optional(),
  servicePackage: z.string().optional().default('Meta Ads & Lead Gen Retainer'),
  services: z.array(DealServiceItemSchema).optional(),
  hasAdsCampaign: z.boolean().optional().default(false),
  adPlatform: z.enum(['meta', 'google', 'both', 'other']).optional().default('meta'),
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
  paymentStatus: z.enum(['paid', 'partially_paid', 'overdue', 'unpaid']).optional(),
  assignedExecutive: z.string().optional().default('Sankalp'),
  salesManager: z.string().optional().default('Sankalp'),
  incentivePercentage: z.number().optional().default(10),
  incentiveAmount: z.number().optional(),
  incentiveStatus: z.enum(['pending', 'eligible', 'paid']).optional().default('pending'),
  remarks: z.string().optional().default(''),
  notes: z.string().optional().default('')
}).passthrough();

export const PaymentRecordSchema = z.object({
  amount: z.number().min(0.01, 'Payment amount must be greater than zero'),
  paymentDate: z.string().optional(),
  paymentMethod: z.string().optional().default('UPI'),
  transactionId: z.string().optional().default(''),
  notes: z.string().optional().default('')
}).passthrough();
