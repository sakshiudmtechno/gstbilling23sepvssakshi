import React, { useState } from 'react';
import { CreditNote, Invoice, Client, BusinessProfile } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { api } from '../../utils/api';
import { Plus, Search, FileText, CheckCircle, Trash2, X, AlertCircle, Eye, Download, Printer } from 'lucide-react';
import { toast } from '../common/Toast';
import { InvoicePDFTemplate } from '../invoices/InvoicePDFTemplate';
import { downloadElementAsPdf, triggerPrint } from '../../utils/pdfGenerator';

interface CreditNoteManagerProps {
  creditNotes: CreditNote[];
  invoices: Invoice[];
  clients: Client[];
  businessProfile: BusinessProfile | null;
  onRefresh: () => void;
}

export const CreditNoteManager: React.FC<CreditNoteManagerProps> = ({
  creditNotes,
  invoices,
  clients,
  businessProfile,
  onRefresh
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [creditNoteNumber, setCreditNoteNumber] = useState(`CN-${Date.now().toString().slice(-4)}`);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [reason, setReason] = useState('Service adjustment / Discount revised');
  const [amount, setAmount] = useState<number>(1000);
  const [gstAmount, setGstAmount] = useState<number>(180);
  const [viewingCreditNote, setViewingCreditNote] = useState<CreditNote | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const inv = invoices.find(i => i.id === selectedInvoiceId);
    if (!inv) {
      toast.error('Please select an invoice to link this credit note to');
      return;
    }

    const payload: Partial<CreditNote> = {
      creditNoteNumber,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      client: inv.client,
      date: new Date().toISOString().split('T')[0],
      reason,
      taxableAmount: amount,
      gstAmount,
      totalAmount: amount + gstAmount,
      status: 'active'
    };

    try {
      await api.createCreditNote(payload);
      setIsCreating(false);
      toast.success('Credit note issued successfully');
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create credit note');
    }
  };

  const handleDelete = async (cn: CreditNote) => {
    if (!window.confirm(`Are you sure you want to delete credit note ${cn.creditNoteNumber}? This will reverse the credit on linked invoice ${cn.invoiceNumber}.`)) {
      return;
    }
    try {
      await api.deleteCreditNote(cn.id);
      toast.success(`Credit note ${cn.creditNoteNumber} deleted and invoice balance restored`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete credit note');
    }
  };

  const getCreditNoteInvoiceRepresentation = (cn: CreditNote) => {
    const linkedInvoice = invoices.find(i => i.id === cn.invoiceId || i.invoiceNumber === cn.invoiceNumber);
    const client = cn.client || linkedInvoice?.client || {
      id: 'temp',
      name: 'Client',
      contactPerson: 'Client',
      email: '',
      phone: '',
      billingAddress: '',
      city: '',
      state: 'Madhya Pradesh',
      stateCode: '23',
      country: 'India',
      pinCode: '',
      gstin: '',
      pan: '',
      customerType: 'B2B',
      createdAt: ''
    };

    return {
      id: cn.id,
      invoiceNumber: cn.creditNoteNumber,
      poNumber: cn.invoiceNumber ? `Against Invoice #${cn.invoiceNumber}` : '',
      invoiceDate: cn.date,
      dueDate: cn.date,
      clientId: cn.clientId,
      client,
      placeOfSupply: linkedInvoice?.placeOfSupply || client.state || 'Madhya Pradesh',
      placeOfSupplyCode: linkedInvoice?.placeOfSupplyCode || client.stateCode || '23',
      currency: 'INR',
      isInterState: (client.stateCode || '23') !== (businessProfile?.stateCode || '23'),
      items: [
        {
          id: '1',
          name: `Credit Adjustment against Invoice #${cn.invoiceNumber || 'Original'}`,
          description: cn.reason,
          hsnSac: '9983',
          quantity: 1,
          unit: 'JOB',
          rate: cn.taxableAmount,
          discountType: 'percentage',
          discountValue: 0,
          discountAmount: 0,
          taxableAmount: cn.taxableAmount,
          gstRate: 18,
          cgstAmount: cn.gstAmount / 2,
          sgstAmount: cn.gstAmount / 2,
          igstAmount: 0,
          totalGstAmount: cn.gstAmount,
          total: cn.totalAmount
        }
      ],
      subtotal: cn.taxableAmount,
      totalTaxableAmount: cn.taxableAmount,
      totalGst: cn.gstAmount,
      totalCgst: cn.gstAmount / 2,
      totalSgst: cn.gstAmount / 2,
      totalIgst: 0,
      roundOff: 0,
      grandTotal: cn.totalAmount,
      totalInWords: '',
      amountPaid: cn.totalAmount,
      balanceDue: 0,
      status: 'paid',
      terms: 'This Credit Note officially credits and reduces liability for the referenced GST invoice.',
      seller: businessProfile
    } as any;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Credit Notes / Debit Notes</h1>
          <p className="text-xs text-slate-500">Manage tax adjustments, sales returns, and revised rate credits</p>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="px-4 py-2 bg-indigo-900 hover:bg-indigo-800 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Create Credit Note
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="p-3.5">Credit Note No</th>
                <th className="p-3.5">Linked Invoice</th>
                <th className="p-3.5">Client</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Reason</th>
                <th className="p-3.5 text-right">Taxable</th>
                <th className="p-3.5 text-right">GST</th>
                <th className="p-3.5 text-right">Total (₹)</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {creditNotes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-slate-400">
                    No credit notes issued.
                  </td>
                </tr>
              ) : (
                creditNotes.map((cn) => (
                  <tr key={cn.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-indigo-950">{cn.creditNoteNumber}</td>
                    <td className="p-3.5 font-mono text-slate-700 font-semibold">{cn.invoiceNumber}</td>
                    <td className="p-3.5 font-medium text-slate-900">{cn.client?.name || 'Client'}</td>
                    <td className="p-3.5 text-slate-600">{cn.date}</td>
                    <td className="p-3.5 text-slate-600 max-w-xs truncate">{cn.reason}</td>
                    <td className="p-3.5 text-right font-mono font-medium text-slate-700">{formatINR(cn.taxableAmount)}</td>
                    <td className="p-3.5 text-right font-mono text-slate-600">{formatINR(cn.gstAmount)}</td>
                    <td className="p-3.5 text-right font-mono font-bold text-rose-700">{formatINR(cn.totalAmount)}</td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingCreditNote(cn)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                          title="View Credit Note PDF"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setViewingCreditNote(cn);
                              setTimeout(async () => {
                                await downloadElementAsPdf(`modal-cn-pdf-${cn.id}`, `CreditNote-${cn.creditNoteNumber}.pdf`);
                                toast.success('Credit Note PDF downloaded');
                              }, 150);
                            } catch {
                              toast.error('Failed to download PDF');
                            }
                          }}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                          title="Download Credit Note PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(cn)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Credit Note (Restore Balance)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credit Note PDF Preview Modal */}
      {viewingCreditNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="bg-indigo-950 px-6 py-3 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-indigo-300" />
                <h3 className="font-bold text-sm">Credit Note {viewingCreditNote.creditNoteNumber}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => triggerPrint(`modal-cn-pdf-${viewingCreditNote.id}`)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  onClick={async () => {
                    await downloadElementAsPdf(`modal-cn-pdf-${viewingCreditNote.id}`, `CreditNote-${viewingCreditNote.creditNoteNumber}.pdf`);
                    toast.success('Credit Note PDF downloaded');
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  onClick={() => setViewingCreditNote(null)}
                  className="p-1.5 text-indigo-300 hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 bg-slate-100 overflow-y-auto flex justify-center">
              <InvoicePDFTemplate
                id={`modal-cn-pdf-${viewingCreditNote.id}`}
                invoice={getCreditNoteInvoiceRepresentation(viewingCreditNote)}
                documentTitle="CREDIT NOTE"
                businessProfileFallback={businessProfile}
              />
            </div>
          </div>
        </div>
      )}

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="bg-indigo-950 px-6 py-4 text-white flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold">Issue Credit Note</h2>
                <p className="text-xs text-indigo-200">Linked to original GST invoice</p>
              </div>
              <button onClick={() => setIsCreating(false)} className="text-indigo-200 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Credit Note Number</label>
                <input
                  type="text"
                  required
                  value={creditNoteNumber}
                  onChange={(e) => setCreditNoteNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Original Invoice</label>
                <select
                  required
                  value={selectedInvoiceId}
                  onChange={(e) => setSelectedInvoiceId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium"
                >
                  <option value="">-- Choose Invoice --</option>
                  {invoices.map(inv => (
                    <option key={inv.id} value={inv.id}>
                      #{inv.invoiceNumber} • {inv.client.name} ({formatINR(inv.grandTotal)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reason for Credit</label>
                <input
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Taxable Adjustment (₹)</label>
                  <input
                    type="number"
                    required
                    value={amount}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setAmount(val);
                      setGstAmount(Math.round(val * 0.18));
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">GST Adjustment (₹)</label>
                  <input
                    type="number"
                    required
                    value={gstAmount}
                    onChange={(e) => setGstAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs font-bold"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-indigo-900 hover:bg-indigo-800 text-white font-bold rounded-lg shadow-sm">Issue Credit Note</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
