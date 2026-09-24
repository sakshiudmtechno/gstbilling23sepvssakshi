export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'accountant';
}

export interface BusinessProfile {
  businessName: string;
  legalName?: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  pinCode: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  signatureUrl?: string;
  authorizedSignatoryName?: string;

  // Banking & UPI
  bankName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  ifscCode?: string;
  branch?: string;
  upiId?: string;
  qrCodeUrl?: string;
  upiQrImageUrl?: string;

  // Invoicing Preferences
  defaultTerms?: string;
  defaultCustomerNotes?: string;
  invoicePrefix?: string;
  invoiceStartingNumber?: number;
  invoiceTemplate?: 'classic' | 'modern' | 'minimal';
}

export interface Client {
  id: string;
  clientNumber?: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  billingAddress: string;
  shippingAddress?: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  pinCode: string;
  gstin: string;
  pan: string;
  customerType: 'B2B' | 'B2C' | 'SEZ' | 'Export';
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InvoiceItem {
  id: string;
  name: string;
  description?: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  rate: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGstAmount: number;
  total: number;
}

export interface AdditionalCharge {
  id: string;
  name: string; // e.g. Shipping, Installation, Delivery
  amount: number;
  gstApplicable: boolean;
  gstRate?: number;
  gstAmount?: number;
}

export interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'Cash' | 'Bank Transfer' | 'UPI' | 'Razorpay' | 'Cheque' | 'Other';
  transactionId?: string;
  notes?: string;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type InvoiceTemplateType = 'classic' | 'modern' | 'minimal';

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. A000345
  poNumber?: string;
  invoiceDate: string;
  dueDate: string;
  placeOfSupply: string;
  placeOfSupplyCode: string;
  currency: string;
  financialYear: string; // e.g. FY 2026-27
  isInterState: boolean;
  status: InvoiceStatus;
  template: InvoiceTemplateType;

  // Service / Billing Period (30 days cycle)
  billingStartDate?: string;
  billingEndDate?: string;
  billingPeriod?: string;

  // Billed by snapshot
  seller: BusinessProfile;

  // Billed to snapshot
  clientId: string;
  client: Client;

  // Shipping details
  hasShippingAddress?: boolean;
  shippingName?: string;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingStateCode?: string;
  shippingCountry?: string;
  shippingPinCode?: string;
  shippingGstin?: string;

  // Items
  items: InvoiceItem[];

  // Global discount
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  discountAmount: number;

  // Additional charges
  additionalCharges: AdditionalCharge[];

  // Totals
  subtotal: number;
  totalItemDiscount: number;
  totalTaxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  totalAdditionalCharges: number;
  roundOff: number;
  grandTotal: number;
  totalInWords: string;

  // Payment Tracking
  advanceAmount?: number;
  amountPaid: number;
  balanceDue: number;
  payments: InvoicePayment[];

  // Bank & UPI options
  showBankDetails: boolean;
  showUpiQr: boolean;

  // Notes & terms
  terms: string;
  customerNotes?: string;
  internalNotes?: string;

  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem extends InvoiceItem {}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';

export interface Quote {
  id: string;
  quoteNumber: string; // e.g. Q000101
  quoteType?: string;
  quoteDate: string;
  validUntil: string;
  placeOfSupply: string;
  placeOfSupplyCode: string;
  currency: string;
  financialYear?: string;
  isInterState?: boolean;
  status: QuoteStatus;
  template?: InvoiceTemplateType;

  seller?: BusinessProfile;
  clientId: string;
  client: Client;

  items: QuoteItem[];
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  discountAmount?: number;
  additionalCharges?: AdditionalCharge[];

  subtotal: number;
  totalTaxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  roundOff?: number;
  grandTotal: number;
  totalInWords: string;

  terms: string;
  notes?: string;

