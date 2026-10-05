import React, { useState } from 'react';
import { RecurringInvoice, RenewalRecord } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { formatDisplayDate, getRenewalStatusBadge, getPaymentStatusBadge, calculateNextMonthlyPeriod } from '../../utils/recurringUtils';
import { api } from '../../utils/api';
import { toast } from '../common/Toast';
import { X, History, Plus, CheckCircle2, Clock, Calendar, ArrowRight, IndianRupee, ShieldCheck } from 'lucide-react';
import { RecordRenewalPaymentModal } from './RecordRenewalPaymentModal';

interface RenewalHistoryModalProps {
  recurring: RecurringInvoice;
  onClose: () => void;
  onRefresh: () => void;
}

export const RenewalHistoryModal: React.FC<RenewalHistoryModalProps> = ({
  recurring,
  onClose,
  onRefresh
}) => {
  const [selectedPendingPeriod, setSelectedPendingPeriod] = useState<RenewalRecord | null>(null);
  const [isQueueingNext, setIsQueueingNext] = useState<boolean>(false);
  const [isAddingPending, setIsAddingPending] = useState<boolean>(false);

  const history = recurring.renewalHistory || [];
  const statusBadge = getRenewalStatusBadge(recurring.renewalStatus);
  const paymentBadge = getPaymentStatusBadge(recurring.paymentStatus);

  // Queue next pending renewal month
  const handleQueueNextMonth = async () => {
    // Find the latest period in history
    let latestEnd = recurring.currentExpiryDate || recurring.startDate;
    if (history.length > 0) {
      const sorted = [...history].sort((a, b) => (b.periodEndDate || '').localeCompare(a.periodEndDate || ''));
      if (sorted[0]?.periodEndDate) {
        latestEnd = sorted[0].periodEndDate;
      }
    }

    const nextPeriod = calculateNextMonthlyPeriod(latestEnd);
    setIsQueueingNext(true);
    try {
      await api.addRenewalPeriod(recurring.id, {
        periodName: nextPeriod.periodName,
        periodStartDate: nextPeriod.periodStartDate,
        periodEndDate: nextPeriod.currentExpiryDate,
        renewalAmount: recurring.monthlyRenewalAmount || 3000,
        notes: `Upcoming renewal for ${nextPeriod.periodName}`
      });

      toast.success(`Scheduled upcoming renewal period: ${nextPeriod.periodName} (Pending)`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to queue next renewal period');
    } finally {
      setIsQueueingNext(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden border border-slate-200 my-8 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1 bg-teal-500/20 text-teal-400 rounded-md">
                  <History className="w-4 h-4" />
                </span>
                <h2 className="text-base font-bold">Monthly Renewal History & Payments</h2>
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

          {/* Quick Details Bar */}
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-slate-500 block text-[11px]">Monthly Amount</span>
                <span className="font-bold font-mono text-slate-900 text-sm">
                  {formatINR(recurring.monthlyRenewalAmount || 3000)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div>
                <span className="text-slate-500 block text-[11px]">Current Expiry</span>
                <span className="font-bold font-mono text-slate-900">
                  {formatDisplayDate(recurring.currentExpiryDate)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div>
                <span className="text-slate-500 block text-[11px]">Next Renewal</span>
                <span className="font-bold font-mono text-teal-900">
                  {formatDisplayDate(recurring.nextRenewalDate)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusBadge.bg} ${statusBadge.text} border ${statusBadge.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                Status: {statusBadge.label}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${paymentBadge.bg} ${paymentBadge.text} border ${paymentBadge.border}`}>
                Payment: {paymentBadge.label}
              </span>
              <button
                type="button"
                onClick={handleQueueNextMonth}
                disabled={isQueueingNext}
                className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Create next upcoming month in Pending status"
              >
                <Plus className="w-3.5 h-3.5" />
                {isQueueingNext ? 'Queueing...' : 'Queue Next Month'}
              </button>
            </div>
          </div>

          {/* Separation Notice */}
          <div className="bg-teal-50/70 border-b border-teal-100 px-6 py-2 text-[11px] text-teal-900 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
            <span>
              All monthly renewals are tracked separately under <strong>Renewal Payment</strong>. Previous renewal history is permanently archived and never overwritten.
            </span>
          </div>

          {/* History Records Table */}
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
                <Clock className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-600 font-semibold">No renewal history records found</p>
                <p className="text-[11px] text-slate-400">Monthly renewal records will appear here as they are created and paid.</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Renewal Period</th>
                      <th className="py-2.5 px-3">Service Dates</th>
                      <th className="py-2.5 px-3 text-right">Renewal Amount</th>
                      <th className="py-2.5 px-3 text-right">Paid Amount</th>
                      <th className="py-2.5 px-3">Payment Info</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((record, index) => {
                      const isPaid = record.paymentStatus === 'paid';
                      const isPartial = record.paymentStatus === 'partially_paid';

                      return (
                        <tr
                          key={record.id || index}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            !isPaid ? 'bg-amber-50/30' : ''
                          }`}
                        >
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-900 block">{record.periodName}</span>
                            {record.notes && (
                              <span className="text-[11px] text-slate-500 truncate block max-w-xs">{record.notes}</span>
                            )}
                          </td>

                          <td className="py-3 px-3">
                            <div className="font-mono text-[11px] text-slate-700">
                              {formatDisplayDate(record.periodStartDate)}
                              <span className="mx-1 text-slate-400">→</span>
                              {formatDisplayDate(record.periodEndDate)}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                            {formatINR(record.renewalAmount)}
                          </td>

                          <td className="py-3 px-3 text-right font-mono font-bold text-teal-950">
                            {formatINR(record.paidAmount || 0)}
                          </td>

                          <td className="py-3 px-3">
                            {isPaid || (record.paidAmount && record.paidAmount > 0) ? (
                              <div className="space-y-0.5">
                                <div className="text-[11px] text-slate-700 flex items-center gap-1">
                                  <span>{formatDisplayDate(record.paymentDate)}</span>
                                  <span className="text-slate-400">•</span>
                                  <span className="font-medium text-slate-800">{record.paymentMethod || 'UPI'}</span>
                                </div>
                                {record.referenceId && (
                                  <div className="text-[10px] font-mono text-slate-500 truncate">
                                    Ref: {record.referenceId}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No payment yet</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-center">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" /> Paid
                              </span>
                            ) : isPartial ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-800 border border-orange-200">
                                Partial
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                Pending
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right">
                            {!isPaid ? (
                              <button
                                type="button"
                                onClick={() => setSelectedPendingPeriod(record)}
                                className="px-3 py-1 bg-teal-800 hover:bg-teal-900 text-white rounded-md font-bold text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                              >
                                Record Payment <ArrowRight className="w-3 h-3" />
                              </button>
                            ) : (
                              <span className="text-[11px] text-emerald-700 font-semibold flex items-center justify-end gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Settled
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-between items-center shrink-0">
            <span className="text-xs text-slate-500">
              Total Recorded Periods: <strong className="text-slate-900">{history.length}</strong>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Pay specific pending period modal */}
      {selectedPendingPeriod && (
        <RecordRenewalPaymentModal
          recurring={recurring}
          preselectedPeriod={{
            periodName: selectedPendingPeriod.periodName,
            periodStartDate: selectedPendingPeriod.periodStartDate,
            periodEndDate: selectedPendingPeriod.periodEndDate,
            renewalAmount: selectedPendingPeriod.renewalAmount
          }}
          onClose={() => setSelectedPendingPeriod(null)}
          onSuccess={() => {
            setSelectedPendingPeriod(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
};
