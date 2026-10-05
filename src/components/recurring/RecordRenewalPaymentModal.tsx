import React, { useState, useMemo, useEffect } from 'react';
import { RecurringInvoice } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import {
  formatDisplayDate,
  calculatePeriodByDurationPreset,
  calculateNextRenewalFromExpiry,
  getRenewalStatusBadge,
  getPaymentStatusBadge,
  RenewalDurationPreset
} from '../../utils/recurringUtils';
import { api } from '../../utils/api';
import { toast } from '../common/Toast';
import {
  X,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  IndianRupee,
  ArrowRight,
  Clock,
  Sparkles,
  Info
} from 'lucide-react';

interface RecordRenewalPaymentModalProps {
  recurring: RecurringInvoice;
  preselectedPeriod?: {
    periodName: string;
    periodStartDate: string;
    periodEndDate: string;
    renewalAmount: number;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export const RecordRenewalPaymentModal: React.FC<RecordRenewalPaymentModalProps> = ({
  recurring,
  preselectedPeriod,
  onClose,
  onSuccess
}) => {
  const monthlyRate = Number(recurring.monthlyRenewalAmount || 3000);
  const baseExpiry = recurring.currentExpiryDate || recurring.startDate || new Date().toISOString().split('T')[0];

  // Duration preset: 1_month, 3_months, 6_months, 12_months, custom
  const [durationPreset, setDurationPreset] = useState<RenewalDurationPreset>('1_month');

  // Initial calculation using 1 month preset
  const initialCalculated = useMemo(() => {
    if (preselectedPeriod) {
      return {
        periodName: preselectedPeriod.periodName,
        periodStartDate: preselectedPeriod.periodStartDate,
        newExpiryDate: preselectedPeriod.periodEndDate,
        nextRenewalDate: calculateNextRenewalFromExpiry(preselectedPeriod.periodEndDate),
        calculatedAmount: preselectedPeriod.renewalAmount
      };
    }
    return calculatePeriodByDurationPreset(baseExpiry, '1_month', monthlyRate, recurring.nextRenewalDate);
  }, [baseExpiry, monthlyRate, preselectedPeriod, recurring.nextRenewalDate]);

  const [periodStartDate, setPeriodStartDate] = useState<string>(initialCalculated.periodStartDate);
  const [periodEndDate, setPeriodEndDate] = useState<string>(initialCalculated.newExpiryDate);
  const [periodName, setPeriodName] = useState<string>(initialCalculated.periodName);
  const [renewalAmount, setRenewalAmount] = useState<number>(initialCalculated.calculatedAmount);

  // Payment Recording state
  const [isPaymentRecorded, setIsPaymentRecorded] = useState<boolean>(true);
  const [paymentAmount, setPaymentAmount] = useState<number>(initialCalculated.calculatedAmount);
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partially_paid' | 'pending'>('paid');
  const [paymentMethod, setPaymentMethod] = useState<string>('UPI / QR');
  const [referenceId, setReferenceId] = useState<string>(`UPI-${Date.now().toString().slice(-6)}`);
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Live Next Renewal Date preview (day after new expiry date)
  const calculatedNextRenewal = useMemo(() => {
    return calculateNextRenewalFromExpiry(periodEndDate);
  }, [periodEndDate]);

  // Handle Preset duration selection
  const handleSelectPreset = (preset: RenewalDurationPreset) => {
    setDurationPreset(preset);
    if (preset === 'custom') return;

    const calc = calculatePeriodByDurationPreset(baseExpiry, preset, monthlyRate, recurring.nextRenewalDate);
    setPeriodStartDate(calc.periodStartDate);
    setPeriodEndDate(calc.newExpiryDate);
    setPeriodName(calc.periodName);
    setRenewalAmount(calc.calculatedAmount);

    if (isPaymentRecorded) {
      setPaymentAmount(calc.calculatedAmount);
      setPaymentStatus('paid');
    }
  };

  // Handle Manual Expiry Date Change
  const handleExpiryDateChange = (newDate: string) => {
    setPeriodEndDate(newDate);
    setDurationPreset('custom');
  };

  // Handle Payment Amount Change & Auto-sync Payment Status
  const handlePaymentAmountChange = (val: number) => {
    setPaymentAmount(val);
    if (val >= renewalAmount && renewalAmount > 0) {
      setPaymentStatus('paid');
    } else if (val > 0) {
      setPaymentStatus('partially_paid');
    } else {
      setPaymentStatus('pending');
    }
  };

  // Handle Payment Toggle
  const handleTogglePayment = (checked: boolean) => {
    setIsPaymentRecorded(checked);
    if (!checked) {
      setPaymentStatus('pending');
      setPaymentAmount(0);
    } else {
      setPaymentAmount(renewalAmount);
      setPaymentStatus('paid');
    }
  };

  // Badges for current context
  const currentRenewalBadge = getRenewalStatusBadge(recurring.renewalStatus);
  const currentPaymentBadge = getPaymentStatusBadge(recurring.paymentStatus);

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!periodEndDate) {
      toast.error('Please specify a valid New Expiry Date');
      return;
    }

    if (isPaymentRecorded && paymentAmount < 0) {
      toast.error('Payment amount cannot be negative');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: any = {
        renewalPeriod: periodName.trim() || `Renewal to ${formatDisplayDate(periodEndDate)}`,
        periodStartDate,
        periodEndDate,
        nextRenewalDate: calculatedNextRenewal,
        renewalAmount: Number(renewalAmount),
        paymentAmount: isPaymentRecorded ? Number(paymentAmount) : 0,
        notes: notes.trim(),
        paymentStatus: isPaymentRecorded ? paymentStatus : 'pending',
        recordPayment: isPaymentRecorded
      };

      if (isPaymentRecorded) {
        payload.paymentDate = paymentDate;
        payload.paymentMethod = paymentMethod;
        payload.referenceId = referenceId.trim();
      }

      await api.recordRenewalPayment(recurring.id, payload);

      toast.success(
        isPaymentRecorded
          ? `Renewal updated & payment of ${formatINR(paymentAmount)} recorded for ${recurring.clientName || 'Client'}!`
          : `Renewal expiry updated to ${formatDisplayDate(periodEndDate)} for ${recurring.clientName || 'Client'}!`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update renewal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200 my-8 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-teal-500/20 text-teal-400 rounded-lg">
                <Calendar className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold tracking-tight">Renewal / Update Expiry Date</h2>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Client: <span className="font-semibold text-white">{recurring.clientName || recurring.client?.name || 'Client'}</span>
              {' '}• {recurring.serviceName || recurring.title || 'Monthly AMC'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Status & Information Context Bar (Requirement 1) */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <div>
              <span className="text-[11px] text-slate-500 block">Current Expiry</span>
              <span className="font-bold font-mono text-slate-900">
                {formatDisplayDate(recurring.currentExpiryDate)}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-200 hidden sm:block" />
            <div>
              <span className="text-[11px] text-slate-500 block">Monthly Rate</span>
              <span className="font-bold font-mono text-slate-900">
                {formatINR(monthlyRate)} / mo
              </span>
            </div>
            <div className="h-6 w-px bg-slate-200 hidden sm:block" />
            <div>
              <span className="text-[11px] text-slate-500 block">Current Status</span>
              <span className={`inline-flex items-center gap-1 font-semibold ${currentRenewalBadge.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${currentRenewalBadge.dot}`} />
                {currentRenewalBadge.label}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-200 hidden sm:block" />
            <div>
              <span className="text-[11px] text-slate-500 block">Payment</span>
              <span className={`font-semibold ${currentPaymentBadge.text}`}>
                {currentPaymentBadge.label}
              </span>
            </div>
          </div>
        </div>

        {/* Protection Banner (Requirement 5) */}
        <div className="bg-teal-50 border-b border-teal-100 px-6 py-2 text-[11px] text-teal-900 flex items-center gap-2 shrink-0">
          <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
          <span>
            <strong>Payment Separation Protected:</strong> Renewal payments are isolated as <em>Renewal Payment</em> and will <strong>never</strong> modify original project/deal balances.
          </span>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
          {/* Section: Point 3 - Renewal Duration Presets (Requirement 3) */}
          <div className="space-y-2 p-3 bg-slate-50/80 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <label className="block font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <span className="px-2 py-0.5 bg-teal-800 text-white rounded font-mono text-[10px] uppercase font-bold">
                  Point 3
                </span>
                <span>Renewal Period / अवधि चुनें</span>
              </label>
              <span className="text-[11px] text-teal-800 font-medium">
                Auto-calculates New Expiry Date
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              {[
                { id: '1_month', label: '1 Month', desc: '1 Cycle' },
                { id: '3_months', label: '3 Months', desc: 'Quarterly' },
                { id: '6_months', label: '6 Months', desc: 'Half-Yearly' },
                { id: '12_months', label: '12 Months', desc: 'Annual AMC' },
                { id: 'custom', label: 'Custom', desc: 'Custom Date' }
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => handleSelectPreset(btn.id as RenewalDurationPreset)}
                  className={`px-3 py-2 rounded-xl text-center border transition-all cursor-pointer ${
                    durationPreset === btn.id
                      ? 'bg-teal-800 text-white border-teal-900 shadow-2xs font-bold ring-2 ring-teal-600/30'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 font-medium'
                  }`}
                >
                  <div className="text-xs">{btn.label}</div>
                  <div className={`text-[10px] ${durationPreset === btn.id ? 'text-teal-200' : 'text-slate-400'}`}>
                    {btn.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Section: Point 2 - Expiry Date & Renewal Dates (Requirement 2) */}
          <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200">
              <span className="px-2 py-0.5 bg-slate-800 text-white rounded font-mono text-[10px] uppercase font-bold">
                Point 2
              </span>
              <span className="font-bold text-slate-900 text-xs">New Expiry Date & Period Setup</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Period Start */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Period Start Date</label>
                <input
                  type="date"
                  required
                  value={periodStartDate}
                  onChange={(e) => setPeriodStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                />
              </div>

              {/* New Expiry Date */}
              <div>
                <label className="block font-bold text-teal-950 mb-1 flex items-center justify-between">
                  <span>New Expiry Date <span className="text-rose-500">*</span></span>
                  {durationPreset !== 'custom' && (
                    <span className="text-[10px] font-normal text-teal-800 bg-teal-100/60 px-1.5 py-0.2 rounded">
                      Auto-calculated
                    </span>
                  )}
                </label>
                <input
                  type="date"
                  required
                  value={periodEndDate}
                  onChange={(e) => handleExpiryDateChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border-2 border-teal-600 rounded-lg text-xs font-mono font-bold text-teal-950 focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden shadow-2xs"
                />
              </div>

              {/* Renewal Period Label */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Renewal Period Label</label>
                <input
                  type="text"
                  required
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  placeholder="e.g. November 2026"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                />
              </div>
            </div>

            {/* Next Renewal Date Preview */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
              <span className="text-slate-600 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-teal-700" />
                Following Next Renewal Date:
              </span>
              <span className="font-bold font-mono text-teal-900 bg-white px-2 py-0.5 rounded border border-teal-200">
                {formatDisplayDate(calculatedNextRenewal)}
              </span>
            </div>
          </div>

          {/* Section: Point 4 - Payment Action Selector & Checkbox (Requirement 4) */}
          <div className={`border-2 rounded-2xl p-4 space-y-3.5 transition-all shadow-2xs ${
            isPaymentRecorded
              ? 'bg-white border-teal-300 ring-2 ring-teal-600/10'
              : 'bg-amber-50/80 border-amber-300'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-teal-800 text-white rounded font-mono text-[10px] uppercase font-bold">
                  Point 4
                </span>
                <div>
                  <span className="font-bold text-slate-900 text-xs block">
                    Payment Details / भुगतान विकल्प
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Record payment now or extend expiry date only
                  </span>
                </div>
              </div>

              {/* Segmented Buttons */}
              <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 gap-1 shrink-0">
                <button
                  type="button"
                  id="btn-enable-payment"
                  onClick={() => handleTogglePayment(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isPaymentRecorded
                      ? 'bg-teal-800 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Record Payment</span>
                </button>

                <button
                  type="button"
                  id="btn-disable-payment"
                  onClick={() => handleTogglePayment(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    !isPaymentRecorded
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Extend Expiry Only (No Payment)</span>
                </button>
              </div>
            </div>

            {/* Direct Interactive Checkbox Toggle */}
            <div
              onClick={() => handleTogglePayment(!isPaymentRecorded)}
              className="p-2.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 cursor-pointer flex items-center gap-3 transition-colors"
            >
              <input
                type="checkbox"
                id="modal-payment-checkbox"
                checked={isPaymentRecorded}
                onChange={(e) => handleTogglePayment(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="w-5 h-5 text-teal-700 rounded border-slate-300 focus:ring-teal-700 cursor-pointer shrink-0"
              />
              <label
                htmlFor="modal-payment-checkbox"
                className="text-xs font-semibold text-slate-800 cursor-pointer select-none flex-1 flex items-center justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <span>
                  {isPaymentRecorded
                    ? 'Payment is being recorded for this cycle (Uncheck to extend expiry only)'
                    : 'Extend expiry date only — no payment recorded (Check to add payment)'}
                </span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                  isPaymentRecorded ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {isPaymentRecorded ? 'Payment: ON' : 'Payment: OFF'}
                </span>
              </label>
            </div>

            {isPaymentRecorded ? (
              <div className="space-y-3 pt-1">
                {/* Amounts & Payment Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Renewal Amount (₹) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      required
                      value={renewalAmount}
                      onChange={(e) => setRenewalAmount(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold text-slate-900 focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Amount (₹) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={paymentAmount}
                      onChange={(e) => handlePaymentAmountChange(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-teal-50/50 border border-teal-300 rounded-lg text-xs font-mono font-bold text-teal-950 focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Status <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden cursor-pointer"
                    >
                      <option value="paid">Paid (Full Settlement)</option>
                      <option value="partially_paid">Partial Payment</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>
                </div>

                {/* Method, Date, Reference */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Method <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden cursor-pointer"
                    >
                      <option value="UPI / QR">UPI / QR (GPay, PhonePe, Paytm)</option>
                      <option value="Bank Transfer">Bank Transfer (NEFT / IMPS / RTGS)</option>
                      <option value="Cash">Cash</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Card / Razorpay">Card / Razorpay</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Transaction / Reference ID
                    </label>
                    <input
                      type="text"
                      value={referenceId}
                      onChange={(e) => setReferenceId(e.target.value)}
                      placeholder="e.g. UPI-TXN-12345"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Notes / Remarks</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Monthly AMC renewal paid via UPI"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                  />
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-xs text-amber-800 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <Info className="w-4 h-4 text-amber-600" />
                  No Payment Recorded
                </div>
                <p className="text-[11px] text-amber-700">
                  The client expiry date will be updated to <strong>{formatDisplayDate(periodEndDate)}</strong> without recording a payment transaction. The cycle will be registered in renewal history as <strong>Pending</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Modal Footer (Requirement 6) */}
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors cursor-pointer text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white font-bold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer text-xs"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSubmitting ? 'Updating Renewal...' : 'Update Renewal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
