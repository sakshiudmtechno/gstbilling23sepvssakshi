import React, { useState, useEffect } from 'react';
import { Quote, Client, BusinessProfile, QuoteItem } from '../../types';
import { api } from '../../utils/api';
import { downloadElementAsPdf, triggerPrint } from '../../utils/pdfGenerator';
import { InvoicePDFTemplate } from '../invoices/InvoicePDFTemplate';
import { PREDEFINED_SERVICES, calculateAdBudgetStats } from '../../constants/services';
import { formatINR, numberToIndianWords } from '../../utils/gstUtils';
import { toast } from '../common/Toast';
import { 
  Plus, 
  Trash2, 
  Download, 
  Eye, 
  X, 
  Send, 
  Clock, 
  Sparkles, 
  Edit, 
  ArrowLeft, 
  Loader2, 
  Calculator, 
  Target, 
  TrendingUp, 
  Percent, 
  Check, 
  Layers,
  HelpCircle,
  Megaphone
} from 'lucide-react';

interface QuoteManagerProps {
  quotes: Quote[];
  clients: Client[];
  businessProfile: BusinessProfile | null;
  onRefresh: () => void;
  onConvertToInvoice: (quote: Quote) => void;
}

export const QuoteManager: React.FC<QuoteManagerProps> = ({
  quotes,
  clients,
  businessProfile,
  onRefresh,
  onConvertToInvoice
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [quoteDate, setQuoteDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [viewingQuote, setViewingQuote] = useState<Quote | null>(null);
  const [downloadingQuoteId, setDownloadingQuoteId] = useState<string | null>(null);
  const [directDownloadQuote, setDirectDownloadQuote] = useState<Quote | null>(null);

  // Quick Quote Form State
  const [quoteNumber, setQuoteNumber] = useState(`EST-${Date.now().toString().slice(-4)}`);
  const [clientName, setClientName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientState, setClientState] = useState('Madhya Pradesh');
  const [clientStateCode, setClientStateCode] = useState('23');
  
  // GST Controls
  const [applyGst, setApplyGst] = useState(false);
  const [gstRate, setGstRate] = useState(18);

  // Meta & Google Ads Budget Calculator Widget State
  const [showAdCalculator, setShowAdCalculator] = useState(true);
  const [adPlatform, setAdPlatform] = useState<'meta' | 'google'>('meta');
  const [adDailyBudget, setAdDailyBudget] = useState<number>(200);
  const [adDays, setAdDays] = useState<number>(15);

  const [items, setItems] = useState<Partial<QuoteItem>[]>([
    { id: '1', name: '', description: '', rate: 0, quantity: 1 }
  ]);

  const handleEditQuote = (quote: Quote) => {
    setEditingQuoteId(quote.id);
    setQuoteNumber(quote.quoteNumber);
    
    // Parse client name/company if they were merged like "Name (Company)"
    let cName = quote.client?.name || '';
    let compName = '';
    const match = cName.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      cName = match[1];
      compName = match[2];
    }
    
    setClientName(cName);
    setCompanyName(compName);
    setClientEmail(quote.client?.email || '');
    setClientPhone(quote.client?.phone || '');
    setClientAddress(quote.client?.billingAddress || '');
    setClientState(quote.client?.state || 'Madhya Pradesh');
    setClientStateCode(quote.client?.stateCode || '23');
    setItems((quote.items || []).map(item => ({...item})));
    
    const hasGst = (quote.totalGst || 0) > 0 || ((quote.items?.[0]?.gstRate || 0) > 0);
    setApplyGst(hasGst);
    if (hasGst) {
      setGstRate(quote.items?.[0]?.gstRate || 18);
    } else {
      setGstRate(0);
    }
    
    if (quote.quoteDate) setQuoteDate(quote.quoteDate);
    if (quote.validUntil) setValidUntil(quote.validUntil);
    
    setIsCreating(true);
  };

  const resetForm = () => {
    setEditingQuoteId(null);
    setQuoteNumber(`EST-${Date.now().toString().slice(-4)}`);
    setClientName('');
    setCompanyName('');
    setClientEmail('');
    setClientPhone('');
    setClientAddress('');
    setItems([{ id: '1', name: '', description: '', rate: 0, quantity: 1 }]);
    setApplyGst(false);
    setGstRate(18);
    setAdPlatform('meta');
    setAdDailyBudget(200);
    setAdDays(15);
    setQuoteDate(new Date().toISOString().split('T')[0]);
    setValidUntil(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  };

  const handleAddItem = () => {
    setItems([...items, { id: Date.now().toString(), name: '', description: '', rate: 0, quantity: 1 }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof QuoteItem, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;
    setItems(newItems);
  };

  // Add Ad Campaign package with dynamic calculation into Quote items
  const handleAddAdCampaignToQuote = () => {
    const stats = calculateAdBudgetStats(adPlatform, adDailyBudget, adDays);
    
    // Check if there is a single empty item placeholder
    const isSingleEmpty = items.length === 1 && !items[0].name && (!items[0].rate || items[0].rate === 0);
    
    const newItem: Partial<QuoteItem> = {
      id: Date.now().toString(),
      name: stats.title,
      description: stats.description,
      rate: stats.totalBudget,
      quantity: 1,
      unit: 'CAMPAIGN',
      hsnSac: '998313',
      gstRate: applyGst ? gstRate : 0
    };

    if (isSingleEmpty) {
      setItems([newItem]);
    } else {
      setItems([...items, newItem]);
    }
  };

  const handleSaveQuote = async (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!clientName.trim()) {
      toast.error('Please enter a Client Name before saving the estimate.');
      return;
    }

    setIsSaving(true);
    
    // Auto-create client snapshot
    const formattedClientName = companyName.trim() ? `${clientName.trim()} (${companyName.trim()})` : clientName.trim();
    const tempClientObj: Client = {
      id: `client_${Date.now()}`,
      name: formattedClientName,
      contactPerson: clientName.trim(),
      email: clientEmail.trim(),
      phone: clientPhone.trim(),
      billingAddress: clientAddress.trim() || 'Not Provided',
      city: '',
      state: clientState,
      stateCode: clientStateCode,
      country: 'India',
      pinCode: '',
      gstin: '',
      pan: '',
      customerType: 'B2B',
      createdAt: new Date().toISOString()
    };

    let subtotal = 0;
    let totalGst = 0;
    const isInter = clientStateCode !== (businessProfile?.stateCode || '23');
    const selectedGstRate = applyGst ? gstRate : 0;

    const finalItems = items.map((item, i) => {
      const rate = Number(item.rate) || 0;
      const qty = Number(item.quantity) || 1;
      const taxable = rate * qty;
      const gstAmt = (taxable * selectedGstRate) / 100;

      subtotal += taxable;
      totalGst += gstAmt;

      return {
        id: item.id || `qi_${Date.now()}_${i}`,
        name: item.name?.trim() || 'Service',
        description: item.description?.trim() || '',
        hsnSac: item.hsnSac || '9983',
        quantity: qty,
        unit: item.unit || 'JOB',
        rate: rate,
        discountType: 'percentage',
        discountValue: 0,
        discountAmount: 0,
        taxableAmount: taxable,
        gstRate: selectedGstRate,
        cgstAmount: applyGst && !isInter ? gstAmt / 2 : 0,
        sgstAmount: applyGst && !isInter ? gstAmt / 2 : 0,
        igstAmount: applyGst && isInter ? gstAmt : 0,
        totalGstAmount: gstAmt,
        total: taxable + gstAmt
      } as QuoteItem;
    });

    const grandTotal = subtotal + (applyGst ? totalGst : 0);

    const newQuote = {
      quoteNumber,
      clientId: tempClientObj.id,
      client: tempClientObj,
      quoteDate: quoteDate,
      validUntil: validUntil,
      status: 'draft',
      placeOfSupply: clientState,
      placeOfSupplyCode: clientStateCode,
      currency: 'INR',
      items: finalItems,
      subtotal,
      totalTaxableAmount: subtotal,
      totalGst: applyGst ? totalGst : 0,
      totalCgst: applyGst && !isInter ? totalGst / 2 : 0,
      totalSgst: applyGst && !isInter ? totalGst / 2 : 0,
      totalIgst: applyGst && isInter ? totalGst : 0,
      grandTotal,
      totalInWords: numberToIndianWords(Math.round(grandTotal)),
      template: 'classic',
      showBankDetails: false,
      seller: businessProfile ? { ...businessProfile, logoUrl: undefined } : undefined
    };

    try {
      if (editingQuoteId) {
        await api.updateQuote(editingQuoteId, newQuote as any);
      } else {
        await api.createQuote(newQuote as any);
      }
      
      await onRefresh();
      resetForm();
      setIsCreating(false);
      setViewingQuote(null);
      toast.success(editingQuoteId ? 'Estimate updated successfully' : 'Estimate created successfully');
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to save estimate: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadEstimatePdf = async () => {
    try {
      setIsDownloadingPdf(true);
      await downloadElementAsPdf('live-quote-pdf', `Estimate-${quoteNumber}.pdf`);
      toast.success('Estimate PDF downloaded');
    } catch (err) {
      console.error('Failed to download PDF:', err);
      toast.error('Failed to generate estimate PDF. Please try again.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDeleteQuote = async (quote: Quote) => {
    if (!window.confirm(`Are you sure you want to delete estimate "${quote.quoteNumber}"? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteQuote(quote.id);
      toast.success(`Estimate "${quote.quoteNumber}" deleted successfully`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete estimate');
    }
  };

  const handleDownloadRowPdf = async (quote: Quote) => {
    try {
      setDownloadingQuoteId(quote.id);
      setDirectDownloadQuote(quote);
      await new Promise(resolve => setTimeout(resolve, 150));
      await downloadElementAsPdf(`direct-quote-pdf-${quote.id}`, `Estimate-${quote.quoteNumber}.pdf`);
      toast.success('Estimate PDF downloaded');
    } catch (err) {
      console.error('Failed to download quote PDF:', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setDownloadingQuoteId(null);
      setDirectDownloadQuote(null);
    }
  };

  const tempClient: Client = {
    id: `client_${Date.now()}`,
    name: companyName ? `${clientName} (${companyName})` : (clientName || 'New Client'),
    contactPerson: clientName,
    email: clientEmail,
    phone: clientPhone,
    billingAddress: clientAddress || 'Not Provided',
    city: '',
    state: clientState,
    stateCode: clientStateCode,
    country: 'India',
    pinCode: '',
    gstin: '',
    pan: '',
    customerType: 'B2B',
    createdAt: new Date().toISOString()
  };

  let subtotal = 0;
  let totalGst = 0;
  const isInter = clientStateCode !== (businessProfile?.stateCode || '23');
  const selectedGstRate = applyGst ? gstRate : 0;

  const finalItems = items.map((item, i) => {
    const rate = Number(item.rate) || 0;
    const qty = Number(item.quantity) || 1;
    const taxable = rate * qty;
    const gstAmt = (taxable * selectedGstRate) / 100;

    subtotal += taxable;
    totalGst += gstAmt;

    return {
      id: `qi_${Date.now()}_${i}`,
      name: item.name || 'Service',
      description: item.description || '',
      hsnSac: '9983',
      quantity: qty,
      unit: 'JOB',
      rate: rate,
      discountType: 'percentage',
      discountValue: 0,
      discountAmount: 0,
      taxableAmount: taxable,
      gstRate: selectedGstRate,
      cgstAmount: applyGst && !isInter ? gstAmt / 2 : 0,
      sgstAmount: applyGst && !isInter ? gstAmt / 2 : 0,
      igstAmount: applyGst && isInter ? gstAmt : 0,
      totalGstAmount: gstAmt,
      total: taxable + (applyGst ? gstAmt : 0)
    } as QuoteItem;
  });

  const grandTotal = subtotal + (applyGst ? totalGst : 0);

  const previewQuote = {
    quoteNumber,
    clientId: tempClient.id,
    client: tempClient,
    quoteDate: quoteDate,
    validUntil: validUntil,
    status: 'draft',
    placeOfSupply: clientState,
    placeOfSupplyCode: clientStateCode,
    currency: 'INR',
    items: finalItems,
    subtotal,
    totalTaxableAmount: subtotal,
    totalGst: applyGst ? totalGst : 0,
    totalCgst: applyGst && !isInter ? totalGst / 2 : 0,
    totalSgst: applyGst && !isInter ? totalGst / 2 : 0,
    totalIgst: applyGst && isInter ? totalGst : 0,
    grandTotal,
    totalInWords: numberToIndianWords(Math.round(grandTotal)),
    template: 'classic',
    seller: businessProfile,
    showBankDetails: false
  };

  // Real-time calculation stats for Ad Widget
  const adStats = calculateAdBudgetStats(adPlatform, adDailyBudget, adDays);

  return (
    <div className="space-y-6">
      {/* Hidden staging container for direct row download */}
      {directDownloadQuote && (
        <div
          id={`direct-quote-pdf-wrapper-${directDownloadQuote.id}`}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: '800px',
            zIndex: -9999,
            opacity: 1,
            pointerEvents: 'none',
            backgroundColor: '#ffffff'
          }}
        >
          <InvoicePDFTemplate
            id={`direct-quote-pdf-${directDownloadQuote.id}`}
            invoice={directDownloadQuote as any}
            documentTitle="SERVICE QUOTATION"
            businessProfileFallback={businessProfile}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Estimates & Quotes</h1>
          <p className="text-sm text-slate-500">Create client quotations with optional GST calculation and ad budget planning.</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsCreating(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-all"
        >
          <Plus className="w-5 h-5" />
          Create Quick Estimate
        </button>
      </div>

      {/* List of Quotes */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                <th className="p-4 font-semibold">Quote No.</th>
                <th className="p-4 font-semibold">Client</th>
                <th className="p-4 font-semibold">Date</th>
                <th className="p-4 font-semibold text-center">Tax Scheme</th>
                <th className="p-4 font-semibold text-right">Amount</th>
                <th className="p-4 font-semibold text-center">Status</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No quotes found. Click "Create Quick Estimate" to generate your first quotation.
                  </td>
                </tr>
              ) : (
                quotes.map(quote => (
                  <tr key={quote.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-sm font-semibold text-indigo-700">{quote.quoteNumber}</td>
                    <td className="p-4">
                      <p className="font-semibold text-slate-900">{quote.client.name}</p>
                      <p className="text-xs text-slate-500">{quote.client.email || 'No email'}</p>
                    </td>
                    <td className="p-4 text-sm text-slate-600">{new Date(quote.quoteDate).toLocaleDateString()}</td>
                    <td className="p-4 text-center">
                      {(quote.totalGst || 0) > 0 ? (
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs font-semibold">
                          GST Applied
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                          Without GST
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-900">₹{quote.grandTotal?.toLocaleString('en-IN') || "0"}</td>
                    <td className="p-4 text-center">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase">
                        {quote.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingQuote(quote)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                          title="View Estimate Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        
                        <button
                          onClick={() => handleDownloadRowPdf(quote)}
                          disabled={downloadingQuoteId === quote.id}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50"
                          title="Download Estimate PDF"
                          aria-label={`Download PDF for estimate ${quote.quoteNumber}`}
                        >
                          {downloadingQuoteId === quote.id ? (
                            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleEditQuote(quote)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Edit Estimate"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteQuote(quote)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Estimate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {quote.status !== 'converted' && (
                          <button
                            onClick={() => onConvertToInvoice(quote)}
                            className="ml-1 px-2 py-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded text-xs font-semibold"
                            title="Convert to Invoice"
                          >
                            Convert to Invoice
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Quote Full Screen Studio */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden animate-in fade-in">
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
            <div>
              <h2 className="font-bold text-lg text-slate-900">{editingQuoteId ? 'Edit Quotation / Estimate' : 'Create Quick Estimate'}</h2>
              <p className="text-xs text-slate-500">Configure client details, GST tax options, and marketing/ad packages with instant live PDF preview.</p>
            </div>
            <div className="flex items-center gap-3">
              <button 
                type="button" 
                onClick={handleDownloadEstimatePdf} 
                disabled={isDownloadingPdf}
                className="px-4 py-2 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm flex items-center gap-1.5 border border-indigo-200"
                title="Download Estimate as PDF"
              >
                {isDownloadingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Generating PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download PDF</span>
                  </>
                )}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  resetForm();
                  setIsCreating(false);
                }} 
                className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg text-sm flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button 
                type="button" 
                onClick={() => handleSaveQuote()} 
                disabled={isSaving}
                className="px-5 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm text-sm flex items-center gap-2"
              >
                {isSaving ? 'Saving...' : (editingQuoteId ? 'Update Estimate' : 'Save Estimate')}
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-hidden flex">
            {/* Left Column: Form */}
            <div className="w-1/2 overflow-y-auto p-6 border-r border-slate-200 bg-white space-y-6">
              <form id="quote-form" className="space-y-6">
                
                {/* 1. Client & Estimate Information */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                      1. Client &amp; Estimate Details
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500 font-semibold">{quoteNumber}</span>
                  </div>
                  
                  <div className="p-4 space-y-3.5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Client Name <span className="text-rose-500">*</span></label>
                        <input 
                          type="text" 
                          required 
                          value={clientName} 
                          onChange={e => setClientName(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="e.g. Rahul Sharma" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Company / Business Name</label>
                        <input 
                          type="text" 
                          value={companyName} 
                          onChange={e => setCompanyName(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="e.g. Apex Health Centre" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                        <input 
                          type="text" 
                          value={clientPhone} 
                          onChange={e => setClientPhone(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="+91 98765 43210" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                        <input 
                          type="email" 
                          value={clientEmail} 
                          onChange={e => setClientEmail(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="client@example.com" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Address / City</label>
                        <input 
                          type="text" 
                          value={clientAddress} 
                          onChange={e => setClientAddress(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="e.g. MG Road, Indore, MP" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Estimate Date</label>
                        <input 
                          type="date" 
                          value={quoteDate} 
                          onChange={e => setQuoteDate(e.target.value)} 
                          className="w-full px-2.5 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-indigo-500 rounded-lg text-xs font-medium text-slate-900 outline-hidden" 
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Quotation Service Items & Deliverables (Selection of Service) */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                      2. Service Items &amp; Deliverables
                    </h3>
                    <button 
                      type="button" 
                      onClick={handleAddItem} 
                      className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Service
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    {items.map((item, index) => (
                      <div key={item.id || index} className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-200/90 relative hover:border-indigo-200 transition-all space-y-3">
                        {/* Auto-fill from predefined library */}
                        <div>
                          <label className="block text-[11px] font-bold text-indigo-900 mb-1 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                            Select Pre-Defined Service Package
                          </label>
                          <select 
                            className="w-full px-3 py-1.5 border border-indigo-200 bg-white rounded-lg text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-hidden shadow-2xs"
                            onChange={(e) => {
                              const preset = PREDEFINED_SERVICES.find(s => s.id === e.target.value);
                              if (preset) {
                                handleItemChange(index, 'name', preset.name);
                                handleItemChange(index, 'rate', preset.rate);
                                handleItemChange(index, 'description', preset.description);
                                handleItemChange(index, 'hsnSac', preset.hsnSac);
                                handleItemChange(index, 'unit', preset.unit);
                              }
                              e.target.value = "";
                            }}
                            defaultValue=""
                          >
                            <option value="" disabled>-- Click to Choose from Ready Service Packages --</option>
                            <optgroup label="Paid Ads & Lead Generation">
                              {PREDEFINED_SERVICES.filter(s => s.category === 'Paid Ads & Lead Gen').map(s => (
                                <option key={s.id} value={s.id}>{s.name} - {s.pricingLabel}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Website Development">
                              {PREDEFINED_SERVICES.filter(s => s.category === 'Website Development').map(s => (
                                <option key={s.id} value={s.id}>{s.name} - {s.pricingLabel}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Digital Marketing & SEO">
                              {PREDEFINED_SERVICES.filter(s => s.category === 'Digital Marketing & SEO').map(s => (
                                <option key={s.id} value={s.id}>{s.name} - {s.pricingLabel}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Landing Pages">
                              {PREDEFINED_SERVICES.filter(s => s.category === 'Landing Pages').map(s => (
                                <option key={s.id} value={s.id}>{s.name} - {s.pricingLabel}</option>
                              ))}
                            </optgroup>
                          </select>
                        </div>

                        {/* Title, Rate, Qty Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                          <div className="md:col-span-6">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Service Title <span className="text-rose-500">*</span></label>
                            <input 
                              type="text" 
                              required 
                              value={item.name || ''} 
                              onChange={e => handleItemChange(index, 'name', e.target.value)} 
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:border-indigo-500 outline-hidden" 
                              placeholder="e.g. Custom Website Development" 
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Rate (₹) <span className="text-rose-500">*</span></label>
                            <input 
                              type="number" 
                              required 
                              value={item.rate ?? ''} 
                              onChange={e => handleItemChange(index, 'rate', Number(e.target.value))} 
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:border-indigo-500 outline-hidden" 
                              placeholder="0"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Qty</label>
                            <input 
                              type="number" 
                              min={1}
                              value={item.quantity || 1} 
                              onChange={e => handleItemChange(index, 'quantity', Number(e.target.value))} 
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-center text-slate-900 focus:border-indigo-500 outline-hidden" 
                            />
                          </div>
                          {items.length > 1 && (
                            <div className="md:col-span-1 flex justify-end">
                              <button 
                                type="button" 
                                onClick={() => handleRemoveItem(index)} 
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Remove Item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Deliverables Scope */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Key Deliverables &amp; Scope</label>
                          <textarea 
                            value={item.description || ''} 
                            onChange={e => handleItemChange(index, 'description', e.target.value)} 
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs leading-relaxed focus:border-indigo-500 outline-hidden" 
                            rows={2} 
                            placeholder="Detail features, delivery timelines, scope of work..."
                          ></textarea>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Meta & Google Ads Budget & Lead Estimator Calculator (Positioned AFTER Service Selection) */}
                <div className="bg-gradient-to-br from-violet-50/80 via-indigo-50/40 to-purple-50/60 rounded-xl border border-violet-200/90 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-white/70 border-b border-violet-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 bg-violet-600 text-white rounded-md">
                        <Target className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-xs font-bold text-violet-950 uppercase tracking-wider">
                        3. Ads Campaign Budget &amp; Lead Estimator
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdCalculator(!showAdCalculator)}
                      className="text-xs font-bold text-violet-700 hover:text-violet-900"
                    >
                      {showAdCalculator ? 'Collapse' : 'Expand'}
                    </button>
                  </div>

                  {showAdCalculator && (
                    <div className="p-4 space-y-3.5">
                      {/* Platform Choice */}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">Platform:</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setAdPlatform('meta')}
                            className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                              adPlatform === 'meta'
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <span>📱 Meta Ads (FB &amp; IG)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdPlatform('google')}
                            className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                              adPlatform === 'google'
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <span>🔎 Google Search &amp; Call</span>
                          </button>
                        </div>
                      </div>

                      {/* Daily Budget & Duration Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Daily Budget */}
                        <div className="bg-white/80 p-2.5 rounded-lg border border-violet-100">
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] font-bold text-slate-700">Daily Budget:</label>
                            <span className="text-xs font-mono font-bold text-violet-700">₹{adDailyBudget}/day</span>
                          </div>
                          <input
                            type="number"
                            min={100}
                            step={50}
                            value={adDailyBudget}
                            onChange={e => setAdDailyBudget(Math.max(1, Number(e.target.value)))}
                            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-md text-xs font-mono font-bold mb-1.5"
                            placeholder="200"
                          />
                          <div className="flex flex-wrap gap-1">
                            {[200, 300, 500, 1000, 2000].map(amt => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setAdDailyBudget(amt)}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                                  adDailyBudget === amt
                                    ? 'bg-violet-600 text-white font-bold'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-violet-50'
                                }`}
                              >
                                ₹{amt}/d
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Duration Days */}
                        <div className="bg-white/80 p-2.5 rounded-lg border border-violet-100">
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] font-bold text-slate-700">Duration (Days):</label>
                            <span className="text-xs font-mono font-bold text-violet-700">{adDays} Days</span>
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={adDays}
                            onChange={e => setAdDays(Math.max(1, Number(e.target.value)))}
                            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-md text-xs font-mono font-bold mb-1.5"
                            placeholder="15"
                          />
                          <div className="flex flex-wrap gap-1">
                            {[7, 15, 30, 45, 60].map(d => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setAdDays(d)}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                                  adDays === d
                                    ? 'bg-violet-600 text-white font-bold'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-violet-50'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Calculated Outcome & Add button */}
                      <div className="bg-white p-3 rounded-xl border border-violet-200 space-y-2.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-600 font-medium">Calculated Ad Spend:</span>
                          <span className="font-mono font-bold text-sm text-violet-950">
                            ₹{adDailyBudget.toLocaleString('en-IN')} × {adDays}d = <span className="text-indigo-600 font-bold">₹{adStats.totalBudget.toLocaleString('en-IN')}</span>
                          </span>
                        </div>
                        
                        <div className="bg-violet-50/70 p-2 rounded-lg border border-violet-100 text-xs">
                          <div className="flex items-center gap-1.5 text-violet-950 font-bold mb-0.5 text-[11px]">
                            <TrendingUp className="w-3.5 h-3.5 text-violet-600" />
                            <span>Estimated Leads Proportion:</span>
                          </div>
                          <p className="text-slate-700 text-[11px] leading-relaxed">
                            ~<strong className="text-violet-900 font-bold">{adStats.dailyMinLeads}–{adStats.dailyMaxLeads} leads/day</strong> ({adStats.totalMinLeads}–{adStats.totalMaxLeads} leads across {adDays} days) based on niche &amp; competition.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddAdCampaignToQuote}
                          className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all"
                        >
                          <Plus className="w-4 h-4" />
                          Add This Campaign to Services (₹{adStats.totalBudget.toLocaleString('en-IN')})
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. GST Tax Calculation & Billing Breakdown */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                      <Percent className="w-3.5 h-3.5 text-indigo-600" />
                      4. GST Tax Option &amp; Billing Breakdown
                    </h3>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {applyGst ? `GST Applied (${gstRate}%)` : 'Non-GST (0%)'}
                    </span>
                  </div>

                  <div className="p-4 space-y-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setApplyGst(false);
                            setGstRate(0);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            !applyGst 
                              ? 'bg-indigo-600 text-white shadow-xs' 
                              : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          Without GST (0%)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setApplyGst(true);
                            if (gstRate === 0) setGstRate(18);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            applyGst 
                              ? 'bg-indigo-600 text-white shadow-xs' 
                              : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          With GST
                        </button>
                      </div>

                      {applyGst && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-bold text-slate-700 whitespace-nowrap">GST Rate:</label>
                          <select
                            value={gstRate}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setGstRate(val);
                              if (val === 0) setApplyGst(false);
                              else setApplyGst(true);
                            }}
                            className="px-2.5 py-1.5 border border-indigo-300 bg-white rounded-lg text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                          >
                            <option value={0}>0% (Exempt / Non-GST)</option>
                            <option value={5}>5% (Basic)</option>
                            <option value={12}>12% (Standard)</option>
                            <option value={18}>18% (Standard Digital Services)</option>
                            <option value={28}>28% (Luxury)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Financial summary card */}
                    <div className="bg-indigo-50/60 rounded-xl p-3 border border-indigo-100 space-y-2 text-xs">
                      <div className="flex justify-between text-slate-700">
                        <span>Services Subtotal (Taxable):</span>
                        <span className="font-mono font-bold text-slate-900">₹{subtotal.toLocaleString('en-IN')}</span>
                      </div>

                      {applyGst && gstRate > 0 && (
                        <div className="flex justify-between text-indigo-900 font-semibold border-t border-indigo-100 pt-1.5">
                          <span>
                            {isInter ? `IGST (${gstRate}%)` : `CGST (${gstRate/2}%) + SGST (${gstRate/2}%)`}:
                          </span>
                          <span className="font-mono font-bold text-indigo-700">+ ₹{totalGst.toLocaleString('en-IN')}</span>
                        </div>
                      )}

                      <div className="flex justify-between text-indigo-950 font-bold text-sm border-t-2 border-indigo-200 pt-2">
                        <span>Grand Total Estimate:</span>
                        <span className="font-mono text-base text-indigo-600">₹{grandTotal.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="pt-2 border-t border-slate-200 flex justify-end gap-3 sticky bottom-0 bg-white py-3">
                  <button 
                    type="button" 
                    onClick={handleDownloadEstimatePdf} 
                    disabled={isDownloadingPdf}
                    className="px-4 py-2 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-bold flex items-center gap-1.5 border border-indigo-200 transition-all"
                    title="Download Estimate as PDF"
                  >
                    {isDownloadingPdf ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Generating PDF...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Download PDF</span>
                      </>
                    )}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      resetForm();
                      setIsCreating(false);
                    }} 
                    className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg text-xs flex items-center gap-1.5 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleSaveQuote()} 
                    disabled={isSaving}
                    className="px-6 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm text-xs flex items-center gap-2 transition-all"
                  >
                    {isSaving ? 'Saving...' : (editingQuoteId ? 'Update Estimate' : 'Save Estimate')}
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Real-time PDF Preview */}
            <div className="w-1/2 bg-slate-100 overflow-y-auto flex justify-center p-6">
              <div className="scale-[0.85] origin-top">
                <InvoicePDFTemplate
                  id="live-quote-pdf"
                  invoice={previewQuote as any}
                  documentTitle="SERVICE QUOTATION"
                  businessProfileFallback={businessProfile}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Viewing Quote Modal */}
      {viewingQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-6 overflow-hidden border border-slate-200">
            <div className="bg-slate-900 px-6 py-3 text-white flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold">Estimate Preview</h2>
                <p className="text-xs text-slate-400">Quote #{viewingQuote.quoteNumber}</p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => downloadElementAsPdf('modal-quote-pdf', `Estimate-${viewingQuote.quoteNumber}.pdf`)} 
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-bold flex items-center gap-1"
                >
                  <Download className="w-4 h-4" /> Download PDF
                </button>
                <button onClick={() => setViewingQuote(null)} className="p-1 rounded hover:bg-white/10"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-6 bg-slate-100 max-h-[75vh] overflow-y-auto flex justify-center">
              <InvoicePDFTemplate
                id="modal-quote-pdf"
                invoice={viewingQuote as any}
                documentTitle="SERVICE QUOTATION"
                businessProfileFallback={businessProfile}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
