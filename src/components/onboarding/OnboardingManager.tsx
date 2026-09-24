import React, { useState, useEffect, useMemo } from 'react';
import { CustomerOnboarding, Client, Invoice } from '../../types';
import { api } from '../../utils/api';
import {
  Plus,
  Search,
  Calendar,
  IndianRupee,
  Phone,
  MessageSquare,
  FileText,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Filter,
  Check,
  TrendingUp,
  User,
  CreditCard,
  Building,
  Download,
  Share2,
  Zap,
  Layers,
  FileSpreadsheet
} from 'lucide-react';
import { OnboardingEditorModal } from './OnboardingEditorModal';
import { OnboardingPaymentModal } from './OnboardingPaymentModal';
import { toast, showConfirm, showPrompt } from '../common/Toast';

interface OnboardingManagerProps {
  clients: Client[];
  invoices?: Invoice[];
  onCreateInvoiceForClient?: (clientData: any, invoiceDetails?: any) => void;
  onRefreshGlobal?: () => void;
}

export const OnboardingManager: React.FC<OnboardingManagerProps> = ({
  clients,
  invoices = [],
  onCreateInvoiceForClient,
  onRefreshGlobal
}) => {
  const [onboardings, setOnboardings] = useState<CustomerOnboarding[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedManager, setSelectedManager] = useState<'all' | 'Mahendra' | 'Sankalp'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<CustomerOnboarding | null>(null);
  const [paymentItem, setPaymentItem] = useState<CustomerOnboarding | null>(null);

  const fetchOnboardings = async () => {
    setIsLoading(true);
    try {
      const list = await api.getOnboardings({ month: selectedMonth });
      setOnboardings(list);
    } catch (err) {
      console.error('Failed to load deals data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOnboardings();
  }, [selectedMonth]);

  const handleSaveDeal = async (data: Partial<CustomerOnboarding>) => {
    if (editingItem) {
      await api.updateOnboarding(editingItem.id, data);
    } else {
      await api.createOnboarding(data);
    }
    fetchOnboardings();
    if (onRefreshGlobal) onRefreshGlobal();
  };

  const handleDeleteDeal = async (id: string, name: string) => {
    showConfirm({
      title: 'Delete Deal',
      message: `Are you sure you want to delete the deal for "${name}"?`,
      confirmText: 'Delete Deal',
      isDanger: true,
      onConfirm: async () => {
        try {
          await api.deleteOnboarding(id);
          toast.success(`Deleted deal for "${name}"`);
          fetchOnboardings();
          if (onRefreshGlobal) onRefreshGlobal();
        } catch (err: any) {
          toast.error(err.message || 'Failed to delete deal');
        }
      }
    });
  };

  // Quick 1-Click Import from Invoices that aren't yet in Deals sheet
  const handleImportInvoices = async () => {
    if (invoices.length === 0) {
      toast.info('No invoices found to import.');
      return;
    }

    const existingInvoiceIds = new Set(onboardings.map(o => o.invoiceId).filter(Boolean));
    const unimported = invoices.filter(inv => !existingInvoiceIds.has(inv.id));

    if (unimported.length === 0) {
      toast.info('All current invoices are already present in the deals sheet!');
      return;
    }

    showConfirm({
      title: 'Import Invoices',
      message: `Found ${unimported.length} invoices. Would you like to import them into the Deals Sheet?`,
      confirmText: 'Import Now',
      isDanger: false,
      onConfirm: async () => {
        setIsLoading(true);
        try {
          for (const inv of unimported) {
            const mgmtVal = inv.grandTotal || 0;
            const paidVal = inv.amountPaid || 0;
            const dueVal = Math.max(0, mgmtVal - paidVal);
            const clientName = inv.client?.name || 'Customer';
            const clientPhone = inv.client?.phone || '';

            let importedServices: any[] = [];
            let serviceName = 'Digital Marketing Service';

            if (inv.items && inv.items.length > 0) {
              serviceName = inv.items.map(it => it.name).filter(Boolean).join(', ') || 'Digital Marketing Service';
              importedServices = inv.items.map((it, idx) => {
                const itemTotal = Number(it.total) || (Number(it.rate || 0) * Number(it.quantity || 1) + Number(it.totalGstAmount || 0));
                const itemPaid = inv.grandTotal > 0 && inv.amountPaid
                  ? Math.round((itemTotal / inv.grandTotal) * inv.amountPaid)
                  : 0;

                return {
                  id: `srv_imp_${idx}_${Date.now()}`,
                  serviceName: it.name || `Service ${idx + 1}`,
                  managementFee: itemTotal,
                  managementFeePaid: itemPaid,
                  adBudget: 0,
                  adBudgetPaid: 0,
                  dealValue: itemTotal,
                  totalReceived: itemPaid,
                  totalDue: Math.max(0, itemTotal - itemPaid)
                };
              });
            } else {
              importedServices = [{
                id: `srv_imp_${Date.now()}`,
                serviceName,
                managementFee: mgmtVal,
                managementFeePaid: paidVal,
                adBudget: 0,
                adBudgetPaid: 0,
                dealValue: mgmtVal,
                totalReceived: paidVal,
                totalDue: dueVal
              }];
            }

            await api.createOnboarding({
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              clientId: inv.clientId,
              customerName: clientName,
              businessName: clientName,
              phone: clientPhone,
              onboardingDate: inv.invoiceDate || new Date().toISOString().split('T')[0],
              servicePackage: serviceName,
              services: importedServices,
              managementFee: mgmtVal,
              serviceFee: mgmtVal,
              managementFeePaid: paidVal,
              adBudget: 0,
              adTotalBudget: 0,
              adBudgetPaid: 0,
              totalDealValue: mgmtVal,
              totalPackageValue: mgmtVal,
              advancePaid: paidVal,
              totalReceived: paidVal,
              remainingBalance: dueVal,
              totalDue: dueVal,
              paymentStatus: dueVal === 0 ? 'paid' : (paidVal > 0 ? 'partially_paid' : 'unpaid'),
              salesManager: 'Mahendra',
              assignedExecutive: 'Mahendra',
              remarks: `Imported from Invoice ${inv.invoiceNumber}`,
              notes: `Imported from Invoice ${inv.invoiceNumber}`,
              monthYear: (inv.invoiceDate || new Date().toISOString()).slice(0, 7),
              status: 'active'
            });
          }
          fetchOnboardings();
          if (onRefreshGlobal) onRefreshGlobal();
          toast.success(`Successfully imported ${unimported.length} invoices into the deals sheet!`);
        } catch (err: any) {
          toast.error('Failed to import invoices: ' + (err.message || 'Unknown error'));
        } finally {
          setIsLoading(false);
        }
      }
    });
  };

  // Export to CSV / Excel
  const handleExportCSV = () => {
    if (onboardings.length === 0) {
      toast.info('No data to export.');
      return;
    }

    const headers = [
      'Date',
      'Client Name',
      'Invoice Number',
      'Service',
      'Management Fee (INR)',
      'Mgmt Fee Received (INR)',
      'Ad Budget (INR)',
      'Ad Budget Received (INR)',
      'Total Deal Value (INR)',
      'Total Received (INR)',
      'Total Due (INR)',
      'Sales Manager',
      'Remarks',
      'Phone'
    ];

    const rows = filteredList.map(item => {
      const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
      const mgmtRec = item.managementFeePaid !== undefined ? item.managementFeePaid : (item.advancePaid || 0);
      const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
      const adRec = item.adBudgetPaid || 0;
      const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
      const totalRec = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || (mgmtRec + adRec));
      const due = item.totalDue !== undefined ? item.totalDue : (item.remainingBalance ?? Math.max(0, dealVal - totalRec));

      return [
        `"${item.onboardingDate || ''}"`,
        `"${(item.businessName || item.customerName || '').replace(/"/g, '""')}"`,
        `"${item.invoiceNumber || ''}"`,
        `"${(item.servicePackage || '').replace(/"/g, '""')}"`,
        mgmt,
        mgmtRec,
        ad,
        adRec,
        dealVal,
        totalRec,
        due,
        `"${item.salesManager || item.assignedExecutive || 'Mahendra'}"`,
        `"${(item.remarks || item.notes || '').replace(/"/g, '""')}"`,
        `"${item.phone || ''}"`
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Client_Deals_Sales_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // WhatsApp Reminder
  const handleSendWhatsApp = (item: CustomerOnboarding) => {
    const phoneClean = (item.phone || '').replace(/[^0-9]/g, '');
    const clientName = item.businessName || item.customerName || 'Client';
    const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
    const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
    const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
    const totalRec = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || 0);
    const dueAmount = item.totalDue !== undefined ? item.totalDue : (item.remainingBalance ?? Math.max(0, dealVal - totalRec));
    const service = item.servicePackage || 'Digital Marketing Services';
    const manager = item.salesManager || item.assignedExecutive || 'UDM Techno';

    let text = `Hello ${clientName},\n\nThis is regarding your ${service} service with UDM Techno Solutions.`;
    if (dueAmount > 0) {
      text += `\n\n- Deal Value: ₹${dealVal.toLocaleString('en-IN')}`;
      if (mgmt > 0) text += `\n- Management Fee: ₹${mgmt.toLocaleString('en-IN')}`;
      if (ad > 0) text += `\n- Ad Budget: ₹${ad.toLocaleString('en-IN')}`;
      text += `\n- Received: ₹${totalRec.toLocaleString('en-IN')}`;
      text += `\n- Pending Due: ₹${dueAmount.toLocaleString('en-IN')}`;

      if (item.services && item.services.length > 1) {
        text += `\n\nServices Included:`;
        item.services.forEach((s) => {
          const sMgmt = Number(s.managementFee) || 0;
          const sAd = Number(s.adBudget) || 0;
          const sTot = sMgmt + sAd;
          const sRec = (Number(s.managementFeePaid) || 0) + (Number(s.adBudgetPaid) || 0);
          const sDue = Math.max(0, sTot - sRec);
          text += `\n• ${s.serviceName}: ₹${sTot.toLocaleString('en-IN')}${sDue > 0 ? ` (Due: ₹${sDue.toLocaleString('en-IN')})` : ' (Paid)'}`;
        });
      }

      text += `\n\nKindly arrange the pending payment at your earliest convenience.`;
    } else {
      text += `\n\nYour account is fully paid (₹${dealVal.toLocaleString('en-IN')}). Thank you for partnering with us!`;
    }
    text += `\n\nSales Manager: ${manager}\nBest Regards,\nUDM Techno Solutions`;

    const sendWhatsAppMessage = (phoneTarget: string) => {
      const clean = phoneTarget.replace(/[^0-9]/g, '');
      const full = clean.startsWith('91') ? clean : '91' + clean;
      const url = `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Opening WhatsApp...');
    };

    if (!phoneClean) {
      showPrompt({
        title: 'WhatsApp Contact',
        message: `Enter WhatsApp phone number for ${clientName}:`,
        defaultValue: '91',
        placeholder: 'e.g. 919876543210',
        confirmText: 'Open WhatsApp',
        onConfirm: (manualPhone) => {
          if (manualPhone && manualPhone.trim()) {
            sendWhatsAppMessage(manualPhone);
          }
        }
      });
      return;
    }

    sendWhatsAppMessage(phoneClean);
  };

  // Create Invoice in Invoicing Module
  const handleCreateInvoice = (item: CustomerOnboarding) => {
    if (onCreateInvoiceForClient) {
      const clientData: Partial<Client> = {
        name: item.businessName || item.customerName,
        contactPerson: item.customerName || item.businessName,
        phone: item.phone,
        email: item.email,
        city: item.city || 'Indore',
        state: item.state || 'Madhya Pradesh'
      };

      const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
      const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
      const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
      const advance = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || 0);

      const lineItems = [];
      if (mgmt > 0) {
        lineItems.push({
          id: `item_${Date.now()}_1`,
          name: `${item.servicePackage || 'Digital Marketing'} - Management Fee`,
          hsnSac: '998314',
          quantity: 1,
          unit: 'Month',
          rate: mgmt,
          discountType: 'percentage',
          discountValue: 0,
          discountAmount: 0,
          taxableAmount: mgmt,
          gstRate: 18,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: Math.round(mgmt * 0.18),
          total: Math.round(mgmt * 1.18)
        });
      }

      if (ad > 0) {
        lineItems.push({
          id: `item_${Date.now()}_2`,
          name: `Ad Spend Budget (${item.adPlatform || 'Meta/Google'})`,
          hsnSac: '998314',
          quantity: 1,
          unit: 'Campaign',
          rate: ad,
          discountType: 'percentage',
          discountValue: 0,
          discountAmount: 0,
          taxableAmount: ad,
          gstRate: 18,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: Math.round(ad * 0.18),
          total: Math.round(ad * 1.18)
        });
      }

      onCreateInvoiceForClient(clientData, {
        notes: `Sales Manager: ${item.salesManager || item.assignedExecutive || 'UDM'}. Advance received: ₹${advance.toLocaleString('en-IN')}. ${item.remarks || item.notes || ''}`,
        items: lineItems.length > 0 ? lineItems : undefined
      });
    }
  };

  // Filtered List
  const filteredList = useMemo(() => {
    return onboardings.filter((item) => {
      // Manager filter (Mahendra / Sankalp / All)
      if (selectedManager !== 'all') {
        const mgr = (item.salesManager || item.assignedExecutive || '').toLowerCase();
        if (!mgr.includes(selectedManager.toLowerCase())) {
          return false;
        }
      }

      // Payment filter
      const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
      const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
      const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
      const totalRec = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || 0);
      const due = item.totalDue !== undefined ? item.totalDue : (item.remainingBalance ?? Math.max(0, dealVal - totalRec));

      if (paymentFilter === 'due' && due <= 0) return false;
      if (paymentFilter === 'paid' && due > 0) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const clientName = (item.businessName || item.customerName || '').toLowerCase();
        const service = (item.servicePackage || '').toLowerCase();
        const manager = (item.salesManager || item.assignedExecutive || '').toLowerCase();
        const remarks = (item.remarks || item.notes || '').toLowerCase();
        const phone = (item.phone || '').toLowerCase();
        const date = (item.onboardingDate || '').toLowerCase();
        const invNo = (item.invoiceNumber || '').toLowerCase();

        return (
          clientName.includes(q) ||
          service.includes(q) ||
          manager.includes(q) ||
          remarks.includes(q) ||
          phone.includes(q) ||
          date.includes(q) ||
          invNo.includes(q)
        );
      }

      return true;
    });
  }, [onboardings, selectedManager, paymentFilter, searchQuery]);

  // High-level Calculations & Excel Totals
  const stats = useMemo(() => {
    let sumMgmtFee = 0;
    let sumMgmtRec = 0;
    let sumAdBudget = 0;
    let sumAdRec = 0;
    let sumDealValue = 0;
    let sumTotalRec = 0;
    let sumTotalDue = 0;

    let mahendraCount = 0;
    let mahendraValue = 0;
    let sankalpCount = 0;
    let sankalpValue = 0;

    filteredList.forEach((item) => {
      const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
      const mgmtRec = item.managementFeePaid !== undefined ? item.managementFeePaid : (item.advancePaid || 0);
      const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
      const adRec = item.adBudgetPaid || 0;
      const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
      const totalRec = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || (mgmtRec + adRec));
      const due = item.totalDue !== undefined ? item.totalDue : (item.remainingBalance ?? Math.max(0, dealVal - totalRec));

      sumMgmtFee += mgmt;
      sumMgmtRec += mgmtRec;
      sumAdBudget += ad;
      sumAdRec += adRec;
      sumDealValue += dealVal;
      sumTotalRec += totalRec;
      sumTotalDue += due;

      const mgr = (item.salesManager || item.assignedExecutive || '').toLowerCase();
      if (mgr.includes('mahendra')) {
        mahendraCount += 1;
        mahendraValue += dealVal;
      } else if (mgr.includes('sankalp')) {
        sankalpCount += 1;
        sankalpValue += dealVal;
      }
    });

    return {
      sumMgmtFee,
      sumMgmtRec,
      sumAdBudget,
      sumAdRec,
      sumDealValue,
      sumTotalRec,
      sumTotalDue,
      mahendraCount,
      mahendraValue,
      sankalpCount,
      sankalpValue,
      totalDeals: filteredList.length
    };
  }, [filteredList]);

  const formatINR = (val: number) => '₹' + Math.round(val || 0).toLocaleString('en-IN');

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Excel Tool Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-300 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Title & Quick Stats */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-emerald-700 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Client Deals & Sales Sheet
              <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                {stats.totalDeals} Records
              </span>
            </h1>
            <p className="text-[11px] text-slate-500">
              Excel format: Mgmt Fee • Ad Budget • Received • Due • Sales Managers (Mahendra & Sankalp)
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Import from Invoices */}
          {invoices.length > 0 && (
            <button
              onClick={handleImportInvoices}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-xs font-bold transition-colors cursor-pointer"
              title="Import all unlinked customer invoices into this deals sheet"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-600" />
              <span>Fetch/Sync Invoices</span>
            </button>
          )}

          {/* Export to CSV / Excel */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-bold transition-colors cursor-pointer"
            title="Download as Excel CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          {/* Add New Deal */}
          <button
            onClick={() => {
              setEditingItem(null);
              setIsEditorOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-bold shadow-2xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add Deal Row</span>
          </button>
        </div>
      </div>

      {/* Quick Summary Cards (Compact) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {/* Deal Value */}
        <div className="bg-white p-2.5 rounded-lg border border-slate-200">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Deal Value</div>
          <div className="text-sm font-black font-mono text-slate-900 mt-0.5">{formatINR(stats.sumDealValue)}</div>
          <div className="text-[9px] text-slate-500 font-mono">Mgmt + Ads</div>
        </div>

        {/* Mgmt Fee Total */}
        <div className="bg-white p-2.5 rounded-lg border border-slate-200">
          <div className="text-[10px] uppercase font-bold text-indigo-700">Management Fee</div>
          <div className="text-sm font-black font-mono text-indigo-900 mt-0.5">{formatINR(stats.sumMgmtFee)}</div>
          <div className="text-[9px] text-emerald-600 font-mono">Rec: {formatINR(stats.sumMgmtRec)}</div>
        </div>

        {/* Ad Budget Total */}
        <div className="bg-white p-2.5 rounded-lg border border-slate-200">
          <div className="text-[10px] uppercase font-bold text-blue-700">Ad Budget</div>
          <div className="text-sm font-black font-mono text-blue-900 mt-0.5">{formatINR(stats.sumAdBudget)}</div>
          <div className="text-[9px] text-emerald-600 font-mono">Rec: {formatINR(stats.sumAdRec)}</div>
        </div>

        {/* Total Received */}
        <div className="bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-300">
          <div className="text-[10px] uppercase font-bold text-emerald-800 flex items-center justify-between">
            <span>Total Received</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          </div>
          <div className="text-sm font-black font-mono text-emerald-700 mt-0.5">{formatINR(stats.sumTotalRec)}</div>
          <div className="text-[9px] text-emerald-700 font-medium">
            {stats.sumDealValue > 0 ? `${Math.round((stats.sumTotalRec / stats.sumDealValue) * 100)}% collected` : 'Collected'}
          </div>
        </div>

        {/* Total Due */}
        <div className="bg-amber-50/70 p-2.5 rounded-lg border border-amber-300">
          <div className="text-[10px] uppercase font-bold text-amber-800 flex items-center justify-between">
            <span>Total Due</span>
            <AlertCircle className="w-3 h-3 text-amber-600" />
          </div>
          <div className="text-sm font-black font-mono text-amber-700 mt-0.5">{formatINR(stats.sumTotalDue)}</div>
          <div className="text-[9px] text-amber-700 font-medium">Pending balance</div>
        </div>

        {/* Sales Managers Breakdown */}
        <div className="bg-slate-900 text-white p-2.5 rounded-lg flex flex-col justify-between">
          <div className="text-[10px] uppercase font-bold text-slate-300">Sales Managers</div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-blue-300 font-bold">M: {formatINR(stats.mahendraValue)}</span>
            <span className="text-emerald-300 font-bold">S: {formatINR(stats.sankalpValue)}</span>
          </div>
          <div className="text-[9px] text-slate-400 font-sans flex justify-between">
            <span>Mahendra ({stats.mahendraCount})</span>
            <span>Sankalp ({stats.sankalpCount})</span>
          </div>
        </div>
      </div>

      {/* Filter Row: Search & Manager Filters */}
      <div className="bg-white p-2.5 rounded-lg border border-slate-300 flex flex-col sm:flex-row items-center justify-between gap-2.5">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="Search Client, Service, Inv #, Remarks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Manager Selector */}
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">Manager:</span>
          <button
            onClick={() => setSelectedManager('all')}
            className={`px-2 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
              selectedManager === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setSelectedManager('Mahendra')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              selectedManager === 'Mahendra'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
            }`}
          >
            Mahendra
          </button>
          <button
            onClick={() => setSelectedManager('Sankalp')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              selectedManager === 'Sankalp'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Sankalp
          </button>
        </div>

        {/* Status Filter */}
        <div className="w-full sm:w-auto">
          <select
            value={paymentFilter}
            onChange={(e: any) => setPaymentFilter(e.target.value)}
            className="w-full sm:w-auto text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded px-2.5 py-1"
          >
            <option value="all">All Statuses</option>
            <option value="due">⚠️ Due Balance Pending</option>
            <option value="paid">✓ Fully Paid (₹0 Due)</option>
          </select>
        </div>
      </div>

      {/* Main Excel Spreadsheet Grid Table */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left border-collapse font-sans text-xs">
            {/* Excel Table Header */}
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 text-white text-[11px] font-bold border-b border-slate-700 select-none">
                <th className="py-2 px-2.5 border-r border-slate-700 w-20 whitespace-nowrap">Date</th>
                <th className="py-2 px-2.5 border-r border-slate-700 whitespace-nowrap">Client Name</th>
                <th className="py-2 px-2.5 border-r border-slate-700 whitespace-nowrap">Service</th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap text-indigo-300">
                  Mgmt Fee (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap text-emerald-300">
                  Mgmt Rec. (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap text-blue-300">
                  Ad Budget (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap text-emerald-300">
                  Ad Rec. (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap bg-slate-900 text-white">
                  Deal Value (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap bg-emerald-950 text-emerald-300">
                  Total Rec. (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-right whitespace-nowrap bg-amber-950 text-amber-300">
                  Due (₹)
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700 text-center whitespace-nowrap">
                  SALES MANAGER
                </th>
                <th className="py-2 px-2.5 border-r border-slate-700">Remarks</th>
                <th className="py-2 px-2.5 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-slate-400 font-medium">
                    Loading spreadsheet data...
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-slate-400">
                    <p className="font-semibold text-slate-600">No deal records found</p>
                    <p className="text-[11px] mt-1">
                      Click "+ Add Deal Row" or "Fetch/Sync Invoices" above.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredList.map((item, idx) => {
                  const mgmt = item.managementFee !== undefined ? item.managementFee : (item.serviceFee || 0);
                  const mgmtRec = item.managementFeePaid !== undefined ? item.managementFeePaid : (item.advancePaid || 0);
                  const ad = item.adBudget !== undefined ? item.adBudget : (item.adTotalBudget || 0);
                  const adRec = item.adBudgetPaid || 0;
                  const dealVal = item.totalDealValue !== undefined ? item.totalDealValue : (item.totalPackageValue || (mgmt + ad));
                  const totalRec = item.totalReceived !== undefined ? item.totalReceived : (item.advancePaid || (mgmtRec + adRec));
                  const due = item.totalDue !== undefined ? item.totalDue : (item.remainingBalance ?? Math.max(0, dealVal - totalRec));
                  
                  const manager = item.salesManager || item.assignedExecutive || 'Mahendra';
                  const isMahendra = manager.toLowerCase().includes('mahendra');
                  const isSankalp = manager.toLowerCase().includes('sankalp');

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-indigo-50/40 transition-colors border-b border-slate-200 ${
                        idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                      }`}
                    >
                      {/* 1. Date */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {formatDate(item.onboardingDate)}
                      </td>

                      {/* 2. Client Name & Invoice Link */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200">
                        <div className="font-bold text-slate-900 text-xs truncate max-w-[170px]" title={item.businessName || item.customerName}>
                          {item.businessName || item.customerName}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          {item.invoiceNumber && (
                            <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1 rounded border border-indigo-100">
                              {item.invoiceNumber}
                            </span>
                          )}
                          {item.phone && <span>{item.phone}</span>}
                        </div>
                      </td>

                      {/* 3. Service */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200">
                        {item.services && item.services.length > 1 ? (
                          <div className="flex flex-col gap-1 max-w-[200px]">
                            <div className="flex flex-wrap items-center gap-1">
                              {item.services.map((srv, sIdx) => (
                                <span
                                  key={sIdx}
                                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                                  title={`${srv.serviceName}: Mgmt Fee ${formatINR(srv.managementFee || 0)} (Rec: ${formatINR(srv.managementFeePaid || 0)}), Ad Budget ${formatINR(srv.adBudget || 0)} (Rec: ${formatINR(srv.adBudgetPaid || 0)})`}
                                >
                                  {srv.serviceName}
                                </span>
                              ))}
                            </div>
                            <span className="text-[9px] text-slate-400 font-medium">
                              {item.services.length} services bundled
                            </span>
                          </div>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-800 border border-slate-200 truncate max-w-[150px]" title={item.servicePackage || 'Meta Ads'}>
                            {item.servicePackage || 'Meta Ads'}
                          </span>
                        )}
                      </td>

                      {/* 4. Management Fee (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {mgmt > 0 ? formatINR(mgmt) : '-'}
                      </td>

                      {/* 5. Management Received (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                        {mgmtRec > 0 ? formatINR(mgmtRec) : '₹0'}
                      </td>

                      {/* 6. Ad Budget (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-bold text-blue-900 whitespace-nowrap">
                        {ad > 0 ? formatINR(ad) : '-'}
                      </td>

                      {/* 7. Ad Budget Received (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                        {adRec > 0 ? formatINR(adRec) : (ad > 0 ? '₹0' : '-')}
                      </td>

                      {/* 8. Total Deal Value (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-black text-slate-900 bg-slate-50/80 whitespace-nowrap">
                        {formatINR(dealVal)}
                      </td>

                      {/* 9. Total Received (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono font-black text-emerald-700 bg-emerald-50/40 whitespace-nowrap">
                        {formatINR(totalRec)}
                      </td>

                      {/* 10. Due (₹) */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-right font-mono whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded font-black text-xs inline-block ${
                            due > 0
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          }`}
                        >
                          {formatINR(due)}
                        </span>
                      </td>

                      {/* 11. SALES MANAGER */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                            isMahendra
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : isSankalp
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-purple-100 text-purple-800 border border-purple-300'
                          }`}
                        >
                          {manager}
                        </span>
                      </td>

                      {/* 12. Remarks */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200 max-w-[150px] text-slate-600">
                        <div className="truncate text-[11px]" title={item.remarks || item.notes}>
                          {item.remarks || item.notes || <span className="text-slate-300 italic">-</span>}
                        </div>
                      </td>

                      {/* 13. Actions */}
                      <td className="py-1.5 px-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* Record Payment */}
                          {due > 0 && (
                            <button
                              onClick={() => setPaymentItem(item)}
                              className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer"
                              title="Record payment"
                            >
                              Pay
                            </button>
                          )}

                          {/* WhatsApp */}
                          <button
                            onClick={() => handleSendWhatsApp(item)}
                            className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                            title="WhatsApp reminder"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>

                          {/* Create Invoice */}
                          {onCreateInvoiceForClient && (
                            <button
                              onClick={() => handleCreateInvoice(item)}
                              className="p-1 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded cursor-pointer"
                              title="Create GST Invoice"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Edit */}
                          <button
                            onClick={() => {
                              setEditingItem(item);
                              setIsEditorOpen(true);
                            }}
                            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded cursor-pointer"
                            title="Edit row"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteDeal(item.id, item.businessName || item.customerName)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
                            title="Delete row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Excel Sticky Summary Footer Row */}
            {filteredList.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100 border-t-2 border-slate-400 font-mono font-bold text-xs text-slate-900 select-none">
                <tr>
                  <td colSpan={3} className="py-2 px-2.5 border-r border-slate-300 font-sans font-black uppercase text-[11px] text-slate-700">
                    Total ({filteredList.length} Rows)
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right text-indigo-950">
                    {formatINR(stats.sumMgmtFee)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right text-emerald-800">
                    {formatINR(stats.sumMgmtRec)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right text-blue-950">
                    {formatINR(stats.sumAdBudget)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right text-emerald-800">
                    {formatINR(stats.sumAdRec)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right font-black bg-slate-200 text-slate-950">
                    {formatINR(stats.sumDealValue)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right font-black bg-emerald-100 text-emerald-900">
                    {formatINR(stats.sumTotalRec)}
                  </td>
                  <td className="py-2 px-2.5 border-r border-slate-300 text-right font-black bg-amber-100 text-amber-900">
                    {formatINR(stats.sumTotalDue)}
                  </td>
                  <td colSpan={3} className="py-2 px-2.5 text-center font-sans text-[11px] text-slate-500 font-normal">
                    Mahendra: {stats.mahendraCount} | Sankalp: {stats.sankalpCount}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isEditorOpen && (
        <OnboardingEditorModal
          initialData={editingItem}
          clients={clients}
          invoices={invoices}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingItem(null);
          }}
          onSave={handleSaveDeal}
        />
      )}

      {/* Record Payment Modal */}
      {paymentItem && (
        <OnboardingPaymentModal
          onboarding={paymentItem}
          onClose={() => setPaymentItem(null)}
          onSuccess={() => {
            setPaymentItem(null);
            fetchOnboardings();
            if (onRefreshGlobal) onRefreshGlobal();
          }}
        />
      )}
    </div>
  );
};
