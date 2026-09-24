import React, { useState, useEffect } from 'react';
import { CustomerOnboarding, Client, Invoice, DealServiceItem } from '../../types';
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
  Zap,
  Plus,
  Trash2,
  Layers
} from 'lucide-react';

interface OnboardingEditorModalProps {
  initialData?: CustomerOnboarding | null;
  clients: Client[];
  invoices?: Invoice[];
  onClose: () => void;
  onSave: (data: Partial<CustomerOnboarding>) => Promise<void>;
}

export interface DealServiceEntry {
  id: string;
  serviceName: string;
  managementFee: number;
  managementFeePaid: number;
  adBudget: number;
  adBudgetPaid: number;
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

  // 4. Multi-Service Management
  const quickServices = [
    'Meta Ads',
    'Google Ads',
    'Meta + Google Ads',
    'SEO & Website',
    'Social Media Management',
    'Full Digital Marketing'
  ];

  const createDefaultService = (overrides?: Partial<DealServiceEntry>): DealServiceEntry => ({
    id: `srv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    serviceName: 'Meta Ads',
    managementFee: 15000,
    managementFeePaid: 0,
    adBudget: 0,
    adBudgetPaid: 0,
    ...overrides
  });

  const getInitialServices = (): DealServiceEntry[] => {
    if (initialData?.services && Array.isArray(initialData.services) && initialData.services.length > 0) {
      return initialData.services.map((s, idx) => ({
        id: s.id || `srv_${idx + 1}_${Date.now()}`,
        serviceName: s.serviceName || `Service ${idx + 1}`,
        managementFee: Number(s.managementFee) || 0,
        managementFeePaid: Number(s.managementFeePaid) || 0,
        adBudget: Number(s.adBudget) || 0,
        adBudgetPaid: Number(s.adBudgetPaid) || 0
      }));
    }

    // Fallback for legacy single-service record
    if (initialData) {
      return [{
        id: `srv_${Date.now()}`,
        serviceName: initialData.servicePackage || 'Meta Ads',
        managementFee: initialData.managementFee !== undefined
          ? Number(initialData.managementFee)
          : (Number(initialData.serviceFee) || 15000),
        managementFeePaid: initialData.managementFeePaid !== undefined
          ? Number(initialData.managementFeePaid)
          : (Number(initialData.advancePaid) || 0),
        adBudget: initialData.adBudget !== undefined
          ? Number(initialData.adBudget)
          : (Number(initialData.adTotalBudget) || 0),
        adBudgetPaid: initialData.adBudgetPaid !== undefined
          ? Number(initialData.adBudgetPaid)
          : 0
      }];
    }

    return [createDefaultService()];
  };

  const [services, setServices] = useState<DealServiceEntry[]>(getInitialServices);

  // Sync state if initialData changes
  useEffect(() => {
    if (initialData) {
      setDealDate(initialData.onboardingDate || new Date().toISOString().split('T')[0]);
      setSelectedInvoiceId(initialData.invoiceId || '');
      setInvoiceNumber(initialData.invoiceNumber || '');
      setSelectedClientId(initialData.clientId || '');
      setClientName(initialData.businessName || initialData.customerName || '');
      setPhone(initialData.phone || '');
      setSalesManager(initialData.salesManager || initialData.assignedExecutive || 'Mahendra');
      setRemarks(initialData.remarks || initialData.notes || '');
      setServices(getInitialServices());
    }
  }, [initialData]);

  // Service list actions
  const handleAddService = () => {
    const existingNames = new Set(services.map(s => s.serviceName.toLowerCase().trim()));
    const nextQuick = quickServices.find(qs => !existingNames.has(qs.toLowerCase())) || 'Google Ads';

    setServices(prev => [
      ...prev,
      createDefaultService({
        serviceName: nextQuick,
        managementFee: 10000,
        managementFeePaid: 0,
        adBudget: 0,
        adBudgetPaid: 0
      })
    ]);
  };

  const handleRemoveService = (indexToRemove: number) => {
    if (services.length <= 1) return;
    setServices(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const updateService = (index: number, patch: Partial<DealServiceEntry>) => {
    setServices(prev => prev.map((item, idx) => idx === index ? { ...item, ...patch } : item));
  };

  // Auto-calculated Totals across ALL services
  const totalMgmtFee = services.reduce((acc, s) => acc + (Number(s.managementFee) || 0), 0);
  const totalMgmtPaid = services.reduce((acc, s) => acc + (Number(s.managementFeePaid) || 0), 0);
  const totalAdBudget = services.reduce((acc, s) => acc + (Number(s.adBudget) || 0), 0);
  const totalAdPaid = services.reduce((acc, s) => acc + (Number(s.adBudgetPaid) || 0), 0);

  const totalDealValue = totalMgmtFee + totalAdBudget;
  const totalReceived = totalMgmtPaid + totalAdPaid;
  const totalDue = Math.max(0, totalDealValue - totalReceived);

  // 5. Sales Manager: Mahendra / Sankalp
  const [salesManager, setSalesManager] = useState<string>(
    initialData?.salesManager || initialData?.assignedExecutive || 'Mahendra'
  );

  // 6. Remarks
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

      // Populate services from invoice items if present
      if (inv.items && inv.items.length > 0) {
        const invServices: DealServiceEntry[] = inv.items.map((item, idx) => {
          const itemTotal = Number(item.total) || (Number(item.rate || 0) * Number(item.quantity || 1) + Number(item.totalGstAmount || 0));
          const itemPaid = inv.grandTotal > 0 && inv.amountPaid
            ? Math.round((itemTotal / inv.grandTotal) * inv.amountPaid)
            : 0;

          return {
            id: `srv_inv_${idx}_${Date.now()}`,
            serviceName: item.name || `Service ${idx + 1}`,
            managementFee: itemTotal,
            managementFeePaid: itemPaid,
            adBudget: 0,
            adBudgetPaid: 0
          };
        });
        setServices(invServices);
      } else {
        setServices([
          createDefaultService({
            serviceName: 'Digital Marketing Service',
            managementFee: inv.grandTotal || 15000,
            managementFeePaid: inv.amountPaid || 0,
            adBudget: 0,
            adBudgetPaid: 0
          })
        ]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      setError('Please enter Client Name.');
      return;
    }

    if (services.length === 0) {
      setError('Please add at least one service to the deal.');
      return;
    }

    const hasEmptyServiceName = services.some(s => !s.serviceName.trim());
    if (hasEmptyServiceName) {
      setError('Please enter a service name for all services.');
      return;
    }

    if (totalDealValue <= 0) {
      setError('Please enter Management Fee or Ad Budget for your services.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const sanitizedServices: DealServiceItem[] = services.map(s => {
        const mFee = Number(s.managementFee) || 0;
        const mPaid = Number(s.managementFeePaid) || 0;
        const aBud = Number(s.adBudget) || 0;
        const aPaid = Number(s.adBudgetPaid) || 0;
        const sVal = mFee + aBud;
        const sRec = mPaid + aPaid;
        const sDue = Math.max(0, sVal - sRec);
        return {
          id: s.id,
          serviceName: s.serviceName.trim(),
          managementFee: mFee,
          managementFeePaid: mPaid,
          adBudget: aBud,
          adBudgetPaid: aPaid,
          dealValue: sVal,
          totalReceived: sRec,
          totalDue: sDue
        };
      });

      const combinedServicePackage = sanitizedServices.map(s => s.serviceName).join(', ');

      await onSave({
        invoiceId: selectedInvoiceId || undefined,
        invoiceNumber: invoiceNumber || undefined,
        clientId: selectedClientId || undefined,
        customerName: clientName.trim(),
        businessName: clientName.trim(),
        phone: phone.trim(),
        onboardingDate: dealDate,
        servicePackage: combinedServicePackage,
        
        // Nested Services Array with per-service breakdowns
        services: sanitizedServices,

        // Summed Management Fee & Ad Budget across all services
        managementFee: totalMgmtFee,
        serviceFee: totalMgmtFee,
        managementFeePaid: totalMgmtPaid,
        adBudget: totalAdBudget,
        adTotalBudget: totalAdBudget,
        adBudgetPaid: totalAdPaid,
        hasAdsCampaign: totalAdBudget > 0,
        
        // Total Deal Value, Received & Due summed across all services
        totalPackageValue: totalDealValue,
        totalDealValue: totalDealValue,
        advancePaid: totalReceived,
        totalReceived: totalReceived,
        remainingBalance: totalDue,
        totalDue: totalDue,
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
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-300 animate-in fade-in zoom-in-95 duration-150 font-sans">
        {/* Compact Excel Header Bar */}
        <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
              📊
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                {isEditing ? 'Edit Client Deal & Financials' : 'New Deal Entry (Excel Form)'}
              </h2>
              <p className="text-[11px] text-slate-300">
                Multi-Service Tracking • Mgmt Fee • Ad Budget • Payment Received • Sales Manager
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

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-4 space-y-3.5 text-xs flex-1">
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

          {/* Repeatable Services & Independent Financial Breakdowns */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                Services & Financial Breakdown ({services.length} {services.length === 1 ? 'Service' : 'Services'})
              </label>
              <span className="text-[10px] text-slate-500 font-medium">
                Each service tracks independent fee, ad budget & payment received
              </span>
            </div>

            {services.map((srv, index) => {
              const sMgmt = Number(srv.managementFee) || 0;
              const sMgmtPaid = Number(srv.managementFeePaid) || 0;
              const sMgmtDue = Math.max(0, sMgmt - sMgmtPaid);

              const sAd = Number(srv.adBudget) || 0;
              const sAdPaid = Number(srv.adBudgetPaid) || 0;
              const sAdDue = Math.max(0, sAd - sAdPaid);

              const sTotal = sMgmt + sAd;
              const sTotalPaid = sMgmtPaid + sAdPaid;
              const sTotalDue = Math.max(0, sTotal - sTotalPaid);

              return (
                <div
                  key={srv.id || index}
                  className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50/50 shadow-2xs transition-all"
                >
                  {/* Service Card Header Bar */}
                  <div className="bg-slate-100 px-3 py-2 border-b border-slate-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="font-bold text-xs text-slate-800">
                        Service #{index + 1}: <span className="text-indigo-700 font-extrabold">{srv.serviceName || 'Select/Enter Service'}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Service Subtotal Badge */}
                      <span className="text-[10px] font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                        Value: <strong className="text-slate-900">{formatINR(sTotal)}</strong> | Due: <strong className={sTotalDue > 0 ? 'text-amber-700' : 'text-emerald-700'}>{formatINR(sTotalDue)}</strong>
                      </span>

                      {/* Remove Service Button */}
                      {services.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveService(index)}
                          className="text-slate-400 hover:text-red-600 p-1 hover:bg-red-50 rounded transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-semibold"
                          title="Remove this service"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          <span className="hidden sm:inline text-red-600">Remove</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Service Name Input & Quick Selectors */}
                  <div className="p-3 bg-white border-b border-slate-200 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-slate-400" />
                      <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">
                        Service Name <span className="text-red-500">*</span>
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        placeholder="e.g. Meta Ads, Google Ads, SEO & Website, Social Media Management"
                        value={srv.serviceName}
                        onChange={(e) => updateService(index, { serviceName: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-semibold text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {quickServices.map((qs) => (
                        <button
                          key={qs}
                          type="button"
                          onClick={() => updateService(index, { serviceName: qs })}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            srv.serviceName === qs
                              ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 font-medium'
                          }`}
                        >
                          {qs}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Financial Breakdown (Excel Data Grid Style) */}
                  <div className="p-3 space-y-3 bg-slate-50/50">
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
                            value={srv.managementFee}
                            onChange={(e) => updateService(index, { managementFee: Number(e.target.value) || 0 })}
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
                            max={srv.managementFee}
                            step="100"
                            value={srv.managementFeePaid}
                            onChange={(e) => updateService(index, { managementFeePaid: Number(e.target.value) || 0 })}
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
                          {formatINR(sMgmtDue)}
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
                            value={srv.adBudget}
                            onChange={(e) => updateService(index, { adBudget: Number(e.target.value) || 0 })}
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
                            max={srv.adBudget}
                            step="100"
                            value={srv.adBudgetPaid}
                            onChange={(e) => updateService(index, { adBudgetPaid: Number(e.target.value) || 0 })}
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
                          {formatINR(sAdDue)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* + Add Another Service Button */}
            <button
              type="button"
              onClick={handleAddService}
              className="w-full py-2.5 px-3 border-2 border-dashed border-indigo-300 hover:border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
            >
              <Plus className="w-4 h-4 text-indigo-600" />
              <span>+ Add Another Service</span>
            </button>
          </div>