  convertedToInvoiceId?: string;
  convertedToInvoiceNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreditNoteItem {
  id: string;
  name: string;
  hsnSac: string;
  quantity: number;
  rate: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  total: number;
}

export interface CreditNote {
  id: string;
  creditNoteNumber: string; // e.g. CN-001
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  client?: Client;
  clientName?: string;
  date: string;
  reason: string;
  items?: CreditNoteItem[];
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
  status?: string;
  notes?: string;
  createdAt?: string;
}

export interface RecurringInvoice {
  id: string;
  title?: string;
  recurringNumber?: string;
  clientId: string;
  client?: Client;
  clientName?: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  startDate: string;
  endDate?: string;
  nextInvoiceDate?: string;
  nextDueDate?: string;
  nextRunDate?: string;
  lastGeneratedInvoiceId?: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  items?: InvoiceItem[];
  invoiceTemplateData?: any;
  terms?: string;
  autoSendEmail?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Expense {
  id: string;
  title?: string;
  expenseDate?: string;
  date?: string;
  vendor?: string;
  vendorName?: string;
  vendorGstin?: string;
  category: string;
  description?: string;
  amount: number;
  taxAmount?: number;
  gstAmount: number;
  totalAmount: number;
  paymentMode?: string;
  paymentMethod?: string;
  itcEligible?: boolean;
  isTaxDeductible?: boolean;
  invoiceNumber?: string;
  receiptUrl?: string;
  notes?: string;
  createdAt?: string;
}

export interface InvoiceSettings {
  prefix: string;
  startingNumber: number;
  numberPadding: number;
  nextSequence: number;
  defaultCurrency: string;
  defaultGstRate: number;
  defaultPaymentTerms: string;
  defaultNotes: string;
}

export interface TaxSettings {
  gstRegistrationState: string;
  gstRegistrationStateCode: string;
  businessGstin: string;
  businessPan: string;
  defaultRates: number[];
  commonHsnSac: Array<{ code: string; description: string; defaultGst: number }>;
}

export interface PaymentSettings {
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  upiId: string;
  enableUpiQr: boolean;
}

export interface PdfSettings {
  defaultTemplate: InvoiceTemplateType;
  accentColor: string;
  showLogo: boolean;
  showSignature: boolean;
  showBankDetails: boolean;
  showUpiQr: boolean;
  showTotalInWords: boolean;
  footerText: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  performedBy?: string;
  user?: string;
  details?: string;
  timestamp: string;
}

export interface DealServiceItem {
  id?: string;
  serviceName: string;
  managementFee: number;
  managementFeePaid: number;
  adBudget: number;
  adBudgetPaid: number;
  dealValue?: number;
  totalReceived?: number;
  totalDue?: number;
}

export interface CustomerOnboarding {
  id: string;
  onboardingNumber: string; // e.g. ONB-001
  clientId?: string;
  customerName: string;
  businessName: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  city?: string;
  state?: string;
  
  // Status
  status: 'active' | 'inactive' | 'paused' | 'completed';
  
  // Dates & 30-Day Billing Cycle
  onboardingDate: string; // YYYY-MM-DD
  billingCycleDays: number; // default 30
  nextPaymentDueDate: string; // YYYY-MM-DD
  lastRenewalDate?: string;
  
  // Service package & Multi-Service support
  servicePackage: string; // e.g. "Social Media Management, Google Ads"
  services?: DealServiceItem[]; // Repeatable services under a single deal
  
  // Meta & Google Ads Campaign Tracking
  hasAdsCampaign: boolean;
  adPlatform: 'meta' | 'google' | 'both' | 'none';
  adDailyBudget: number; // ₹/day
  adDurationDays: number; // e.g. 15 or 30 days
  adTotalBudget: number; // calculated ad budget
  adCampaignStartDate?: string;
  adCampaignEndDate?: string;
  
  // Invoice link
  invoiceId?: string;
  invoiceNumber?: string;

  // Financials & Payment Terms: Separated Management Fee and Ad Budget
  serviceFee: number; // Monthly management/retainer fee
  managementFee?: number; // Alias for serviceFee
  managementFeePaid?: number; // How much management fee received
  
  adBudget?: number; // Alias for adTotalBudget
  adBudgetPaid: number; // How much ad budget received
  
  totalPackageValue: number; // Total Deal Value (serviceFee + adTotalBudget)
  totalDealValue?: number; // Alias for totalPackageValue
  advancePaid: number; // Total payment received so far (mgmt + ad)
  totalReceived?: number; // Alias for advancePaid
  remainingBalance: number; // Total Due (totalPackageValue - advancePaid)
  totalDue?: number; // Alias for remainingBalance
  paymentStatus: 'paid' | 'partially_paid' | 'overdue' | 'unpaid';
  paymentHistory?: Array<{
    id: string;
    date: string;
    amount: number;
    type: 'advance' | 'balance' | 'ad_topup' | 'full' | 'mgmt_fee' | 'ad_budget';
    paymentMethod: string;
    notes?: string;
  }>;
  
  // Sales Manager Tracking
  assignedExecutive?: string; // Sales / Closer person (Mahendra, Sankalp, etc.)
  salesManager?: string; // Alias for assignedExecutive
  incentivePercentage: number; // e.g. 10%
  incentiveAmount: number; // e.g. ₹1,500
  incentiveStatus: 'pending' | 'eligible' | 'paid';
  
  // Calculated Runtime Properties
  isPaymentOverdue?: boolean;
  daysUntilPaymentDue?: number;
  isAdExpired?: boolean;
  daysUntilAdExpiry?: number;
  
  notes?: string;
  remarks?: string; // Alias for notes
  monthYear: string; // e.g. "2026-09" for month-wise reporting
  createdAt: string;
  updatedAt?: string;
}

