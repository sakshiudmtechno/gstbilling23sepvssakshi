import { RecurringInvoice, RenewalRecord, RenewalStatus, RecurringPaymentStatus } from '../types';

/**
 * Padded number string
 */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format a Date to YYYY-MM-DD
 */
export function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Format date string (YYYY-MM-DD) to friendly display like "31 Oct 2026"
 */
export function formatDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const parts = dateStr.split('T')[0].split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      const year = parts[0];
      const monthIdx = parts[1] - 1;
      const day = parts[2];
      return `${pad(day)} ${MONTH_SHORT[monthIdx] || 'Jan'} ${year}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${pad(d.getDate())} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

/**
 * Calculate standard monthly service period:
 * Example:
 * 01 Oct 2026 -> Expiry 31 Oct 2026, Next Renewal 01 Nov 2026
 * 15 Oct 2026 -> Expiry 14 Nov 2026, Next Renewal 15 Nov 2026
 */
export function calculateMonthlyPeriod(startDateStr: string): {
  periodStartDate: string;
  currentExpiryDate: string;
  nextRenewalDate: string;
  periodName: string;
} {
  const parts = (startDateStr || formatISODate(new Date())).split('T')[0].split('-').map(Number);
  const startYear = parts[0];
  const startMonth = parts[1] - 1;
  const startDay = parts[2];

  let expiryDate: Date;
  let nextRenewalDate: Date;
  let periodName: string;

  if (startDay === 1) {
    // Standard calendar month
    // Last day of month is day 0 of next month
    expiryDate = new Date(startYear, startMonth + 1, 0);
    nextRenewalDate = new Date(startYear, startMonth + 1, 1);
    periodName = `${MONTH_NAMES[startMonth]} ${startYear}`;
  } else {
    // Rolling month: 1 month minus 1 day
    expiryDate = new Date(startYear, startMonth + 1, startDay - 1);
    nextRenewalDate = new Date(startYear, startMonth + 1, startDay);
    periodName = `${pad(startDay)} ${MONTH_SHORT[startMonth]} - ${pad(expiryDate.getDate())} ${MONTH_SHORT[expiryDate.getMonth()]} ${expiryDate.getFullYear()}`;
  }

  return {
    periodStartDate: formatISODate(new Date(startYear, startMonth, startDay)),
    currentExpiryDate: formatISODate(expiryDate),
    nextRenewalDate: formatISODate(nextRenewalDate),
    periodName
  };
}

/**
 * Calculate the next subsequent monthly renewal period given a current period's dates
 */
export function calculateNextMonthlyPeriod(currentExpiryDateStr: string, nextRenewalDateStr?: string): {
  periodStartDate: string;
  currentExpiryDate: string;
  nextRenewalDate: string;
  periodName: string;
} {
  const nextStart = nextRenewalDateStr || (() => {
    const expParts = currentExpiryDateStr.split('T')[0].split('-').map(Number);
    const d = new Date(expParts[0], expParts[1] - 1, expParts[2]);
    d.setDate(d.getDate() + 1);
    return formatISODate(d);
  })();

  return calculateMonthlyPeriod(nextStart);
}

export type RenewalDurationPreset = '1_month' | '3_months' | '6_months' | '12_months' | 'custom';

/**
 * Calculate multi-month renewal periods based on duration presets
 */
export function calculatePeriodByDurationPreset(
  currentExpiryDateStr: string,
  preset: RenewalDurationPreset,
  monthlyRate: number = 3000,
  nextRenewalDateStr?: string
): {
  periodStartDate: string;
  newExpiryDate: string;
  nextRenewalDate: string;
  periodName: string;
  calculatedAmount: number;
  monthsCount: number;
} {
  const nextStart = nextRenewalDateStr || (() => {
    if (!currentExpiryDateStr) return formatISODate(new Date());
    const expParts = currentExpiryDateStr.split('T')[0].split('-').map(Number);
    const d = new Date(expParts[0], expParts[1] - 1, expParts[2]);
    d.setDate(d.getDate() + 1);
    return formatISODate(d);
  })();

  const monthsMap: Record<RenewalDurationPreset, number> = {
    '1_month': 1,
    '3_months': 3,
    '6_months': 6,
    '12_months': 12,
    'custom': 1
  };

  const months = monthsMap[preset] || 1;
  const parts = nextStart.split('T')[0].split('-').map(Number);
  const startYear = parts[0];
  const startMonth = parts[1] - 1;
  const startDay = parts[2];

  let expiryDate: Date;
  let nextRenewalDate: Date;
  let periodName: string;

  if (startDay === 1) {
    expiryDate = new Date(startYear, startMonth + months, 0);
    nextRenewalDate = new Date(startYear, startMonth + months, 1);
    if (months === 1) {
      periodName = `${MONTH_NAMES[startMonth]} ${startYear}`;
    } else {
      periodName = `${MONTH_SHORT[startMonth]} ${startYear} - ${MONTH_SHORT[expiryDate.getMonth()]} ${expiryDate.getFullYear()}`;
    }
  } else {
    expiryDate = new Date(startYear, startMonth + months, startDay - 1);
    nextRenewalDate = new Date(startYear, startMonth + months, startDay);
    periodName = `${pad(startDay)} ${MONTH_SHORT[startMonth]} ${startYear} - ${pad(expiryDate.getDate())} ${MONTH_SHORT[expiryDate.getMonth()]} ${expiryDate.getFullYear()}`;
  }

  return {
    periodStartDate: nextStart,
    newExpiryDate: formatISODate(expiryDate),
    nextRenewalDate: formatISODate(nextRenewalDate),
    periodName,
    calculatedAmount: monthlyRate * months,
    monthsCount: months
  };
}

/**
 * Calculate next renewal date as the day after expiry date
 */
export function calculateNextRenewalFromExpiry(expiryDateStr: string): string {
  if (!expiryDateStr) return formatISODate(new Date());
  const expParts = expiryDateStr.split('T')[0].split('-').map(Number);
  const d = new Date(expParts[0], expParts[1] - 1, expParts[2]);
  d.setDate(d.getDate() + 1);
  return formatISODate(d);
}

/**
 * Automatically determine the renewal status based on expiry date and payment status
 * Statuses:
 * - Active
 * - Due Soon
 * - Expired
 * - Renewed
 * - Payment Pending
 */
export function determineRenewalStatus(
  currentExpiryDateStr?: string,
  paymentStatus?: RecurringPaymentStatus,
  todayStr?: string
): RenewalStatus {
  if (!currentExpiryDateStr) return 'active';

  const today = todayStr || formatISODate(new Date());
  const expiryParts = currentExpiryDateStr.split('T')[0].split('-').map(Number);
  const todayParts = today.split('T')[0].split('-').map(Number);

  const expiry = new Date(expiryParts[0], expiryParts[1] - 1, expiryParts[2]);
  const current = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);

  const diffTime = expiry.getTime() - current.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // If expiry date has passed
  if (diffDays < 0) {
    return 'expired';
  }

  // If payment is pending or partially paid
  if (paymentStatus === 'pending' || paymentStatus === 'partially_paid') {
    return 'payment_pending';
  }

  // If due within 7 days
  if (diffDays <= 7) {
    return 'due_soon';
  }

  return 'active';
}

/**
 * Days relative description
 */
export function getExpiryCountdown(currentExpiryDateStr?: string): {
  days: number;
  text: string;
  isOverdue: boolean;
} {
  if (!currentExpiryDateStr) return { days: 0, text: 'No expiry set', isOverdue: false };
  const today = formatISODate(new Date());
  const expParts = currentExpiryDateStr.split('T')[0].split('-').map(Number);
  const todayParts = today.split('T')[0].split('-').map(Number);

  const expiry = new Date(expParts[0], expParts[1] - 1, expParts[2]);
  const current = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);

  const diffTime = expiry.getTime() - current.getTime();
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return {
      days,
      text: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
      isOverdue: true
    };
  }
  if (days === 0) {
    return { days: 0, text: 'Expires Today', isOverdue: false };
  }
  if (days === 1) {
    return { days: 1, text: 'Expires Tomorrow', isOverdue: false };
  }
  return {
    days,
    text: `Expires in ${days} days`,
    isOverdue: false
  };
}

/**
 * UI Badges for Renewal Status
 */
export function getRenewalStatusBadge(status?: RenewalStatus | string): {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (status) {
    case 'due_soon':
      return {
        label: 'Due Soon',
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-200',
        dot: 'bg-amber-500'
      };
    case 'expired':
      return {
        label: 'Expired',
        bg: 'bg-rose-50',
        text: 'text-rose-700',
        border: 'border-rose-200',
        dot: 'bg-rose-500'
      };
    case 'renewed':
      return {
        label: 'Renewed',
        bg: 'bg-teal-50',
        text: 'text-teal-800',
        border: 'border-teal-200',
        dot: 'bg-teal-500'
      };
    case 'payment_pending':
      return {
        label: 'Payment Pending',
        bg: 'bg-orange-50',
        text: 'text-orange-800',
        border: 'border-orange-200',
        dot: 'bg-orange-500'
      };
    case 'active':
    default:
      return {
        label: 'Active',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        dot: 'bg-emerald-500'
      };
  }
}

/**
 * UI Badges for Payment Status
 */
export function getPaymentStatusBadge(status?: RecurringPaymentStatus | string): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-200'
      };
    case 'partially_paid':
      return {
        label: 'Partial',
        bg: 'bg-orange-50',
        text: 'text-orange-800',
        border: 'border-orange-200'
      };
    case 'paid':
    default:
      return {
        label: 'Paid',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200'
      };
  }
}
