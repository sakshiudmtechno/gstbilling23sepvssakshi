import React, { useState, useEffect } from 'react';
import { CustomerOnboarding, Client, Invoice } from '../../types';
import {
  X,
  IndianRupee,
  Calendar,
  User,
  Briefcase,
  Phone,
  MessageSquare,
  Tag,
  Check,
  FileText,
  Zap,
  ArrowRight
} from 'lucide-react';

interface OnboardingEditorModalProps {
  initialData?: CustomerOnboarding | null;
  clients: Client[];
  invoices?: Invoice[];
  onClose: () => void;
  onSave: (data: Partial<CustomerOnboarding>) => Promise<void>;
}

export const OnboardingEditorModal: React.FC<OnboardingEditorModalProps> = ({
  initialData,
  clients,
  invoices = [],
  onClose,
  onSave
}) => {
  const isEditing = Boolean(initialData);

  // 1. Date
  const [dealDate, setDealDate] = useState<string>(
    initialData?.onboardingDate || new Date().toISOString().split('T')[0]
  );

  // 2. Invoice Link & Auto-Fetch
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(
    initialData?.invoiceId || ''
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string>(
    initialData?.invoiceNumber || ''
  );

  // 3. Client Name & Phone
  const [selectedClientId, setSelectedClientId] = useState<string>(
    initialData?.clientId || ''
  );
  const [clientName, setClientName] = useState<string>(
    initialData?.businessName || initialData?.customerName || ''
  );
  const [phone, setPhone] = useState<string>(initialData?.phone || '');

  // 4. Service
  const [service, setService] = useState<string>(
    initialData?.servicePackage || 'Meta Ads'
  );

  // 5. Separated Financials: Management Fee & Ad Budget
  const [managementFee, setManagementFee] = useState<number>(
    initialData?.managementFee !== undefined
      ? initialData.managementFee
      : (initialData?.serviceFee || 15000)
  );

  const [managementFeePaid, setManagementFeePaid] = useState<number>(
    initialData?.managementFeePaid !== undefined
      ? initialData.managementFeePaid
      : (initialData?.advancePaid || 0)
  );

  const [adBudget, setAdBudget] = useState<number>(
    initialData?.adBudget !== undefined
      ? initialData.adBudget
      : (initialData?.adTotalBudget || 0)
  );

  const [adBudgetPaid, setAdBudgetPaid] = useState<number>(
    initialData?.adBudgetPaid !== undefined
      ? initialData.adBudgetPaid
      : 0
  );

  // Auto-calculated Totals
  const totalDealValue = Number(managementFee || 0) + Number(adBudget || 0);
  const totalReceived = Number(managementFeePaid || 0) + Number(adBudgetPaid || 0);
  const totalDue = Math.max(0, totalDealValue - totalReceived);
  const mgmtDue = Math.max(0, Number(managementFee || 0) - Number(managementFeePaid || 0));
  const adDue = Math.max(0, Number(adBudget || 0) - Number(adBudgetPaid || 0));

  // 6. Sales Manager: Mahendra / Sankalp
  const [salesManager, setSalesManager] = useState<string>(
    initialData?.salesManager || initialData?.assignedExecutive || 'Mahendra'
  );

  // 7. Remarks
  const [remarks, setRemarks] = useState<string>(
    initialData?.remarks || initialData?.notes || ''
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // 1-Click Auto-Fetch From Selected Invoice
  const handleFetchInvoice = (invId: string) => {
    setSelectedInvoiceId(invId);
    if (!invId) return;

    const inv = invoices.find(i => i.id === invId);
    if (inv) {
      setInvoiceNumber(inv.invoiceNumber);
      const cName = inv.client?.name || '';
      setClientName(cName);
      if (inv.clientId) setSelectedClientId(inv.clientId);
      if (inv.client?.phone) setPhone(inv.client.phone);
      if (inv.invoiceDate) setDealDate(inv.invoiceDate);

      // Auto-set management fee from invoice grandTotal if not set
      if (inv.grandTotal) {
        setManagementFee(inv.grandTotal);
      }
      if (inv.amountPaid !== undefined) {
        setManagementFeePaid(inv.amountPaid);
      }

      // Check items for service name
      if (inv.items && inv.items.length > 0) {
        setService(inv.items[0].name || service);
      }
    }
  };

  // Handle client selection from CRM
  const handleClientSelect = (clientId: string) => {
    setSelectedClientId(clientId);
    if (!clientId) return;
    const cl = clients.find(c => c.id === clientId);
    if (cl) {
      setClientName(cl.name);
      if (cl.phone) setPhone(cl.phone);
    }
  };

  const quickServices = [
    'Meta Ads',
    'Google Ads',
    'Meta + Google Ads',
    'SEO & Website',
    'Social Media Management',
    'Full Digital Marketing'
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      setError('Please enter Client Name.');
      return;
    }

    if (totalDealValue <= 0) {
      setError('Please enter Management Fee or Ad Budget.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave({
        invoiceId: selectedInvoiceId || undefined,
        invoiceNumber: invoiceNumber || undefined,
        clientId: selectedClientId || undefined,
        customerName: clientName.trim(),
        businessName: clientName.trim(),
        phone: phone.trim(),
        onboardingDate: dealDate,
        servicePackage: service.trim(),
        
        // Separated Management Fee & Ad Budget
        managementFee: Number(managementFee),
        serviceFee: Number(managementFee),
        managementFeePaid: Number(managementFeePaid),
        adBudget: Number(adBudget),
        adTotalBudget: Number(adBudget),
        adBudgetPaid: Number(adBudgetPaid),
        hasAdsCampaign: Number(adBudget) > 0,
        
        // Total Deal Value, Received & Due
        totalPackageValue: Number(totalDealValue),
        totalDealValue: Number(totalDealValue),
        advancePaid: Number(totalReceived),
        totalReceived: Number(totalReceived),
        remainingBalance: Number(totalDue),
        totalDue: Number(totalDue),
        paymentStatus: totalDue === 0 ? 'paid' : (totalReceived > 0 ? 'partially_paid' : 'unpaid'),
        
        // Sales Manager & Remarks
        salesManager: salesManager.trim(),
        assignedExecutive: salesManager.trim(),
        remarks: remarks.trim(),
        notes: remarks.trim(),
        monthYear: dealDate.slice(0, 7),
        status: 'active'
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save deal.');
      setIsSubmitting(false);
    }
  };

  const formatINR = (val: number) => '₹' + Math.round(val || 0).toLocaleString('en-IN');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300 animate-in fade-in zoom-in-95 duration-150 font-sans">
        {/* Compact Excel Header Bar */}
        <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
              📊
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                {isEditing ? 'Edit Client Deal & Financials' : 'New Deal Entry (Excel Form)'}
              </h2>
              <p className="text-[11px] text-slate-300">
                Mgmt Fee • Ad Budget • Payment Received • Sales Manager
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {error && (
            <div className="p-2.5 bg-red-50 text-red-700 border border-red-300 rounded font-medium text-xs">
              {error}
            </div>
          )}

          {/* Quick Invoice Fetch Strip */}
          {invoices.length > 0 && (
            <div className="p-2.5 bg-indigo-50/70 border border-indigo-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-indigo-900 font-bold text-[11px]">
                <Zap className="w-3.5 h-3.5 text-indigo-600" />
                <span>Fetch from Customer Invoice:</span>
              </div>
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <select
                  value={selectedInvoiceId}
                  onChange={(e) => handleFetchInvoice(e.target.value)}
                  className="bg-white border border-indigo-300 rounded px-2.5 py-1 text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500 w-full sm:w-64"
                >
                  <option value="">-- Choose Invoice to Auto-Populate --</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} - {inv.client?.name || 'Customer'} ({formatINR(inv.grandTotal)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Row 1: Date & Sales Manager */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={dealDate}
                onChange={(e) => setDealDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-medium text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                <User className="w-3 h-3 text-slate-400" />
                Sales Manager <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSalesManager('Mahendra')}
                  className={`py-1.5 px-2 rounded text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    salesManager === 'Mahendra'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {salesManager === 'Mahendra' && <Check className="w-3 h-3" />}
                  Mahendra
                </button>
                <button
                  type="button"
                  onClick={() => setSalesManager('Sankalp')}
                  className={`py-1.5 px-2 rounded text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    salesManager === 'Sankalp'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {salesManager === 'Sankalp' && <Check className="w-3 h-3" />}
                  Sankalp
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Client Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                  <Briefcase className="w-3 h-3 text-slate-400" />
                  Client Name <span className="text-red-500">*</span>
                </label>
                {clients.length > 0 && (
                  <select
                    value={selectedClientId}
                    onChange={(e) => handleClientSelect(e.target.value)}
                    className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5"
                  >
                    <option value="">CRM Clients Dropdown</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <input
                type="text"
                required
                placeholder="Business or Customer Name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-semibold text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-400" />
                Phone / WhatsApp
              </label>
              <input
                type="text"
                placeholder="+91 98930..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-medium text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
          </div>

          {/* Row 3: Service */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-1">
              <Tag className="w-3 h-3 text-slate-400" />
              Service <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2 mb-1.5">
              <input
                type="text"
                required
                placeholder="e.g. Meta Ads, Google Ads, SEO & Website"
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-medium text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {quickServices.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setService(s)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                    service === s
                      ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 font-medium'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Row 4: Separated Management Fee & Ad Budget Breakdown Grid */}
          <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50/50">
            <div className="bg-slate-100 px-3 py-1.5 border-b border-slate-300 font-bold text-[11px] text-slate-700 flex items-center justify-between">
              <span>Financial Breakdown (Excel Data Grid)</span>
              <span className="text-[10px] text-slate-500 font-normal">Auto-computes Deal Value & Total Due</span>
            </div>

            <div className="p-3 space-y-3">
              {/* Management Fee Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center">
                <div>
                  <label className="block text-[10px] font-bold text-indigo-900 uppercase">
                    1. Management Fee (₹)
                  </label>
                  <div className="relative mt-0.5">
                    <span className="absolute left-2.5 top-1.5 font-bold text-slate-400 text-xs">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={managementFee}
                      onChange={(e) => setManagementFee(Number(e.target.value) || 0)}
                      className="w-full pl-6 pr-2 py-1 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-indigo-600"
                      placeholder="15000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-emerald-800 uppercase">
                    Mgmt Fee Received (₹)
                  </label>
                  <div className="relative mt-0.5">
                    <span className="absolute left-2.5 top-1.5 font-bold text-emerald-600 text-xs">₹</span>
                    <input
                      type="number"
                      min="0"
                      max={managementFee}
                      step="100"
                      value={managementFeePaid}
                      onChange={(e) => setManagementFeePaid(Number(e.target.value) || 0)}
                      className="w-full pl-6 pr-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-50/50 border border-emerald-300 rounded focus:ring-1 focus:ring-emerald-600"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase">
                    Mgmt Due (₹)
                  </label>
                  <div className="mt-0.5 px-2.5 py-1 text-xs font-bold bg-white border border-slate-200 rounded text-slate-700">
                    {formatINR(mgmtDue)}
                  </div>
                </div>
              </div>

              {/* Ad Budget Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-[10px] font-bold text-blue-900 uppercase">
                    2. Ad Budget (₹)
                  </label>
                  <div className="relative mt-0.5">
                    <span className="absolute left-2.5 top-1.5 font-bold text-slate-400 text-xs">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={adBudget}
                      onChange={(e) => setAdBudget(Number(e.target.value) || 0)}
                      className="w-full pl-6 pr-2 py-1 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-indigo-600"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-emerald-800 uppercase">
                    Ad Budget Received (₹)
                  </label>
                  <div className="relative mt-0.5">
                    <span className="absolute left-2.5 top-1.5 font-bold text-emerald-600 text-xs">₹</span>
                    <input
                      type="number"
                      min="0"
                      max={adBudget}
                      step="100"
                      value={adBudgetPaid}
                      onChange={(e) => setAdBudgetPaid(Number(e.target.value) || 0)}
                      className="w-full pl-6 pr-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-50/50 border border-emerald-300 rounded focus:ring-1 focus:ring-emerald-600"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase">
                    Ad Due (₹)
                  </label>
                  <div className="mt-0.5 px-2.5 py-1 text-xs font-bold bg-white border border-slate-200 rounded text-slate-700">
                    {formatINR(adDue)}
                  </div>
                </div>
              </div>

              {/* Grand Total Summary Box */}
              <div className="grid grid-cols-3 gap-2 bg-slate-900 text-white p-2.5 rounded-lg text-center font-mono">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-300 font-sans">Deal Value</div>
                  <div className="text-sm font-black text-white">{formatINR(totalDealValue)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-emerald-300 font-sans">Total Received</div>
                  <div className="text-sm font-black text-emerald-400">{formatINR(totalReceived)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-amber-300 font-sans">Total Due</div>
                  <div className={`text-sm font-black ${totalDue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {formatINR(totalDue)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 5: Remarks */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-1">
              <MessageSquare className="w-3 h-3 text-slate-400" />
              Remarks / Notes
            </label>
            <input
              type="text"
              placeholder="e.g. Lead generation campaign, 2nd installment due on 15th, UPI payment..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>Saving...</>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {isEditing ? 'Update Deal' : 'Save Deal to Sheet'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
