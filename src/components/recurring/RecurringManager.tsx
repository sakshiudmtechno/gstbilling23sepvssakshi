import React, { useState, useMemo } from 'react';
import { RecurringInvoice, Client, RenewalStatus } from '../../types';
import { formatINR } from '../../utils/gstUtils';
import { api } from '../../utils/api';
import {
  formatDisplayDate,
  getExpiryCountdown,
  getRenewalStatusBadge,
  getPaymentStatusBadge
} from '../../utils/recurringUtils';
import {
  Plus,
  Repeat,
  Play,
  Pause,
  Trash2,
  Calendar,
  CheckCircle2,
  ArrowRight,
  History,
  IndianRupee,
  Search,
  FileText,
  AlertTriangle,
  Clock,
  LayoutList,
  LayoutGrid,
  Filter
} from 'lucide-react';
import { toast } from '../common/Toast';
import { AddRecurringModal } from './AddRecurringModal';
import { RecordRenewalPaymentModal } from './RecordRenewalPaymentModal';
import { RenewalHistoryModal } from './RenewalHistoryModal';

interface RecurringManagerProps {
  recurringInvoices: RecurringInvoice[];
  clients: Client[];
  onRefresh: () => void;
  onInvoiceGenerated: () => void;
}

export const RecurringManager: React.FC<RecurringManagerProps> = ({
  recurringInvoices,
  clients,
  onRefresh,
  onInvoiceGenerated
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<RecurringInvoice | null>(null);
  const [renewingTarget, setRenewingTarget] = useState<RecurringInvoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RenewalStatus>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Generate Invoice on demand
  const handleGenerateInvoice = async (rec: RecurringInvoice) => {
    try {
      const inv = await api.triggerRecurringInvoice(rec.id);
      toast.success(`Invoice #${inv.invoiceNumber} generated successfully!`);
      onRefresh();
      onInvoiceGenerated();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate invoice');
    }
  };

  // Toggle active/paused
  const handleToggleStatus = async (rec: RecurringInvoice) => {
    try {
      const nextStatus = rec.status === 'active' ? 'paused' : 'active';
      await api.updateRecurringInvoice(rec.id, { status: nextStatus });
      toast.success(`Schedule ${nextStatus}`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to toggle status');
    }
  };

  // Delete recurring
  const handleDelete = async (rec: RecurringInvoice) => {
    const clientName = rec.clientName || rec.client?.name || 'Client';
    const title = rec.serviceName || rec.title || 'AMC';
    if (!window.confirm(`Are you sure you want to delete recurring subscription for "${clientName}" (${title})?`)) {
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

  // Calculate metrics
  const metrics = useMemo(() => {
    let totalMRR = 0;
    let activeCount = 0;
    let dueSoonCount = 0;
    let expiredCount = 0;
    let paymentPendingCount = 0;
    let renewedCount = 0;

    recurringInvoices.forEach((rec) => {
      const amt = Number(rec.monthlyRenewalAmount || rec.invoiceTemplateData?.grandTotal || 0);
      totalMRR += amt;

      const st = rec.renewalStatus || 'active';
      if (st === 'active') activeCount++;
      else if (st === 'due_soon') dueSoonCount++;
      else if (st === 'expired') expiredCount++;
      else if (st === 'payment_pending') paymentPendingCount++;
      else if (st === 'renewed') renewedCount++;
    });

    return {
      totalCount: recurringInvoices.length,
      totalMRR,
      activeCount,
      dueSoonCount,
      expiredCount,
      paymentPendingCount,
      renewedCount
    };
  }, [recurringInvoices]);

  // Filtered recurring clients list
  const filteredList = useMemo(() => {
    return recurringInvoices.filter((rec) => {
      const clientName = (rec.clientName || rec.client?.name || '').toLowerCase();
      const serviceName = (rec.serviceName || rec.title || '').toLowerCase();
      const query = searchTerm.toLowerCase().trim();

      const matchesSearch = !query || clientName.includes(query) || serviceName.includes(query);
      const matchesFilter = statusFilter === 'all' || (rec.renewalStatus || 'active') === statusFilter;

      return matchesSearch && matchesFilter;
    });
  }, [recurringInvoices, searchTerm, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Top Banner & Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Recurring Clients & AMC</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
              {recurringInvoices.length} Recurring Contracts
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage monthly recurring clients, automatic service expiry, renewal history & separate renewal payments
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Table View"
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`p-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                viewMode === 'cards' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Cards View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cards</span>
            </button>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-teal-800 hover:bg-teal-900 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Recurring Client / AMC
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total MRR */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Monthly AMC Rev</span>
            <IndianRupee className="w-3.5 h-3.5 text-teal-800" />
          </div>
          <div className="font-mono font-bold text-slate-900 text-base">
            {formatINR(metrics.totalMRR)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Recurring revenue / mo</div>
        </div>

        {/* Active */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          className={`p-3.5 rounded-xl border shadow-2xs cursor-pointer transition-all ${
            statusFilter === 'active' ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/20' : 'bg-white border-slate-200 hover:border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Active Clients</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div className="font-mono font-bold text-emerald-700 text-base">
            {metrics.activeCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Healthy & up-to-date</div>
        </div>

        {/* Due Soon */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'due_soon' ? 'all' : 'due_soon')}
          className={`p-3.5 rounded-xl border shadow-2xs cursor-pointer transition-all ${
            statusFilter === 'due_soon' ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-500/20' : 'bg-white border-slate-200 hover:border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Due Soon (≤ 7d)</span>
            <Clock className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="font-mono font-bold text-amber-700 text-base">
            {metrics.dueSoonCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Renewal due shortly</div>
        </div>

        {/* Expired */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
          className={`p-3.5 rounded-xl border shadow-2xs cursor-pointer transition-all ${
            statusFilter === 'expired' ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20' : 'bg-white border-slate-200 hover:border-rose-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Expired</span>
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          </div>
          <div className="font-mono font-bold text-rose-700 text-base">
            {metrics.expiredCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Needs renewal payment</div>
        </div>

        {/* Payment Pending */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'payment_pending' ? 'all' : 'payment_pending')}
          className={`p-3.5 rounded-xl border shadow-2xs cursor-pointer transition-all ${
            statusFilter === 'payment_pending' ? 'bg-orange-50/80 border-orange-300 ring-2 ring-orange-500/20' : 'bg-white border-slate-200 hover:border-orange-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Payment Pending</span>
            <Clock className="w-3.5 h-3.5 text-orange-600" />
          </div>
          <div className="font-mono font-bold text-orange-700 text-base">
            {metrics.paymentPendingCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Awaiting collection</div>
        </div>

        {/* Renewed */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'renewed' ? 'all' : 'renewed')}
          className={`p-3.5 rounded-xl border shadow-2xs cursor-pointer transition-all ${
            statusFilter === 'renewed' ? 'bg-teal-50/80 border-teal-300 ring-2 ring-teal-500/20' : 'bg-white border-slate-200 hover:border-teal-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-medium">
            <span>Renewed</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-700" />
          </div>
          <div className="font-mono font-bold text-teal-800 text-base">
            {metrics.renewedCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Cycle renewed</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-semibold">
          {[
            { id: 'all', label: 'All', count: recurringInvoices.length },
            { id: 'active', label: 'Active', count: metrics.activeCount },
            { id: 'due_soon', label: 'Due Soon', count: metrics.dueSoonCount },
            { id: 'expired', label: 'Expired', count: metrics.expiredCount },
            { id: 'payment_pending', label: 'Payment Pending', count: metrics.paymentPendingCount },
            { id: 'renewed', label: 'Renewed', count: metrics.renewedCount }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
                statusFilter === tab.id
                  ? 'bg-teal-800 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                statusFilter === tab.id ? 'bg-teal-900 text-teal-100' : 'bg-slate-200 text-slate-700'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search client or service..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 outline-hidden"
          />
        </div>
      </div>

      {/* Main Recurring List Content */}
      {filteredList.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3 shadow-2xs">
          <div className="w-12 h-12 bg-teal-50 text-teal-700 rounded-full flex items-center justify-center mx-auto">
            <Repeat className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">No recurring AMC clients found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all'
              ? 'No recurring clients match the selected filter or search keyword.'
              : 'Add your first recurring client or maintenance contract (AMC) to automate monthly renewal tracking.'}
          </p>
          {(searchTerm || statusFilter !== 'all') ? (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          ) : (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-teal-800 hover:bg-teal-900 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-4 h-4" /> Add Recurring Client
            </button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        /* -------------------------------------------------------------
           RECURRING AMC TABLE (Requirement 5)
           Columns:
           Client | Service | Renewal Amount | Current Expiry | Next Renewal | Last Payment | Payment Status | Renewal Status | Actions
           ------------------------------------------------------------- */
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Client</th>
                  <th className="py-3 px-3">Service / AMC</th>
                  <th className="py-3 px-3 text-right">Renewal Amount</th>
                  <th className="py-3 px-3">Current Expiry</th>
                  <th className="py-3 px-3">Next Renewal</th>
                  <th className="py-3 px-3">Last Payment</th>
                  <th className="py-3 px-3 text-center">Payment Status</th>
                  <th className="py-3 px-3 text-center">Renewal Status</th>
                  <th className="py-3 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((rec) => {
                  const clientName = rec.clientName || rec.client?.name || 'Client';
                  const serviceName = rec.serviceName || rec.title || 'Monthly AMC';
                  const monthlyAmount = rec.monthlyRenewalAmount || rec.invoiceTemplateData?.grandTotal || 3000;
                  const expiryCountdown = getExpiryCountdown(rec.currentExpiryDate);
                  const renewalBadge = getRenewalStatusBadge(rec.renewalStatus);
                  const paymentBadge = getPaymentStatusBadge(rec.paymentStatus);
                  const historyCount = rec.renewalHistory?.length || 0;

                  return (
                    <tr
                      key={rec.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        rec.renewalStatus === 'expired' ? 'bg-rose-50/20' : rec.renewalStatus === 'due_soon' ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Client */}
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 text-xs">{clientName}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                          {rec.client?.phone || rec.client?.email || rec.client?.city || rec.recurringNumber}
                        </div>
                      </td>

                      {/* Service / AMC */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800">{serviceName}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                          {rec.frequency || 'Monthly'}
                        </div>
                      </td>

                      {/* Renewal Amount */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-mono font-bold text-slate-900 text-xs">
                          {formatINR(monthlyAmount)}
                        </div>
                        <div className="text-[10px] text-slate-400">/ month</div>
                      </td>

                      {/* Current Expiry */}
                      <td className="py-3 px-3">
                        <div className="font-mono font-semibold text-slate-900">
                          {formatDisplayDate(rec.currentExpiryDate)}
                        </div>
                        <span className={`inline-block text-[10px] px-1.5 py-0.2 rounded font-medium ${
                          expiryCountdown.isOverdue
                            ? 'bg-rose-50 text-rose-700'
                            : expiryCountdown.days <= 7
                            ? 'bg-amber-50 text-amber-700'
                            : 'text-slate-400'
                        }`}>
                          {expiryCountdown.text}
                        </span>
                      </td>

                      {/* Next Renewal */}
                      <td className="py-3 px-3">
                        <div className="font-mono font-bold text-teal-900">
                          {formatDisplayDate(rec.nextRenewalDate)}
                        </div>
                        <div className="text-[10px] text-slate-400">Upcoming cycle</div>
                      </td>

                      {/* Last Payment */}
                      <td className="py-3 px-3">
                        {rec.lastPaymentAmount && rec.lastPaymentAmount > 0 ? (
                          <div className="space-y-0.5">
                            <div className="font-mono font-bold text-slate-800">
                              {formatINR(rec.lastPaymentAmount)}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {formatDisplayDate(rec.lastPaymentDate)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No payments yet</span>
                        )}
                      </td>

                      {/* Payment Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${paymentBadge.bg} ${paymentBadge.text} border ${paymentBadge.border}`}>
                          {paymentBadge.label}
                        </span>
                      </td>

                      {/* Renewal Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${renewalBadge.bg} ${renewalBadge.text} border ${renewalBadge.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${renewalBadge.dot}`} />
                          {renewalBadge.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Record Renewal Payment */}
                          <button
                            type="button"
                            onClick={() => setRenewingTarget(rec)}
                            className="px-2.5 py-1 bg-teal-800 hover:bg-teal-900 text-white rounded-md text-[11px] font-bold transition-colors cursor-pointer shadow-2xs flex items-center gap-1"
                            title="Record renewal payment for next month"
                          >
                            <IndianRupee className="w-3 h-3" />
                            Renew / Pay
                          </button>

                          {/* Renewal History */}
                          <button
                            type="button"
                            onClick={() => setHistoryTarget(rec)}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                            title="View all past monthly renewals"
                          >
                            <History className="w-3 h-3 text-slate-500" />
                            <span>History</span>
                            {historyCount > 0 && (
                              <span className="bg-slate-100 text-slate-600 px-1 py-0.2 rounded text-[9px] font-bold">
                                {historyCount}
                              </span>
                            )}
                          </button>

                          {/* Generate Invoice on demand */}
                          <button
                            type="button"
                            onClick={() => handleGenerateInvoice(rec)}
                            className="p-1 text-slate-400 hover:text-teal-800 hover:bg-teal-50 rounded transition-colors cursor-pointer"
                            title="Generate GST Invoice Draft"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>

                          {/* Pause / Resume */}
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(rec)}
                            className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors cursor-pointer"
                            title={rec.status === 'active' ? 'Pause automatic schedule' : 'Resume schedule'}
                          >
                            {rec.status === 'active' ? <Pause className="w-3.5 h-3.5 text-amber-600" /> : <Play className="w-3.5 h-3.5 text-emerald-600" />}
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDelete(rec)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Delete recurring profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Cards View (Alternative View) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredList.map((rec) => {
            const clientName = rec.clientName || rec.client?.name || 'Client';
            const serviceName = rec.serviceName || rec.title || 'Monthly AMC';
            const monthlyAmount = rec.monthlyRenewalAmount || rec.invoiceTemplateData?.grandTotal || 3000;
            const expiryCountdown = getExpiryCountdown(rec.currentExpiryDate);
            const renewalBadge = getRenewalStatusBadge(rec.renewalStatus);
            const paymentBadge = getPaymentStatusBadge(rec.paymentStatus);

            return (
              <div
                key={rec.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-teal-50 text-teal-800 rounded-lg shrink-0">
                        <Repeat className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 text-xs truncate">
                          {clientName}
                        </h3>
                        <p className="text-[11px] text-slate-500 truncate">
                          {serviceName}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${renewalBadge.bg} ${renewalBadge.text} border ${renewalBadge.border}`}>
                      <span className={`w-1 h-1 rounded-full ${renewalBadge.dot}`} />
                      {renewalBadge.label}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Monthly Renewal:</span>
                      <span className="font-bold font-mono text-slate-900 text-sm">
                        {formatINR(monthlyAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Current Expiry:</span>
                      <span className="font-bold font-mono text-slate-900">
                        {formatDisplayDate(rec.currentExpiryDate)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Next Renewal:</span>
                      <span className="font-bold font-mono text-teal-900">
                        {formatDisplayDate(rec.nextRenewalDate)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                      <span className="text-slate-500">Last Payment:</span>
                      <span className="font-mono text-slate-700">
                        {rec.lastPaymentAmount ? `${formatINR(rec.lastPaymentAmount)} on ${formatDisplayDate(rec.lastPaymentDate)}` : 'None'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs gap-2">
                  <button
                    type="button"
                    onClick={() => setHistoryTarget(rec)}
                    className="px-2.5 py-1 text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-md font-medium text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <History className="w-3 h-3" /> History
                  </button>

                  <button
                    type="button"
                    onClick={() => setRenewingTarget(rec)}
                    className="px-3 py-1 bg-teal-800 hover:bg-teal-900 text-white rounded-md font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                  >
                    Renew / Pay <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 1: Add Recurring Client Modal */}
      {isAddModalOpen && (
        <AddRecurringModal
          clients={clients}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            onRefresh();
          }}
        />
      )}

      {/* Modal 2: Record Renewal Payment Modal */}
      {renewingTarget && (
        <RecordRenewalPaymentModal
          recurring={renewingTarget}
          onClose={() => setRenewingTarget(null)}
          onSuccess={() => {
            onRefresh();
          }}
        />
      )}

      {/* Modal 3: Renewal History Modal */}
      {historyTarget && (
        <RenewalHistoryModal
          recurring={historyTarget}
          onClose={() => setHistoryTarget(null)}
          onRefresh={() => {
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
