import React, { useState } from 'react';
import { Invoice } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { X, Send, FileText, CheckCircle2 } from 'lucide-react';

interface SendEmailModalProps {
  invoice: Invoice;
  isOpen: boolean;
  onClose: () => void;
  onSend: (payload: { to: string; cc?: string; subject: string; message: string }) => Promise<void>;
}

export const SendEmailModal: React.FC<SendEmailModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onSend
}) => {
  const [to, setTo] = useState<string>(invoice?.client?.email || 'billing@client.com');
  const [cc, setCc] = useState<string>('Contact@udmtechno.com');
  const [subject, setSubject] = useState<string>(
    invoice ? `Tax Invoice #${invoice.invoiceNumber} from UDM Techno Solutions for ${formatINR(invoice.grandTotal)}` : ''
  );
  const [message, setMessage] = useState<string>(
    invoice ? `Dear ${invoice.client?.contactPerson || invoice.client?.name || 'Customer'},\n\nPlease find attached Tax Invoice #${invoice.invoiceNumber} dated ${invoice.invoiceDate} for the amount of ${formatINR(invoice.grandTotal)}.\n\nDue Date: ${invoice.dueDate}\n\nKindly process the payment to our designated bank account or scan the UPI QR code on the invoice.\n\nThank you for choosing UDM Techno Solutions.\n\nBest Regards,\nAccounts Team\nUDM Techno Solutions` : ''
  );
  const [isSending, setIsSending] = useState(false);
  const [isSentSuccess, setIsSentSuccess] = useState(false);

  if (!isOpen || !invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    try {
      await onSend({ to, cc, subject, message });
      setIsSentSuccess(true);
      setTimeout(() => {
        setIsSentSuccess(false);
        onClose();
      }, 1400);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        <div className="bg-gradient-to-r from-teal-900 to-slate-900 px-6 py-4 text-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold">Email Tax Invoice</h2>
            <p className="text-xs text-teal-200 mt-0.5">Send directly to client with PDF attachment</p>
          </div>
          <button onClick={onClose} className="text-teal-200 hover:text-white p-1 rounded-lg hover:bg-white/10 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSentSuccess ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Invoice Sent Successfully!</h3>
            <p className="text-xs text-slate-500">Email dispatched with PDF attachment to {to}.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">To Email <span className="text-rose-500">*</span></label>
              <input
                type="email"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">CC Email</label>
              <input
                type="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Subject <span className="text-rose-500">*</span></label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
              <textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden font-mono leading-relaxed resize-y"
              />
            </div>

            {/* Attached PDF card */}
            <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-800">Invoice_{invoice.invoiceNumber}.pdf</p>
                <p className="text-[11px] text-slate-500">Auto-generated PDF • {formatINR(invoice.grandTotal)}</p>
              </div>
              <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-medium">Attached</span>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSending}
                className="px-5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {isSending ? 'Sending Email...' : 'Send Invoice Email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