          {/* Grand Total Summary Box (Sums across ALL services) */}
          <div className="grid grid-cols-3 gap-2 bg-slate-900 text-white p-3 rounded-lg text-center font-mono shadow-md">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-300 font-sans">
                Deal Value ({services.length} {services.length === 1 ? 'Service' : 'Services'})
              </div>
              <div className="text-sm font-black text-white">{formatINR(totalDealValue)}</div>
              <div className="text-[9px] text-slate-400 font-sans">
                Fee: {formatINR(totalMgmtFee)} | Ads: {formatINR(totalAdBudget)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-emerald-300 font-sans">Total Received</div>
              <div className="text-sm font-black text-emerald-400">{formatINR(totalReceived)}</div>
              <div className="text-[9px] text-emerald-300/80 font-sans">
                Fee: {formatINR(totalMgmtPaid)} | Ads: {formatINR(totalAdPaid)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-300 font-sans">Total Due</div>
              <div className={`text-sm font-black ${totalDue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {formatINR(totalDue)}
              </div>
              <div className="text-[9px] text-slate-400 font-sans">
                {totalDue === 0 ? 'Fully Paid' : 'Pending Balance'}
              </div>
            </div>
          </div>

          {/* Row: Remarks */}
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

          {/* Modal Actions Footer */}
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
