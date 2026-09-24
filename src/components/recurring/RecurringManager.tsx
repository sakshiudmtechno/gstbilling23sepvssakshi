import React, { useState, useMemo } from 'react';
import { RecurringInvoice, Client } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { api } from '../../utils/api';
import { calculateLineItem } from '../../utils/taxCalculator';
import { Plus, Repeat, Play, Pause, Trash2, Calendar, CheckCircle2, ArrowRight, X, Layers, Sparkles } from 'lucide-react';
import { toast } from '../common/Toast';

interface RecurringManagerProps {
  recurringInvoices: RecurringInvoice[];
  clients: Client[];
  onRefresh: () => void;
  onInvoiceGenerated: () => void;
}

interface FormLineItem {
  id: string;
  name: string;
  description: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  rate: number;
  gstRate: number;
}

const FREQUENCY_OPTIONS: { value: RecurringInvoice['frequency']; label: string }[] = [
  { value: 'weekly', label: 'Weekly (Every 7 days)' },
  { value: 'monthly', label: 'Monthly (Every 1 month)' },
  { value: 'quarterly', label: 'Quarterly (Every 3 months)' },
  { value: 'half_yearly', label: 'Half-Yearly (Every 6 months)' },
  { value: 'yearly', label: 'Yearly (Every 12 months / AMC)' }
];

