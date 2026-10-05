import React, { useState, useMemo } from 'react';
import { Client, RecurringInvoice } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { calculateMonthlyPeriod, formatDisplayDate } from '../../utils/recurringUtils';
import { api } from '../../utils/api';
import { toast } from '../common/Toast';
import { X, Plus, Repeat, Calendar, IndianRupee, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface AddRecurringModalProps {
  clients: Client[];
  initialClientId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddRecurringModal: React.FC<AddRecurringModalProps> = ({
  clients,
  initialClientId,
  onClose,
  onSuccess
}) => {
  const [selectedClientId, setSelectedClientId] = useState<string>(
    initialClientId || (clients.length > 0 ? clients[0].id : '')
  );
  const [serviceName, setServiceName] = useState<string>('Monthly AMC');
  const [monthlyRenewalAmount, setMonthlyRenewalAmount] = useState<number>(3000);
  const [startDate, setStartDate] = useState<string>(() => {
    // Default to 1st of current month for clean billing cycles
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  });
  const [terms, setTerms] = useState<string>('Standard Monthly AMC & Retainer SLA agreement applies.');
  const [isInitialPaymentPaid, setIsInitialPaymentPaid] = useState<boolean>(true);
  const [initialPaymentDate, setInitialPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<string>('UPI');
  const [initialPaymentReference, setInitialPaymentReference] = useState<string>(`UPI-${Date.now().toString().slice(-6)}`);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === selectedClientId);
  }, [clients, selectedClientId]);

  // Live calculation of period dates based on startDate
  const periodCalc = useMemo(() => {
    return calculateMonthlyPeriod(startDate);
  }, [startDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClient) {
      toast.error('Please choose a client');
      return;
    }

    if (!serviceName.trim()) {
      toast.error('Please provide a service or AMC name');
      return;
    }

    if (monthlyRenewalAmount <= 0) {
      toast.error('Monthly renewal amount must be greater than zero');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: any = {
        clientId: selectedClient.id,
        client: selectedClient,
        clientName: selectedClient.name,
        serviceName: serviceName.trim(),
        title: serviceName.trim(),
        monthlyRenewalAmount: Number(monthlyRenewalAmount),
        frequency: 'monthly',
        startDate,
        currentExpiryDate: periodCalc.currentExpiryDate,
        nextRenewalDate: periodCalc.nextRenewalDate,
        terms,
        isInitialPaymentPaid,
        initialPaymentAmount: isInitialPaymentPaid ? Number(monthlyRenewalAmount) : 0,
        initialPaymentDate,
        initialPaymentMethod,
        initialPaymentReference: initialPaymentReference.trim(),
        initialPaymentNotes: `First month subscription for ${periodCalc.periodName}`,
        items: [
          {
            id: `item_${Date.now()}`,
            name: serviceName.trim(),
            description: `Monthly maintenance contract and SLA retainer`,
            hsnSac: '998313',
            quantity: 1,
            unit: 'MONTH',
            rate: Number(monthlyRenewalAmount),
            discountType: 'percentage',
            discountValue: 0,
            discountAmount: 0,
            gstRate: 0
          }
        ]
      };

      await api.createRecurringInvoice(payload);
      toast.success(`Recurring client "${selectedClient.name}" added successfully!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add recurring client');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200 my-8">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1 bg-teal-500/20 text-teal-400 rounded-md">
                <Repeat className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold">Add Recurring Client / AMC</h2>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Configure automatic monthly service period, expiry tracking, and renewal payments
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          {/* Client & Service */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Client <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden cursor-pointer"
              >
                <option value="">-- Choose Client --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Service / AMC Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="e.g. Monthly AMC, Cloud Server Retainer"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>
          </div>

          {/* Monthly Amount & Start Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Monthly Renewal Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 font-bold">₹</span>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={monthlyRenewalAmount}
                  onChange={(e) => setMonthlyRenewalAmount(Number(e.target.value))}
                  placeholder="3000"
                  className="w-full pl-7 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Start Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              />
            </div>
          </div>

          {/* Automatic Date Calculation Preview Card (Requirement 1, 2, 3) */}
          <div className="bg-teal-50/60 p-4 rounded-xl border border-teal-200/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-teal-950 flex items-center gap-1.5 text-xs">
                <Calendar className="w-4 h-4 text-teal-700" />
                Automatic Monthly Period Calculation
              </span>
              <span className="text-[11px] font-semibold text-teal-800 bg-teal-100/70 px-2 py-0.5 rounded">
                Monthly Cycle
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
              <div className="bg-white p-2.5 rounded-lg border border-teal-100">
                <span className="text-[11px] text-slate-500 block">Initial Period</span>
                <span className="font-bold text-slate-900">{periodCalc.periodName}</span>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-teal-100">
                <span className="text-[11px] text-slate-500 block">Current Expiry Date</span>
                <span className="font-bold font-mono text-slate-900">{formatDisplayDate(periodCalc.currentExpiryDate)}</span>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-teal-100">
                <span className="text-[11px] text-slate-500 block">Next Renewal Date</span>
                <span className="font-bold font-mono text-teal-900">{formatDisplayDate(periodCalc.nextRenewalDate)}</span>
              </div>
            </div>
            <p className="text-[11px] text-teal-800 italic">
              * Renewal status is automatically updated based on the expiry date (Active, Due Soon, Expired, Renewed).
            </p>
          </div>

          {/* Initial Payment Option */}
          <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50/50">
            <div
              onClick={() => setIsInitialPaymentPaid(!isInitialPaymentPaid)}
              className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200 hover:border-teal-400 cursor-pointer transition-colors shadow-2xs select-none"
            >
              <input
                type="checkbox"
                id="add-rec-initial-paid"
                checked={isInitialPaymentPaid}
                onChange={(e) => setIsInitialPaymentPaid(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="w-5 h-5 text-teal-700 rounded border-slate-300 focus:ring-teal-700 cursor-pointer shrink-0"
              />
              <label
                htmlFor="add-rec-initial-paid"
                className="cursor-pointer font-bold text-slate-800 text-xs flex-1 flex items-center justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Record first month payment now as Paid</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  isInitialPaymentPaid ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {isInitialPaymentPaid ? 'Paid' : 'Unpaid'}
                </span>
              </label>
            </div>

            {isInitialPaymentPaid && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Payment Date</label>
                  <input
                    type="date"
                    required
                    value={initialPaymentDate}
                    onChange={(e) => setInitialPaymentDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Payment Method</label>
                  <select
                    value={initialPaymentMethod}
                    onChange={(e) => setInitialPaymentMethod(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs cursor-pointer"
                  >
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Reference / UTR</label>
                  <input
                    type="text"
                    value={initialPaymentReference}
                    onChange={(e) => setInitialPaymentReference(e.target.value)}
                    placeholder="e.g. UPI-TXN-123"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Terms */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Terms / Notes</label>
            <input
              type="text"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
              placeholder="e.g. Standard AMC & Retainer SLA agreement applies"
            />
          </div>

          {/* Modal Footer */}
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white font-bold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {isSubmitting ? 'Adding Client...' : 'Add Recurring Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
