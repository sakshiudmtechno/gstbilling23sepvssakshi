import React, { useState } from 'react';
import { CustomerOnboarding } from '../../types';
import { api } from '../../utils/api';
import { X, CheckCircle2, IndianRupee, Calendar, CreditCard } from 'lucide-react';

interface OnboardingPaymentModalProps {
  onboarding: CustomerOnboarding;
  onClose: () => void;
  onSuccess: (updated?: CustomerOnboarding) => void;
  onRecordPayment?: (id: string, paymentData: any) => Promise<CustomerOnboarding>;
}

export const OnboardingPaymentModal: React.FC<OnboardingPaymentModalProps> = ({
  onboarding,
  onClose,
  onSuccess,
  onRecordPayment
}) => {
  const currentDue = onboarding.remainingBalance ?? Math.max(0, (onboarding.totalPackageValue || 0) - (onboarding.advancePaid || 0));
  const [amount, setAmount] = useState<number>(currentDue || 0);
  const [paymentMethod, setPaymentMethod] = useState<string>('UPI');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('Payment received');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const formatINR = (val: number) => {
    return '₹' + Math.round(val || 0).toLocaleString('en-IN');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0) {
      setError('Please enter a valid payment amount greater than 0.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const paymentData = {
        amount: Number(amount),
        paymentMethod,
        type: 'balance',
        notes,
        date: paymentDate
      };

      if (onRecordPayment) {
        const updated = await onRecordPayment(onboarding.id, paymentData);
        onSuccess(updated);
      } else {
        const updated = await api.recordOnboardingPayment(onboarding.id, paymentData);
        onSuccess(updated);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Record Received Payment</h3>
              <p className="text-[11px] text-slate-300">{onboarding.businessName || onboarding.customerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Balance Overview Card */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-1.5 text-xs">
          <div className="flex justify-between items-center text-slate-600">
            <span>Total Deal Value:</span>
            <span className="font-bold text-slate-900">{formatINR(onboarding.totalDealValue || onboarding.totalPackageValue || onboarding.serviceFee || 0)}</span>
          </div>
          {(onboarding.managementFee || onboarding.serviceFee) && (
            <div className="flex justify-between items-center text-indigo-900 text-[11px] pl-2 border-l-2 border-indigo-200">
              <span>Management Fee:</span>
              <span className="font-semibold">{formatINR(onboarding.managementFee || onboarding.serviceFee || 0)}</span>
            </div>
          )}
          {Boolean(onboarding.adBudget || onboarding.adTotalBudget) && (
            <div className="flex justify-between items-center text-blue-900 text-[11px] pl-2 border-l-2 border-blue-200">
              <span>Ad Budget:</span>
              <span className="font-semibold">{formatINR(onboarding.adBudget || onboarding.adTotalBudget || 0)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-slate-600">
            <span>Total Received So Far:</span>
            <span className="font-semibold text-emerald-700">{formatINR(onboarding.advancePaid || 0)}</span>
          </div>
          <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
            <span className="font-bold text-slate-900">Current Total Due:</span>
            <span className="font-extrabold text-sm text-amber-700">{formatINR(currentDue)}</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Payment Amount (₹)</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 font-bold text-slate-400">₹</span>
              <input
                type="number"
                min={1}
                max={currentDue > 0 ? currentDue : undefined}
                step="any"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                placeholder="0"
                required
              />
            </div>
            {currentDue > 0 && (
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setAmount(currentDue)}
                  className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded cursor-pointer"
                >
                  Pay Full Due ({formatINR(currentDue)})
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium"
              >
                <option value="UPI">UPI / GPay / PhonePe</option>
                <option value="Bank Transfer">Bank Transfer (NEFT/IMPS)</option>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Date</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Remarks / Reference</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. UPI Ref / Cash / Installment 2"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Recording...' : `Record Payment (${formatINR(amount)})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
