import React, { useState, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { Invoice, PaymentType } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import {
  X,
  CheckCircle,
  CreditCard,
  Banknote,
  QrCode,
  Building,
  Receipt,
  FileText,
  User,
  Layers,
  History,
  Info
} from 'lucide-react';

interface RecordPaymentModalProps {
  invoice: Invoice;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (paymentData: {
    amount: number;
    paymentDate: string;
    paymentType?: PaymentType;
    paymentMethod: 'Cash' | 'Bank Transfer' | 'UPI' | 'Razorpay' | 'Cheque' | 'Other' | string;
    transactionId?: string;
    notes?: string;
    clientId?: string;
    clientName?: string;
    invoiceNumber?: string;
    dealId?: string;
    dealTitle?: string;
    serviceName?: string;
  }) => Promise<void>;
  onViewHistory?: () => void;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onSubmit,
  onViewHistory
}) => {
  const currentBalance = useMemo(() => {
    if (!invoice) return 0;
    if (invoice.balanceDue !== undefined && invoice.balanceDue !== null) {
      return Number(invoice.balanceDue);
    }
    return Math.max(0, (invoice.grandTotal || 0) - (invoice.amountPaid || 0));
  }, [invoice]);

  const clientName = invoice?.client?.name || invoice?.clientName || 'Client';
  const invoiceNumber = invoice?.invoiceNumber || 'Invoice';
  const serviceName = useMemo(() => {
    if (!invoice) return 'Services';
    if (invoice.items && invoice.items.length > 0) {
      return invoice.items.map(i => i.name).filter(Boolean).join(', ');
    }
    return invoice.servicePackage || 'Services';
  }, [invoice]);

  const existingPayments = useMemo(() => {
    return Array.isArray(invoice?.payments) ? invoice.payments : [];
  }, [invoice]);

  const [amount, setAmount] = useState<number>(currentBalance > 0 ? currentBalance : (invoice?.grandTotal || 0));
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Initial smart default payment type
  const initialType: PaymentType = useMemo(() => {
    const paidSoFar = Number(invoice?.amountPaid || 0);
    if (paidSoFar === 0) {
      return currentBalance > 0 && amount >= currentBalance ? 'Full Payment' : 'Advance';
    }
    return amount >= currentBalance ? 'Balance Payment' : 'Partial Payment';
  }, [invoice, currentBalance, amount]);

  const [paymentType, setPaymentType] = useState<PaymentType>(initialType);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Bank Transfer' | 'UPI' | 'Razorpay' | 'Cheque' | 'Other'>('UPI');
  const [transactionId, setTransactionId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showPreviousPayments, setShowPreviousPayments] = useState<boolean>(false);

  if (!isOpen || !invoice) return null;

  // Live remaining balance after this payment
  const remainingAfterPayment = Math.max(0, currentBalance - (Number(amount) || 0));

  const handleAmountChange = (newAmount: number) => {
    setAmount(newAmount);
    // Auto-suggest payment type if user hasn't explicitly set a custom one
    const paidSoFar = Number(invoice?.amountPaid || 0);
    if (newAmount >= currentBalance && currentBalance > 0) {
      setPaymentType(paidSoFar > 0 ? 'Balance Payment' : 'Full Payment');
    } else if (paidSoFar === 0) {
      setPaymentType('Advance');
    } else {
      setPaymentType('Partial Payment');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        amount: Number(amount),
        paymentDate,
        paymentType,
        paymentMethod,
        transactionId,
        notes,
        clientId: invoice.clientId || invoice.client?.id,
        clientName,
        invoiceNumber,
        serviceName
      });

      // Celebrate if paid in full
      if (amount >= currentBalance) {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      }

      onClose();
    } catch (err) {
      console.error('Failed to record payment', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const methods: Array<{ id: 'Cash' | 'Bank Transfer' | 'UPI' | 'Razorpay' | 'Cheque' | 'Other'; label: string; icon: any }> = [
    { id: 'UPI', label: 'UPI / QR', icon: QrCode },
    { id: 'Bank Transfer', label: 'Bank Transfer (NEFT/RTGS/IMPS)', icon: Building },
    { id: 'Cash', label: 'Cash', icon: Banknote },
    { id: 'Cheque', label: 'Cheque', icon: Receipt },
    { id: 'Razorpay', label: 'Razorpay / Card', icon: CreditCard },
    { id: 'Other', label: 'Other', icon: CreditCard }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 my-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-900 via-teal-850 to-slate-900 px-5 sm:px-6 py-4 text-white flex justify-between items-center">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="p-1 bg-white/10 rounded-md text-emerald-300">
                <CreditCard className="w-4 h-4" />
              </span>
              <h2 className="text-base sm:text-lg font-bold truncate">Record Payment</h2>
            </div>
            <p className="text-xs text-teal-200 mt-0.5 truncate">
              Linked to Invoice #{invoiceNumber} &bull; {clientName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-teal-200 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Explicit Payment Relationship Card */}
          <div className="bg-gradient-to-br from-teal-50/70 via-slate-50 to-emerald-50/50 rounded-xl p-3.5 border border-teal-200/80 shadow-2xs space-y-2.5 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-teal-900 flex items-center gap-1.5 pb-1 border-b border-teal-200/60">
              <Info className="w-3.5 h-3.5 text-teal-700" />
              Payment Relationship &amp; Scope
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
              <div className="flex items-start gap-1.5">
                <User className="w-3.5 h-3.5 text-teal-700 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block uppercase font-bold">Client</span>
                  <span className="font-bold text-slate-900 truncate block text-[13px]">{clientName}</span>
                </div>
              </div>

              <div className="flex items-start gap-1.5">
                <FileText className="w-3.5 h-3.5 text-teal-700 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block uppercase font-bold">Invoice</span>
                  <span className="font-mono font-bold text-teal-950 block">{invoiceNumber}</span>
                </div>
              </div>

              <div className="sm:col-span-2 flex items-start gap-1.5 pt-1 border-t border-slate-200/60">
                <Layers className="w-3.5 h-3.5 text-teal-700 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] text-slate-500 block uppercase font-bold">Deal / Service</span>
                  <span className="font-medium text-slate-800 text-[11.5px] line-clamp-2 leading-snug">
                    {serviceName}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Status Strip */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 text-center font-mono">
              <div className="bg-white p-2 rounded-lg border border-slate-200">
                <span className="text-[9.5px] font-sans text-slate-500 block uppercase font-bold">Invoice Total</span>
                <span className="font-bold text-slate-900 text-xs sm:text-sm">{formatINR(invoice.grandTotal)}</span>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200">
                <span className="text-[9.5px] font-sans text-slate-500 block uppercase font-bold">Already Paid</span>
                <span className="font-bold text-emerald-700 text-xs sm:text-sm">{formatINR(invoice.amountPaid || 0)}</span>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200">
                <span className="text-[9.5px] font-sans text-slate-500 block uppercase font-bold">Current Bal</span>
                <span className="font-bold text-rose-700 text-xs sm:text-sm">{formatINR(currentBalance)}</span>
              </div>
            </div>
          </div>

          {/* Amount & Quick Fill Buttons */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Payment Amount (₹) <span className="text-rose-500">*</span>
              </label>
              {currentBalance > 0 && (
                <span className="text-[11px] font-mono text-slate-500">
                  Balance: <strong className="text-rose-700">{formatINR(currentBalance)}</strong>
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-base">₹</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount || ''}
                onChange={(e) => handleAmountChange(Math.max(0, Number(e.target.value) || 0))}
                className="w-full pl-8 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-bold focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden text-base font-mono"
                placeholder="0.00"
              />
            </div>
            {currentBalance > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <button
                  type="button"
                  onClick={() => handleAmountChange(currentBalance)}
                  className="text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-md border border-teal-200 transition-colors cursor-pointer"
                >
                  Pay Full Balance ({formatINR(currentBalance)})
                </button>
                {currentBalance > 1000 && (
                  <button
                    type="button"
                    onClick={() => handleAmountChange(Math.round(currentBalance / 2))}
                    className="text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md border border-slate-200 transition-colors cursor-pointer"
                  >
                    Pay 50% ({formatINR(Math.round(currentBalance / 2))})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Payment Type Selection (Advance, Partial, Balance, Full, Renewal) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Payment Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-semibold focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden cursor-pointer"
              >
                <option value="Advance">🔹 Advance (Upfront payment)</option>
                <option value="Partial Payment">🔸 Partial Payment (Installment)</option>
                <option value="Balance Payment">🟢 Balance Payment (Clearing remaining)</option>
                <option value="Full Payment">✅ Full Payment (Paid 100% upfront)</option>
                <option value="Renewal Payment">🔄 Renewal Payment (Recurring / Retainer)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Payment Date</label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-medium focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Payment Method</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {methods.map((m) => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50 text-teal-950 font-bold shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-teal-700' : 'text-slate-400'}`} />
                    <span className="truncate text-[11px] font-medium">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference ID & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Transaction / Ref ID</label>
              <input
                type="text"
                placeholder="e.g. UTR / UPI Ref / Cheque No"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-mono focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Remarks</label>
              <input
                type="text"
                placeholder="e.g. Confirmed via WhatsApp / Bank alert"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>
          </div>

          {/* Live Outcome Summary Box */}
          <div className="p-3 bg-slate-900 text-white rounded-xl space-y-1.5 text-xs font-mono">
            <div className="flex justify-between items-center text-slate-300">
              <span className="font-sans text-[11px] uppercase tracking-wider text-slate-400">Payment Recording Preview</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-teal-800 text-emerald-300">
                {paymentType}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-slate-800">
              <span className="text-slate-400 font-sans">Payment Amount:</span>
              <span className="text-emerald-300 font-bold text-sm">{formatINR(amount)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Remaining Balance:</span>
              <span className={`font-bold ${remainingAfterPayment <= 0.01 ? 'text-emerald-400' : 'text-rose-300'}`}>
                {remainingAfterPayment <= 0.01 ? '₹0.00 (Fully Settled)' : formatINR(remainingAfterPayment)}
              </span>
            </div>
          </div>

          {/* Existing Payments Accordion / Section */}
          {existingPayments.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setShowPreviousPayments(!showPreviousPayments)}
                className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between font-bold text-slate-700 cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-teal-700" />
                  Previous Payments on this Invoice ({existingPayments.length})
                </span>
                <span className="text-teal-700 text-[11px]">{showPreviousPayments ? '▲ Hide' : '▼ Show'}</span>
              </button>

              {showPreviousPayments && (
                <div className="p-3 bg-white divide-y divide-slate-100 max-h-36 overflow-y-auto space-y-1.5">
                  {existingPayments.map((p, idx) => (
                    <div key={p.id || idx} className="pt-1.5 first:pt-0 flex justify-between items-center text-[11px]">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800">{p.paymentDate}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[9.5px] font-bold">
                            {p.paymentType || 'Payment'}
                          </span>
                        </div>
                        {p.transactionId && <span className="text-slate-400 font-mono text-[9px] block">Ref: {p.transactionId}</span>}
                      </div>
                      <div className="text-right font-mono font-bold text-emerald-700">
                        {formatINR(p.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              {onViewHistory && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewHistory();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-teal-800 hover:text-teal-950 bg-teal-50 hover:bg-teal-100 rounded-lg flex items-center gap-1.5 border border-teal-200 transition-colors cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  View Payment History
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || amount <= 0}
                className="px-5 py-2 text-xs font-bold text-white bg-teal-800 hover:bg-teal-900 rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle className="w-4 h-4" />
                {isSubmitting ? 'Recording...' : `Record ${formatINR(amount)}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
