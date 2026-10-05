import React, { useState, useEffect } from 'react';
import { Invoice, InvoicePayment } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { api } from '../../utils/api';
import { toast, showConfirm } from '../common/Toast';
import {
  X,
  Plus,
  Trash2,
  Receipt,
  User,
  Layers,
  FileText,
  Calendar,
  CreditCard,
  Building,
  QrCode,
  Banknote,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Info
} from 'lucide-react';

interface PaymentHistoryModalProps {
  invoice: Invoice;
  isOpen: boolean;
  onClose: () => void;
  onRecordPayment: (invoice: Invoice) => void;
  onRefresh: () => void;
}

export const PaymentHistoryModal: React.FC<PaymentHistoryModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onRecordPayment,
  onRefresh
}) => {
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [livePayments, setLivePayments] = useState<InvoicePayment[]>(Array.isArray(invoice?.payments) ? invoice.payments : []);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  // Fetch live payments whenever opened or invoice changes
  useEffect(() => {
    if (isOpen && invoice?.id) {
      api.getInvoicePayments(invoice.id)
        .then((res) => {
          if (res && res.data) {
            setLivePayments(res.data);
            if (res.data.length > 0 && !selectedPaymentId) {
              setSelectedPaymentId(res.data[res.data.length - 1].id);
            }
          }
        })
        .catch((err) => {
          console.warn('Failed to fetch live payments:', err);
        });
    }
  }, [isOpen, invoice?.id]);

  if (!isOpen || !invoice) return null;

  const payments = livePayments.length > 0 ? livePayments : (Array.isArray(invoice.payments) ? invoice.payments : []);
  const clientName = invoice.client?.name || invoice.clientName || 'Client';
  const invoiceNumber = invoice.invoiceNumber || 'Invoice';
  const serviceNames = (invoice.items && invoice.items.length > 0)
    ? invoice.items.map(i => i.name).filter(Boolean).join(', ')
    : (invoice.servicePackage || 'Services');

  const grandTotal = Number(invoice.grandTotal) || 0;
  const totalPaid = payments.length > 0
    ? round2Sum(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
    : (Number(invoice.amountPaid) || 0);
  const balanceDue = Math.max(0, grandTotal - totalPaid);

  function round2Sum(val: number) {
    return Math.round((val + Number.EPSILON) * 100) / 100;
  }

  // Selected payment for relationship inspection
  const selectedPayment = payments.find(p => p.id === selectedPaymentId) || payments[payments.length - 1] || null;

  const getPaymentTypeBadge = (type?: string) => {
    switch (type) {
      case 'Advance':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">🔹 Advance</span>;
      case 'Partial Payment':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">🔸 Partial Payment</span>;
      case 'Balance Payment':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">🟢 Balance Payment</span>;
      case 'Full Payment':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">✅ Full Payment</span>;
      case 'Renewal Payment':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">🔄 Renewal Payment</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">Payment</span>;
    }
  };

  const getMethodIcon = (method?: string) => {
    if (!method) return <CreditCard className="w-3.5 h-3.5 text-slate-400" />;
    const m = method.toLowerCase();
    if (m.includes('upi') || m.includes('qr')) return <QrCode className="w-3.5 h-3.5 text-emerald-600" />;
    if (m.includes('bank') || m.includes('neft') || m.includes('rtgs')) return <Building className="w-3.5 h-3.5 text-indigo-600" />;
    if (m.includes('cash')) return <Banknote className="w-3.5 h-3.5 text-amber-600" />;
    if (m.includes('cheque')) return <Receipt className="w-3.5 h-3.5 text-slate-600" />;
    return <CreditCard className="w-3.5 h-3.5 text-teal-600" />;
  };

  const handleDeletePayment = (payment: InvoicePayment) => {
    showConfirm({
      title: 'Delete Payment Transaction',
      message: `Are you sure you want to remove the payment of ${formatINR(payment.amount)} (${payment.paymentDate})? The invoice balance will be automatically recalculated.`,
      confirmText: 'Delete Payment',
      isDanger: true,
      onConfirm: async () => {
        setIsDeletingId(payment.id);
        try {
          await api.deleteInvoicePayment(invoice.id, payment.id);
          toast.success(`Removed payment of ${formatINR(payment.amount)}`);
          // Refresh local list
          const res = await api.getInvoicePayments(invoice.id);
          if (res && res.data) {
            setLivePayments(res.data);
            setSelectedPaymentId(res.data.length > 0 ? res.data[res.data.length - 1].id : null);
          }
          onRefresh();
        } catch (err: any) {
          toast.error(err.message || 'Failed to remove payment');
        } finally {
          setIsDeletingId(null);
        }
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200 my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-teal-950 px-5 sm:px-6 py-4 text-white flex justify-between items-center shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="p-1 bg-white/10 rounded-md text-emerald-300">
                <Receipt className="w-4 h-4" />
              </span>
              <h2 className="text-base sm:text-lg font-bold">Payment History &amp; Tracking</h2>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 truncate">
              Invoice #{invoiceNumber} &bull; {clientName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Explicit Payment Relationship Display Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-teal-950 text-white rounded-xl p-4 shadow-sm border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-teal-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-teal-300" />
                Payment Relationship &amp; Scope
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                {selectedPayment ? selectedPayment.paymentType : 'Payment Summary'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Client:</span>
                <span className="text-white font-bold text-sm truncate block">{clientName}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Invoice:</span>
                <span className="text-teal-300 font-mono font-bold text-sm block">{invoiceNumber}</span>
              </div>

              <div className="col-span-2">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Service:</span>
                <span className="text-slate-200 font-medium text-xs block leading-snug">
                  {selectedPayment?.serviceName || serviceNames}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Invoice Total:</span>
                <span className="text-white font-mono font-bold text-sm">{formatINR(grandTotal)}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  {selectedPayment ? 'Payment:' : 'Total Paid:'}
                </span>
                <span className="text-emerald-400 font-mono font-bold text-sm">
                  {selectedPayment ? formatINR(selectedPayment.amount) : formatINR(totalPaid)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Payment Type:</span>
                <span className="text-teal-200 font-semibold text-xs">
                  {selectedPayment?.paymentType || (balanceDue <= 0.01 ? 'Full Payment' : (totalPaid > 0 ? 'Partial Payment' : 'Advance'))}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Remaining Balance:</span>
                <span className={`font-mono font-bold text-sm ${balanceDue <= 0.01 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedPayment?.remainingBalance !== undefined ? formatINR(selectedPayment.remainingBalance) : formatINR(balanceDue)}
                </span>
              </div>
            </div>
          </div>

          {/* Financial Summary Strip */}
          <div className="grid grid-cols-3 gap-2 font-mono text-center">
            <div className="bg-slate-100 p-3 rounded-xl border border-slate-200">
              <span className="text-[10px] font-sans text-slate-500 uppercase font-bold block">Total Invoice</span>
              <span className="font-bold text-slate-900 text-sm sm:text-base">{formatINR(grandTotal)}</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-sans text-emerald-800 uppercase font-bold block">Total Paid</span>
              <span className="font-bold text-emerald-700 text-sm sm:text-base">{formatINR(totalPaid)}</span>
            </div>
            <div className={`p-3 rounded-xl border ${balanceDue <= 0.01 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
              <span className="text-[10px] font-sans text-slate-500 uppercase font-bold block">Balance</span>
              <span className={`font-bold text-sm sm:text-base ${balanceDue <= 0.01 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {balanceDue <= 0.01 ? '₹0' : formatINR(balanceDue)}
              </span>
            </div>
          </div>

          {/* Payment History Section */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <span>Payment History</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-teal-100 text-teal-900 font-bold">
                  {payments.length} {payments.length === 1 ? 'record' : 'records'}
                </span>
              </h3>

              {balanceDue > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRecordPayment(invoice);
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-white bg-teal-800 hover:bg-teal-900 rounded-lg flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Payment
                </button>
              )}
            </div>

            {payments.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-2">
                <Clock className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs font-semibold text-slate-600">No payment transactions recorded yet.</p>
                <p className="text-[11px] text-slate-400">Total balance due on this invoice is {formatINR(balanceDue)}.</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRecordPayment(invoice);
                  }}
                  className="mt-2 px-3 py-1.5 text-xs font-bold text-teal-900 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors cursor-pointer"
                >
                  Record First Payment
                </button>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Type</th>
                        <th className="p-2.5 text-right">Amount</th>
                        <th className="p-2.5">Method</th>
                        <th className="p-2.5">Ref / UTR</th>
                        <th className="p-2.5">Notes</th>
                        <th className="p-2.5 text-right w-12">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map((p, idx) => {
                        const isSelected = selectedPayment?.id === p.id;
                        return (
                          <tr
                            key={p.id || idx}
                            onClick={() => setSelectedPaymentId(p.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-teal-50/70 border-l-4 border-l-teal-600' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap">
                              {p.paymentDate}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              {getPaymentTypeBadge(p.paymentType)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                              {formatINR(p.amount)}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span className="flex items-center gap-1.5 text-slate-700">
                                {getMethodIcon(p.paymentMethod)}
                                <span>{p.paymentMethod || 'UPI'}</span>
                              </span>
                            </td>
                            <td className="p-2.5 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                              {p.transactionId || '-'}
                            </td>
                            <td className="p-2.5 text-slate-600 max-w-[150px] truncate" title={p.notes || ''}>
                              {p.notes || '-'}
                            </td>
                            <td className="p-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => handleDeletePayment(p)}
                                disabled={isDeletingId === p.id}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer disabled:opacity-40"
                                title="Delete Payment Entry"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-100/90 border-t-2 border-slate-200 font-bold text-slate-900 text-xs">
                      <tr>
                        <td colSpan={2} className="p-2.5 uppercase tracking-wider text-slate-700 font-bold">
                          Total Paid
                        </td>
                        <td className="p-2.5 text-right font-mono font-black text-emerald-800 text-sm">
                          {formatINR(totalPaid)}
                        </td>
                        <td colSpan={4} className="p-2.5 text-right text-[11px] font-mono">
                          {balanceDue <= 0.01 ? (
                            <span className="text-emerald-700 font-bold">Balance: ₹0 (Paid in Full)</span>
                          ) : (
                            <span>Balance: <strong className="text-rose-700 font-bold">{formatINR(balanceDue)}</strong></span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>All payments remain strictly linked to <strong>Invoice #{invoiceNumber}</strong>.</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {balanceDue > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRecordPayment(invoice);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-teal-800 hover:bg-teal-900 rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Record Another Payment
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