export const RecurringManager: React.FC<RecurringManagerProps> = ({
  recurringInvoices,
  clients,
  onRefresh,
  onInvoiceGenerated
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('Monthly Cloud & Web Server Maintenance AMC');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [frequency, setFrequency] = useState<RecurringInvoice['frequency']>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [terms, setTerms] = useState('Standard AMC & Retainer SLA agreement applies. Payment due within 15 days of invoice date.');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Line items state
  const [items, setItems] = useState<FormLineItem[]>([
    {
      id: `item_${Date.now()}`,
      name: 'Cloud & Web Server Maintenance AMC',
      description: 'Monthly uptime monitoring, security updates, and SLA support',
      hsnSac: '9983',
      quantity: 1,
      unit: 'MONTH',
      rate: 15000,
      gstRate: 18
    }
  ]);

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === selectedClientId);
  }, [clients, selectedClientId]);

  // Check intra vs inter state (Seller defaults to MP code 23)
  const isInterState = useMemo(() => {
    if (!selectedClient?.stateCode) return false;
    return selectedClient.stateCode !== '23';
  }, [selectedClient]);

  // Live financial calculation
  const calculations = useMemo(() => {
    let subtotal = 0;
    let totalTax = 0;

    items.forEach(item => {
      const lineTaxable = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      const lineTax = (lineTaxable * (Number(item.gstRate) || 0)) / 100;
      subtotal += lineTaxable;
      totalTax += lineTax;
    });

    const grandTotal = Math.round(subtotal + totalTax);
    const roundOff = Number((grandTotal - (subtotal + totalTax)).toFixed(2));

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      cgst: isInterState ? 0 : Math.round((totalTax / 2) * 100) / 100,
      sgst: isInterState ? 0 : Math.round((totalTax / 2) * 100) / 100,
      igst: isInterState ? Math.round(totalTax * 100) / 100 : 0,
      totalTax: Math.round(totalTax * 100) / 100,
      roundOff,
      grandTotal
    };
  }, [items, isInterState]);

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        name: '',
        description: '',
        hsnSac: '9983',
        quantity: 1,
        unit: 'MONTH',
        rate: 0,
        gstRate: 18
      }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      toast.error('Subscription must have at least one line item');
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof FormLineItem, value: any) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleGenerateNow = async (rec: RecurringInvoice) => {
    try {
      const inv = await api.triggerRecurringInvoice(rec.id);
      toast.success(`Invoice #${inv.invoiceNumber} generated successfully!`);
      onRefresh();
      onInvoiceGenerated();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate invoice');
    }
  };

  const handleToggleStatus = async (rec: RecurringInvoice) => {
    try {
      const nextStatus = rec.status === 'active' ? 'paused' : 'active';
      await api.updateRecurringInvoice(rec.id, { status: nextStatus });
      toast.success(`Recurring subscription ${nextStatus}`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to toggle status');
    }
  };

  const handleDelete = async (rec: RecurringInvoice) => {
    if (!window.confirm(`Are you sure you want to delete recurring subscription "${rec.title || rec.recurringNumber}"?`)) {
      return;
    }
    try {
      await api.deleteRecurring(rec.id);
      toast.success('Subscription deleted successfully');
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete subscription');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) {
      toast.error('Please choose a client');
      return;
    }

    if (items.length === 0 || items.some(it => !it.name.trim())) {
      toast.error('Please provide a name for each line item');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Partial<RecurringInvoice> = {
        title: title.trim(),
        clientId: selectedClient.id,
        client: selectedClient,
        clientName: selectedClient.name,
        frequency,
        startDate,
        nextInvoiceDate: startDate,
        status: 'active',
        terms,
        items: items.map(it => {
          const calc = calculateLineItem({
            id: it.id,
            name: it.name.trim(),
            description: it.description.trim(),
            hsnSac: it.hsnSac.trim() || '9983',
            quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
            unit: it.unit || 'MONTH',
            rate: Number(it.rate) >= 0 ? Number(it.rate) : 0,
            discountType: 'percentage',
            discountValue: 0,
            discountAmount: 0,
            gstRate: Number(it.gstRate) || 0
          }, isInterState);
          return {
            id: it.id,
            name: it.name.trim(),
            description: it.description.trim(),
            hsnSac: it.hsnSac.trim() || '9983',
            quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
            unit: it.unit || 'MONTH',
            rate: Number(it.rate) >= 0 ? Number(it.rate) : 0,
            discountType: 'percentage' as const,
            discountValue: 0,
            discountAmount: 0,
            taxableAmount: calc.taxableAmount,
            gstRate: Number(it.gstRate) || 0,
            cgstAmount: calc.cgstAmount,
            sgstAmount: calc.sgstAmount,
            igstAmount: calc.igstAmount,
            totalGstAmount: calc.totalGstAmount,
            total: calc.total
          };
        }),
        invoiceTemplateData: {
          currency: 'INR',
          placeOfSupply: selectedClient.state,
          placeOfSupplyCode: selectedClient.stateCode,
          subtotal: calculations.subtotal,
          totalTaxableAmount: calculations.subtotal,
          totalCgst: calculations.cgst,
          totalSgst: calculations.sgst,
          totalIgst: calculations.igst,
          totalGst: calculations.totalTax,
          roundOff: calculations.roundOff,
          grandTotal: calculations.grandTotal
        }
      };

      await api.createRecurringInvoice(payload);
      setIsCreating(false);
      toast.success('Recurring subscription created successfully!');
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create recurring subscription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCycleGrandTotal = (rec: RecurringInvoice): number => {
    if (rec.invoiceTemplateData?.grandTotal) {
      return rec.invoiceTemplateData.grandTotal;
    }
    if (Array.isArray(rec.items) && rec.items.length > 0) {
      return rec.items.reduce((sum, item) => {
        const taxable = (Number(item.quantity) || 1) * (Number(item.rate) || 0);
        const tax = (taxable * (Number(item.gstRate) || 0)) / 100;
        return sum + taxable + tax;
      }, 0);
    }
    return 0;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">Recurring Invoices & AMC</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {recurringInvoices.length} Active Schedules
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Automate weekly, monthly, quarterly, half-yearly, or annual AMC retainer billing with GST compliance
          </p>
        </div>

        <button
          onClick={() => {
            setIsCreating(true);
            if (clients.length > 0 && !selectedClientId) {
              setSelectedClientId(clients[0].id);
            }
          }}
          className="px-4 py-2 bg-indigo-900 hover:bg-indigo-800 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Setup Recurring Schedule
        </button>
      </div>

      {recurringInvoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center mx-auto">
            <Repeat className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">No recurring subscriptions yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Create recurring profiles for retainer clients, monthly maintenance contracts, or hosting subscriptions.
          </p>
          <button
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 bg-indigo-900 hover:bg-indigo-800 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Create First Schedule
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recurringInvoices.map((rec) => {
            const grandTotal = getCycleGrandTotal(rec);
            const frequencyLabel = FREQUENCY_OPTIONS.find(f => f.value === rec.frequency)?.label.split(' ')[0] || rec.frequency;

            return (
              <div key={rec.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg shrink-0">
                        <Repeat className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 text-xs truncate" title={rec.title}>
                          {rec.title || 'Recurring AMC'}
                        </h3>
                        <p className="text-[11px] text-slate-500 truncate">
                          {rec.client?.name || rec.clientName || 'Client'}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      rec.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : rec.status === 'paused'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {rec.status}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Frequency:</span>
                      <span className="font-bold text-slate-900 uppercase text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200">
                        {frequencyLabel}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Next Scheduled:</span>
                      <span className="font-bold font-mono text-indigo-900">{rec.nextInvoiceDate || rec.startDate}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Items:</span>
                      <span className="text-slate-700 font-medium">
                        {rec.items?.length || 1} {rec.items?.length === 1 ? 'service item' : 'service items'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                      <span className="text-slate-600 font-medium">Cycle Amount (incl. GST):</span>
                      <span className="font-bold font-mono text-slate-900 text-sm">{formatINR(grandTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleStatus(rec)}
                      className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1 p-1 hover:bg-slate-100 rounded transition-colors"
                      title={rec.status === 'active' ? 'Pause automatic generation' : 'Resume schedule'}
                    >
                      {rec.status === 'active' ? <Pause className="w-3.5 h-3.5 text-amber-600" /> : <Play className="w-3.5 h-3.5 text-emerald-600" />}
                      <span className="text-[11px]">{rec.status === 'active' ? 'Pause' : 'Resume'}</span>
                    </button>

                    <button
                      onClick={() => handleDelete(rec)}
                      className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded transition-colors"
                      title="Delete schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    onClick={() => handleGenerateNow(rec)}
                    className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-md font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    Generate Now <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Recurring Subscription Modal with Full Line Item Support */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 my-8">
            <div className="bg-indigo-950 px-6 py-4 text-white flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-indigo-300" />
                  New Recurring Subscription
                </h2>
                <p className="text-xs text-indigo-200">
                  Configure automated GST-compliant recurring retainer schedules & AMC contracts
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-indigo-200 hover:text-white p-1 rounded-lg hover:bg-indigo-900/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {/* Profile Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Subscription / AMC Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Monthly Cloud & Web Server Maintenance AMC"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Client <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">-- Choose Client --</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.city || 'N/A'}, {c.state}) {c.gstin ? `[GSTIN: ${c.gstin}]` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedClient && (
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 px-1">
                      <span>Place of Supply: {selectedClient.state} ({selectedClient.stateCode})</span>
                      <span className={`font-semibold ${isInterState ? 'text-amber-700' : 'text-indigo-700'}`}>
                        {isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Billing Frequency <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {FREQUENCY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      First Invoice Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Line Items Section */}
              <div className="pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-700" />
                      Recurring Service Line Items
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Configure line items, HSN/SAC codes, and GST rates applied to every generated invoice
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-md font-semibold text-[11px] flex items-center gap-1 border border-indigo-200 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Service Item
                  </button>
                </div>

                <div className="space-y-2">
                  {items.map((item, index) => {
                    const lineTaxable = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                    const lineTax = (lineTaxable * (Number(item.gstRate) || 0)) / 100;
                    const lineTotal = lineTaxable + lineTax;

                    return (
                      <div key={item.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-slate-600">Item #{index + 1}</span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(index)}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded"
                              title="Remove item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                          <div className="md:col-span-5">
                            <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Service / Item Name</label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Dedicated Server Hosting"
                              value={item.name}
                              onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-[10px] font-medium text-slate-600 mb-0.5">HSN/SAC</label>
                            <input
                              type="text"
                              required
                              value={item.hsnSac}
                              onChange={(e) => handleItemChange(index, 'hsnSac', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-xs"
                              placeholder="9983"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Quantity & Unit</label>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                required
                                value={item.quantity}
                                onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                                className="w-14 px-2 py-1.5 bg-white border border-slate-300 rounded font-mono text-xs"
                              />
                              <select
                                value={item.unit}
                                onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                                className="w-full px-1.5 py-1.5 bg-white border border-slate-300 rounded text-[11px]"
                              >
                                <option value="MONTH">MONTH</option>
                                <option value="NOS">NOS</option>
                                <option value="HOURS">HOURS</option>
                                <option value="YEAR">YEAR</option>
                              </select>
                            </div>
                          </div>

                          <div className="md:col-span-3">
                            <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Rate (₹) & GST</label>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                required
                                value={item.rate}
                                onChange={(e) => handleItemChange(index, 'rate', Number(e.target.value))}
                                className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-xs"
                                placeholder="15000"
                              />
                              <select
                                value={item.gstRate}
                                onChange={(e) => handleItemChange(index, 'gstRate', Number(e.target.value))}
                                className="w-20 px-1 py-1.5 bg-white border border-slate-300 rounded font-semibold text-[11px]"
                              >
                                <option value={0}>0%</option>
                                <option value={5}>5%</option>
                                <option value={12}>12%</option>
                                <option value={18}>18%</option>
                                <option value={28}>28%</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1 px-1">
                          <input
                            type="text"
                            placeholder="Optional line description..."
                            value={item.description}
                            onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                            className="w-2/3 px-2 py-1 bg-white border border-slate-200 rounded text-[11px]"
                          />
                          <div className="text-right">
                            <span>Taxable: </span>
                            <span className="font-mono font-semibold text-slate-800">{formatINR(lineTaxable)}</span>
                            <span className="mx-1">|</span>
                            <span>Total: </span>
                            <span className="font-mono font-bold text-indigo-900">{formatINR(lineTotal)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* GST Financial Summary Card */}
              <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Taxable Subtotal:</span>
                  <span className="font-mono font-semibold text-slate-900">{formatINR(calculations.subtotal)}</span>
                </div>

                {isInterState ? (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">Integrated GST (IGST):</span>
                    <span className="font-mono font-semibold text-indigo-900">{formatINR(calculations.igst)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-600">Central GST (CGST):</span>
                      <span className="font-mono font-semibold text-indigo-900">{formatINR(calculations.cgst)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-600">State GST (SGST):</span>
                      <span className="font-mono font-semibold text-indigo-900">{formatINR(calculations.sgst)}</span>
                    </div>
                  </>
                )}

                {calculations.roundOff !== 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Round Off:</span>
                    <span className="font-mono text-slate-600">{formatINR(calculations.roundOff)}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-indigo-200 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Total Billed Each Cycle:</span>
                    <span className="block text-[11px] text-indigo-800 font-medium capitalize">
                      {FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label}
                    </span>
                  </div>
                  <span className="font-bold font-mono text-indigo-950 text-base">
                    {formatINR(calculations.grandTotal)}
                  </span>
                </div>
              </div>

              {/* Terms / Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contract Terms / Invoice Note</label>
                <textarea
                  rows={2}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                  placeholder="Terms appearing on each recurring invoice..."
                />
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
