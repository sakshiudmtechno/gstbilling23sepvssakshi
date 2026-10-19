import React, { useState, useEffect } from 'react';
import { Quote, Client, BusinessProfile, QuoteItem, Invoice } from '../../types';
import { api } from '../../utils/api';
import { downloadElementAsPdf, triggerPrint, getClientPdfFilename } from '../../utils/pdfGenerator';
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
  Megaphone,
  FileCheck,
  CheckCircle2
} from 'lucide-react';

interface QuoteManagerProps {
  quotes: Quote[];
  clients: Client[];
  invoices?: Invoice[];
  businessProfile: BusinessProfile | null;
  onRefresh: () => void;
  onConvertToInvoice: (quote: Quote, createdInvoice?: Invoice) => void;
  onEditInvoice?: (invoice: Invoice) => void;
}

export const QuoteManager: React.FC<QuoteManagerProps> = ({
  quotes,
  clients,
  invoices = [],
  businessProfile,
  onRefresh,
  onConvertToInvoice,
  onEditInvoice
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
  const [convertingQuoteId, setConvertingQuoteId] = useState<string | null>(null);

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

  const createEmptyItem = (id?: string): Partial<QuoteItem> => ({
    id: id || `qi_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: '',
    description: '',
    rate: 0,
    quantity: 1,
    unit: 'JOB',
    hsnSac: '9983',
    discountType: 'percentage',
    discountValue: 0,
    discountAmount: 0,
    taxableAmount: 0,
    gstRate: applyGst ? gstRate : 0,
    totalGstAmount: 0,
    total: 0
  });

  const [items, setItems] = useState<Partial<QuoteItem>[]>([
    {
      id: '1',
      name: '',
      description: '',
      rate: 0,
      quantity: 1,
      unit: 'JOB',
      hsnSac: '9983',
      discountType: 'percentage',
      discountValue: 0,
      discountAmount: 0,
      taxableAmount: 0,
      gstRate: 0,
      totalGstAmount: 0,
      total: 0
    }
  ]);

  const handleEditQuote = (quote: Quote) => {
    setEditingQuoteId(quote.id);
    setQuoteNumber(quote.quoteNumber);
    
    // Parse client name/company if they were merged like "Name (Company)"
    let cName = quote.client?.name || (quote as any).clientName || (quote as any).customerName || '';
    let compName = '';
    const match = cName.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      cName = match[1];
      compName = match[2];
    }
    
    setClientName(cName);
    setCompanyName(compName);
    setClientEmail(quote.client?.email || (quote as any).email || '');
    setClientPhone(quote.client?.phone || (quote as any).phone || '');
    setClientAddress(quote.client?.billingAddress || (quote.client as any)?.address || (quote as any).billingAddress || '');
    setClientState(quote.client?.state || quote.placeOfSupply || 'Madhya Pradesh');
    setClientStateCode(quote.client?.stateCode || quote.placeOfSupplyCode || '23');
    
    const hasGst = (quote.totalGst || 0) > 0 || ((quote.items?.[0]?.gstRate || 0) > 0);
    const activeGstRate = hasGst ? (quote.items?.[0]?.gstRate || 18) : 18;
    setApplyGst(hasGst);
    setGstRate(activeGstRate);

    if (quote.items && quote.items.length > 0) {
      setItems(quote.items.map((item, idx) => ({
        ...item,
        id: item.id || `qi_${quote.id}_${idx}`,
        quantity: item.quantity || 1,
        rate: item.rate || 0,
        gstRate: hasGst ? (item.gstRate ?? activeGstRate) : 0
      })));
    } else {
      setItems([createEmptyItem()]);
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
    setItems([{
      id: '1',
      name: '',
      description: '',
      rate: 0,
      quantity: 1,
      unit: 'JOB',
      hsnSac: '9983',
      discountType: 'percentage',
      discountValue: 0,
      discountAmount: 0,
      taxableAmount: 0,
      gstRate: 0,
      totalGstAmount: 0,
      total: 0
    }]);
    setApplyGst(false);
    setGstRate(18);
    setAdPlatform('meta');
    setAdDailyBudget(200);
    setAdDays(15);
    setQuoteDate(new Date().toISOString().split('T')[0]);
    setValidUntil(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  };

  const handleAddItem = () => {
    setItems(prev => [...prev, createEmptyItem()]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.length > 0 ? filtered : [createEmptyItem()];
    });
  };

  // Atomically select and apply a pre-defined service package to an existing item row
  const handleApplyPredefinedService = (index: number, serviceId: string) => {
    const preset = PREDEFINED_SERVICES.find(s => s.id === serviceId);
    if (!preset) return;

    setItems(prev => {
      const next = [...prev];
      const existing = next[index] || {};
      const rate = Number(preset.rate) || 0;
      const qty = Math.max(1, Number(existing.quantity) || 1);
      const gross = rate * qty;
      const dType = existing.discountType || 'percentage';
      const dVal = Math.max(0, Number(existing.discountValue) || 0);
      const rawDisc = dType === 'percentage' ? (gross * Math.min(100, dVal)) / 100 : dVal;
      const discAmt = Math.min(gross, Math.max(0, rawDisc));
      const taxable = Math.max(0, gross - discAmt);
      const selectedGst = applyGst ? gstRate : 0;
      const gstAmt = (taxable * selectedGst) / 100;

      next[index] = {
        ...existing,
        id: existing.id || `qi_${Date.now()}_${index}`,
        name: preset.name,
        rate: rate,
        description: preset.description,
        hsnSac: preset.hsnSac || '9983',
        unit: preset.unit || 'JOB',
        quantity: qty,
        discountType: dType,
        discountValue: dVal,
        discountAmount: Math.round(discAmt * 100) / 100,
        taxableAmount: Math.round(taxable * 100) / 100,
        gstRate: selectedGst,
        totalGstAmount: Math.round(gstAmt * 100) / 100,
        total: Math.round((taxable + (applyGst ? gstAmt : 0)) * 100) / 100
      };
      return next;
    });
    toast.success(`Loaded "${preset.name}" into estimate`);
  };

  // Add a pre-defined service package as a new item row
  const handleAddPredefinedServiceAsNew = (serviceId: string) => {
    const preset = PREDEFINED_SERVICES.find(s => s.id === serviceId);
    if (!preset) return;

    setItems(prev => {
      const isSingleEmpty = prev.length === 1 && !prev[0].name?.trim() && (!prev[0].rate || prev[0].rate === 0);
      const rate = Number(preset.rate) || 0;
      const qty = 1;
      const gross = rate * qty;
      const selectedGst = applyGst ? gstRate : 0;
      const gstAmt = (gross * selectedGst) / 100;

      const newItem: Partial<QuoteItem> = {
        id: `qi_${Date.now()}_${prev.length}`,
        name: preset.name,
        rate: rate,
        quantity: qty,
        description: preset.description,
        hsnSac: preset.hsnSac || '9983',
        unit: preset.unit || 'JOB',
        discountType: 'percentage',
        discountValue: 0,
        discountAmount: 0,
        taxableAmount: rate,
        gstRate: selectedGst,
        totalGstAmount: Math.round(gstAmt * 100) / 100,
        total: Math.round((gross + (applyGst ? gstAmt : 0)) * 100) / 100
      };

      if (isSingleEmpty) {
        return [newItem];
      }
      return [...prev, newItem];
    });
    toast.success(`Added "${preset.name}" to estimate`);
  };

  const handleItemChange = (index: number, field: keyof QuoteItem, value: any) => {
    setItems(prev => {
      const newItems = [...prev];
      const existing = newItems[index] || {};
      const item: any = { ...existing, [field]: value };
      
      const rate = item.rate === '' ? 0 : Math.max(0, Number(item.rate) || 0);
      const qty = item.quantity === '' ? 1 : Math.max(1, Number(item.quantity) || 1);
      const gross = rate * qty;
      const dType = item.discountType || 'percentage';
      const dVal = item.discountValue === '' ? 0 : Math.max(0, Number(item.discountValue) || 0);
      const rawDisc = dType === 'percentage' ? (gross * Math.min(100, dVal)) / 100 : dVal;
      const discAmt = Math.min(gross, Math.max(0, rawDisc));
      const taxable = Math.max(0, gross - discAmt);
      const selectedGst = applyGst ? gstRate : 0;
      const gstAmt = (taxable * selectedGst) / 100;

      item.discountType = dType;
      item.discountValue = item.discountValue === '' ? '' : dVal;
      item.discountAmount = Math.round(discAmt * 100) / 100;
      item.taxableAmount = Math.round(taxable * 100) / 100;
      item.gstRate = selectedGst;
      item.totalGstAmount = Math.round(gstAmt * 100) / 100;
      item.total = Math.round((taxable + (applyGst ? gstAmt : 0)) * 100) / 100;

      newItems[index] = item;
      return newItems;
    });
  };

  // Toggle GST and update all items in real-time
  const handleToggleGst = (enable: boolean, newRate?: number) => {
    setApplyGst(enable);
    const rateToUse = enable ? (newRate !== undefined ? newRate : (gstRate === 0 ? 18 : gstRate)) : 0;
    setGstRate(rateToUse);
    setItems(prev => prev.map(item => {
      const rate = (item.rate as any) === '' ? 0 : Math.max(0, Number(item.rate) || 0);
      const qty = (item.quantity as any) === '' ? 1 : Math.max(1, Number(item.quantity) || 1);
      const gross = rate * qty;
      const dType = item.discountType || 'percentage';
      const dVal = (item.discountValue as any) === '' ? 0 : Math.max(0, Number(item.discountValue) || 0);
      const rawDisc = dType === 'percentage' ? (gross * Math.min(100, dVal)) / 100 : dVal;
      const discAmt = Math.min(gross, Math.max(0, rawDisc));
      const taxable = Math.max(0, gross - discAmt);
      const gstAmt = (taxable * rateToUse) / 100;
      return {
        ...item,
        taxableAmount: Math.round(taxable * 100) / 100,
        gstRate: rateToUse,
        totalGstAmount: Math.round(gstAmt * 100) / 100,
        total: Math.round((taxable + (enable ? gstAmt : 0)) * 100) / 100
      };
    }));
  };

  // Add Ad Campaign package with dynamic calculation into Quote items
  const handleAddAdCampaignToQuote = () => {
    const stats = calculateAdBudgetStats(adPlatform, adDailyBudget, adDays);
    const selectedGst = applyGst ? gstRate : 0;
    const gross = stats.totalBudget;
    const gstAmt = (gross * selectedGst) / 100;
    
    setItems(prev => {
      const isSingleEmpty = prev.length === 1 && !prev[0].name?.trim() && (!prev[0].rate || prev[0].rate === 0);
      const newItem: Partial<QuoteItem> = {
        id: `qi_ad_${Date.now()}`,
        name: stats.title,
        description: stats.description,
        rate: stats.totalBudget,
        quantity: 1,
        unit: 'CAMPAIGN',
        hsnSac: '998313',
        discountType: 'percentage',
        discountValue: 0,
        discountAmount: 0,
        taxableAmount: stats.totalBudget,
        gstRate: selectedGst,
        totalGstAmount: Math.round(gstAmt * 100) / 100,
        total: Math.round((gross + (applyGst ? gstAmt : 0)) * 100) / 100
      };

      if (isSingleEmpty) {
        return [newItem];
      }
      return [...prev, newItem];
    });
    toast.success(`Added ${stats.title} to estimate`);
  };

  const handleSaveQuote = async (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();

    const targetClient = clientName.trim() || companyName.trim();
    if (!targetClient) {
      toast.error('Please enter a Client Name or Company Name before saving the estimate.');
      return;
    }

    // Filter valid items that have a title or positive rate
    const validItems = items.filter(it => it.name?.trim() || (Number(it.rate) || 0) > 0);
    if (validItems.length === 0) {
      toast.error('Please enter at least one service item with a title or rate.');
      return;
    }

    setIsSaving(true);
    
    const existingQuote = editingQuoteId ? quotes.find(q => q.id === editingQuoteId) : null;
    const resolvedClientId = existingQuote?.clientId || existingQuote?.client?.id || `client_${Date.now()}`;
    const formattedClientName = companyName.trim() 
      ? (clientName.trim() ? `${clientName.trim()} (${companyName.trim()})` : companyName.trim()) 
      : clientName.trim();

    const tempClientObj: Client = {
      id: resolvedClientId,
      name: formattedClientName,
      contactPerson: clientName.trim() || companyName.trim(),
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
      createdAt: existingQuote?.client?.createdAt || new Date().toISOString()
    };

    let subtotal = 0;
    let totalDiscount = 0;
    let totalTaxable = 0;
    let totalGst = 0;
    const isInter = clientStateCode !== (businessProfile?.stateCode || '23');
    const selectedGstRate = applyGst ? gstRate : 0;

    const finalItems = validItems.map((item, i) => {
      const rate = (item.rate as any) === '' ? 0 : Math.max(0, Number(item.rate) || 0);
      const qty = (item.quantity as any) === '' ? 1 : Math.max(1, Number(item.quantity) || 1);
      const gross = rate * qty;
      const dType = item.discountType || 'percentage';
      const dVal = (item.discountValue as any) === '' ? 0 : Math.max(0, Number(item.discountValue) || 0);
      const rawDisc = dType === 'percentage' ? (gross * Math.min(100, dVal)) / 100 : dVal;
      const discAmt = Math.min(gross, Math.max(0, rawDisc));
      const taxable = Math.max(0, gross - discAmt);
      const gstAmt = (taxable * selectedGstRate) / 100;

      subtotal += gross;
      totalDiscount += discAmt;
      totalTaxable += taxable;
      totalGst += gstAmt;

      return {
        id: item.id || `qi_${Date.now()}_${i}`,
        name: item.name?.trim() || 'Service Package',
        description: item.description?.trim() || '',
        hsnSac: item.hsnSac || '9983',
        quantity: qty,
        unit: item.unit || 'JOB',
        rate: rate,
        discountType: dType,
        discountValue: typeof dVal === 'number' ? dVal : 0,
        discountAmount: Math.round(discAmt * 100) / 100,
        taxableAmount: Math.round(taxable * 100) / 100,
        gstRate: selectedGstRate,
        cgstAmount: applyGst && !isInter ? Math.round((gstAmt / 2) * 100) / 100 : 0,
        sgstAmount: applyGst && !isInter ? Math.round((gstAmt / 2) * 100) / 100 : 0,
        igstAmount: applyGst && isInter ? Math.round(gstAmt * 100) / 100 : 0,
        totalGstAmount: Math.round(gstAmt * 100) / 100,
        total: Math.round((taxable + (applyGst ? gstAmt : 0)) * 100) / 100
      } as QuoteItem;
    });

    const grandTotal = Math.round((totalTaxable + (applyGst ? totalGst : 0)) * 100) / 100;

    const newQuote: any = {
      ...(existingQuote || {}),
      id: editingQuoteId || undefined,
      quoteNumber,
      clientId: resolvedClientId,
      client: tempClientObj,
      quoteDate: quoteDate,
      validUntil: validUntil,
      status: existingQuote?.status || 'draft',
      placeOfSupply: clientState,
      placeOfSupplyCode: clientStateCode,
      currency: 'INR',
      items: finalItems,
      subtotal: Math.round(subtotal * 100) / 100,
      totalItemDiscount: Math.round(totalDiscount * 100) / 100,
      totalTaxableAmount: Math.round(totalTaxable * 100) / 100,
      totalGst: applyGst ? Math.round(totalGst * 100) / 100 : 0,
      totalCgst: applyGst && !isInter ? Math.round((totalGst / 2) * 100) / 100 : 0,
      totalSgst: applyGst && !isInter ? Math.round((totalGst / 2) * 100) / 100 : 0,
      totalIgst: applyGst && isInter ? Math.round(totalGst * 100) / 100 : 0,
      grandTotal,
      totalInWords: numberToIndianWords(Math.round(grandTotal)),
      template: existingQuote?.template || 'classic',
      showBankDetails: false,
      seller: businessProfile ? { ...businessProfile, logoUrl: undefined } : undefined
    };

    try {
      if (editingQuoteId) {
        await api.updateQuote(editingQuoteId, newQuote);
      } else {
        await api.createQuote(newQuote);
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
      const targetClientName = clientName.trim() || companyName.trim() || 'Client';
      const filename = getClientPdfFilename(targetClientName, `Estimate-${quoteNumber}`);
      await downloadElementAsPdf('live-quote-pdf', filename);
      toast.success(`Estimate PDF "${filename}" downloaded`);
    } catch (err) {
      console.error('Failed to download PDF:', err);
      toast.error('Failed to generate estimate PDF. Please try again.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleConvertToInvoice = async (quote: Quote) => {
    try {
      setConvertingQuoteId(quote.id);
      toast.info(`Converting estimate "${quote.quoteNumber}" to Tax Invoice...`);
      const createdInvoice = await api.convertQuoteToInvoice(quote.id);
      toast.success(`Success! Estimate converted to Invoice #${createdInvoice.invoiceNumber}`);
      await onRefresh();
      onConvertToInvoice(quote, createdInvoice);
    } catch (err: any) {
      console.error('Convert to invoice error:', err);
      toast.error(err.message || 'Failed to convert estimate to invoice. Please try again.');
    } finally {
      setConvertingQuoteId(null);
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
      const targetClient = quote.client?.name || (quote as any).clientName || (quote as any).customerName;
      const filename = getClientPdfFilename(targetClient, `Estimate-${quote.quoteNumber}`);
      await downloadElementAsPdf(`direct-quote-pdf-${quote.id}`, filename);
      toast.success(`Estimate PDF "${filename}" downloaded`);
    } catch (err) {
      console.error('Failed to download quote PDF:', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setDownloadingQuoteId(null);
      setDirectDownloadQuote(null);
    }
  };

  const tempClient: Client = {
    id: editingQuoteId || `client_${Date.now()}`,
    name: companyName ? `${clientName} (${companyName})` : (clientName || 'New Client'),
    contactPerson: clientName || companyName || 'Client',
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
  let totalDiscount = 0;
  let totalTaxable = 0;
  let totalGst = 0;
  const isInter = clientStateCode !== (businessProfile?.stateCode || '23');
  const selectedGstRate = applyGst ? gstRate : 0;

  const finalItems = items.map((item, i) => {
    const rate = (item.rate as any) === '' ? 0 : Math.max(0, Number(item.rate) || 0);
    const qty = (item.quantity as any) === '' ? 1 : Math.max(1, Number(item.quantity) || 1);
    const gross = rate * qty;
    const dType = item.discountType || 'percentage';
    const dVal = (item.discountValue as any) === '' ? 0 : Math.max(0, Number(item.discountValue) || 0);
    const rawDisc = dType === 'percentage' ? (gross * Math.min(100, dVal)) / 100 : dVal;
    const discAmt = Math.min(gross, Math.max(0, rawDisc));
    const taxable = Math.max(0, gross - discAmt);
    const gstAmt = (taxable * selectedGstRate) / 100;

    subtotal += gross;
    totalDiscount += discAmt;
    totalTaxable += taxable;
    totalGst += gstAmt;

    return {
      id: item.id || `preview_qi_${i}`,
      name: item.name?.trim() || 'Service Item',
      description: item.description?.trim() || '',
      hsnSac: item.hsnSac || '9983',
      quantity: qty,
      unit: item.unit || 'JOB',
      rate: rate,
      discountType: dType,
      discountValue: dVal,
      discountAmount: Math.round(discAmt * 100) / 100,
      taxableAmount: Math.round(taxable * 100) / 100,
      gstRate: selectedGstRate,
      cgstAmount: applyGst && !isInter ? Math.round((gstAmt / 2) * 100) / 100 : 0,
      sgstAmount: applyGst && !isInter ? Math.round((gstAmt / 2) * 100) / 100 : 0,
      igstAmount: applyGst && isInter ? Math.round(gstAmt * 100) / 100 : 0,
      totalGstAmount: Math.round(gstAmt * 100) / 100,
      total: Math.round((taxable + (applyGst ? gstAmt : 0)) * 100) / 100
    } as QuoteItem;
  });

  const grandTotal = Math.round((totalTaxable + (applyGst ? totalGst : 0)) * 100) / 100;

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
    subtotal: Math.round(subtotal * 100) / 100,
    totalItemDiscount: Math.round(totalDiscount * 100) / 100,
    totalTaxableAmount: Math.round(totalTaxable * 100) / 100,
    totalGst: applyGst ? Math.round(totalGst * 100) / 100 : 0,
    totalCgst: applyGst && !isInter ? Math.round((totalGst / 2) * 100) / 100 : 0,
    totalSgst: applyGst && !isInter ? Math.round((totalGst / 2) * 100) / 100 : 0,
    totalIgst: applyGst && isInter ? Math.round(totalGst * 100) / 100 : 0,
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
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Estimates & Quotes</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Create client quotations with optional GST calculation and ad budget planning.</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsCreating(true);
          }}
          className="bg-teal-700 text-white px-4 py-2 rounded-lg font-semibold hover:bg-teal-800 flex items-center gap-2 shadow-2xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Quick Estimate
        </button>
      </div>

      {/* List of Quotes */}
      <div className="bg-white rounded-xl shadow-2xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-600 font-bold">
                <th className="p-3.5 font-bold">Quote No.</th>
                <th className="p-3.5 font-bold">Client</th>
                <th className="p-3.5 font-bold">Date</th>
                <th className="p-3.5 font-bold text-center">Tax Scheme</th>
                <th className="p-3.5 font-bold text-right">Amount</th>
                <th className="p-3.5 font-bold text-center">Status</th>
                <th className="p-3.5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No quotes found. Click "Create Quick Estimate" to generate your first quotation.
                  </td>
                </tr>
              ) : (
                quotes.map(quote => (
                  <tr key={quote.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3.5 font-mono text-xs font-bold text-teal-900">{quote.quoteNumber}</td>
                    <td className="p-3.5">
                      <p className="font-semibold text-slate-900">{quote.client.name}</p>
                      <p className="text-[11px] text-slate-500">{quote.client.email || 'No email'}</p>
                    </td>
                    <td className="p-3.5 text-xs text-slate-600">{new Date(quote.quoteDate).toLocaleDateString()}</td>
                    <td className="p-3.5 text-center">
                      {(quote.totalGst || 0) > 0 ? (
                        <span className="px-2 py-0.5 bg-teal-50 text-teal-900 border border-teal-200 rounded text-[11px] font-semibold">
                          GST Applied
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-medium">
                          Without GST
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900">₹{quote.grandTotal?.toLocaleString('en-IN') || "0"}</td>
                    <td className="p-3.5 text-center">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-semibold uppercase tracking-wider">
                        {quote.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingQuote(quote)}
                          className="p-1.5 text-teal-700 hover:bg-teal-50 rounded transition-colors cursor-pointer"
                          title="View Estimate Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        
                        <button
                          onClick={() => handleDownloadRowPdf(quote)}
                          disabled={downloadingQuoteId === quote.id}
                          className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors disabled:opacity-50 cursor-pointer"
                          title="Download Estimate PDF"
                          aria-label={`Download PDF for estimate ${quote.quoteNumber}`}
                        >
                          {downloadingQuoteId === quote.id ? (
                            <Loader2 className="w-4 h-4 text-teal-700 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleEditQuote(quote)}
                          className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors cursor-pointer"
                          title="Edit Estimate"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteQuote(quote)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                          title="Delete Estimate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {quote.status !== 'converted' ? (
                          <button
                            onClick={() => handleConvertToInvoice(quote)}
                            disabled={convertingQuoteId === quote.id}
                            className="ml-1 px-2.5 py-1 text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                            title="Convert Estimate to Tax Invoice"
                          >
                            {convertingQuoteId === quote.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Converting...</span>
                              </>
                            ) : (
                              <>
                                <FileCheck className="w-3.5 h-3.5" />
                                <span>Convert to Invoice</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              const matchingInv = invoices?.find(inv => inv.id === quote.convertedToInvoiceId || inv.invoiceNumber === quote.convertedToInvoiceNumber);
                              if (matchingInv && onEditInvoice) {
                                onEditInvoice(matchingInv);
                              } else {
                                handleConvertToInvoice(quote);
                              }
                            }}
                            className="ml-1 px-2 py-0.5 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title={`Converted to Invoice #${quote.convertedToInvoiceNumber || ''}. Click to open in Invoice Editor.`}
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>{quote.convertedToInvoiceNumber ? `Inv #${quote.convertedToInvoiceNumber}` : 'Converted'}</span>
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
                className="px-4 py-2 font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm flex items-center gap-1.5 border border-teal-200 cursor-pointer shadow-2xs"
                title="Download Estimate as PDF"
              >
                {isDownloadingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                    <span>Generating PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-teal-700" />
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
                className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg text-sm flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button 
                type="button" 
                onClick={() => handleSaveQuote()} 
                disabled={isSaving}
                className="px-5 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-2xs text-sm flex items-center gap-2 cursor-pointer"
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
                    <h3 className="text-xs font-bold text-teal-950 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal-700"></span>
                      1. Client &amp; Estimate Details
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500 font-semibold">{quoteNumber}</span>
                  </div>
                  
                  <div className="p-4 space-y-3.5">
                    {/* Optional Auto-fill from Existing Clients */}
                    {clients && clients.length > 0 && (
                      <div className="p-2.5 bg-teal-50/50 border border-teal-200/80 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-bold text-teal-950 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                            Auto-Fill from Existing Client
                          </label>
                          <span className="text-[10px] text-slate-500 font-medium">Optional</span>
                        </div>
                        <select
                          className="w-full px-2.5 py-1.5 bg-white border border-teal-200 rounded-lg text-xs font-medium text-slate-800 focus:ring-2 focus:ring-teal-700 outline-hidden cursor-pointer"
                          onChange={(e) => {
                            const selected = clients.find(c => c.id === e.target.value);
                            if (selected) {
                              let cName = selected.name || '';
                              let compName = '';
                              const match = cName.match(/^(.*?)\s*\((.*?)\)$/);
                              if (match) {
                                cName = match[1];
                                compName = match[2];
                              }
                              setClientName(cName);
                              setCompanyName(compName);
                              setClientEmail(selected.email || '');
                              setClientPhone(selected.phone || '');
                              setClientAddress(selected.billingAddress || selected.shippingAddress || '');
                              setClientState(selected.state || 'Madhya Pradesh');
                              setClientStateCode(selected.stateCode || '23');
                              toast.success(`Client details for "${selected.name}" auto-filled`);
                            }
                            e.target.value = "";
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>-- Select Client to Auto-Fill Information --</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.phone ? `(${c.phone})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Client Name <span className="text-rose-500">*</span></label>
                        <input 
                          type="text" 
                          required 
                          value={clientName} 
                          onChange={e => setClientName(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="e.g. Rahul Sharma" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Company / Business Name</label>
                        <input 
                          type="text" 
                          value={companyName} 
                          onChange={e => setCompanyName(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
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
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="+91 98765 43210" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                        <input 
                          type="email" 
                          value={clientEmail} 
                          onChange={e => setClientEmail(e.target.value)} 
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
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
                          className="w-full px-3 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 focus:ring-1 focus:ring-teal-700 rounded-lg text-xs font-medium text-slate-900 transition-all outline-hidden" 
                          placeholder="e.g. MG Road, Indore, MP" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Estimate Date</label>
                        <input 
                          type="date" 
                          value={quoteDate} 
                          onChange={e => setQuoteDate(e.target.value)} 
                          className="w-full px-2.5 py-2 bg-slate-50/50 border border-slate-300 focus:bg-white focus:border-teal-700 rounded-lg text-xs font-medium text-slate-900 outline-hidden" 
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Quotation Service Items & Deliverables (Selection of Service) */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-teal-950 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal-700"></span>
                      2. Service Items &amp; Deliverables
                    </h3>
                    <div className="flex items-center gap-2">
                      {/* Quick Add Ready Package Dropdown */}
                      <select
                        className="text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-300 px-2.5 py-1 rounded-lg transition-all shadow-2xs cursor-pointer outline-hidden"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddPredefinedServiceAsNew(e.target.value);
                            e.target.value = "";
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>+ Add Service Package</option>
                        <optgroup label="Paid Ads & Lead Generation">
                          {PREDEFINED_SERVICES.filter(s => s.category === 'Paid Ads & Lead Gen').map(s => (
                            <option key={s.id} value={s.id}>{s.name} (₹{s.rate.toLocaleString('en-IN')})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Website Development">
                          {PREDEFINED_SERVICES.filter(s => s.category === 'Website Development').map(s => (
                            <option key={s.id} value={s.id}>{s.name} (₹{s.rate.toLocaleString('en-IN')})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Digital Marketing & SEO">
                          {PREDEFINED_SERVICES.filter(s => s.category === 'Digital Marketing & SEO').map(s => (
                            <option key={s.id} value={s.id}>{s.name} (₹{s.rate.toLocaleString('en-IN')})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Landing Pages">
                          {PREDEFINED_SERVICES.filter(s => s.category === 'Landing Pages').map(s => (
                            <option key={s.id} value={s.id}>{s.name} (₹{s.rate.toLocaleString('en-IN')})</option>
                          ))}
                        </optgroup>
                      </select>
                      <button 
                        type="button" 
                        onClick={handleAddItem} 
                        className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Custom Row
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-4">
                    {items.map((item, index) => (
                      <div key={item.id || index} className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-200/90 relative hover:border-teal-200 transition-all space-y-3">
                        {/* Auto-fill from predefined library */}
                        <div>
                          <label className="block text-[11px] font-bold text-teal-950 mb-1 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                            Select Pre-Defined Service Package
                          </label>
                          <select 
                            className="w-full px-3 py-1.5 border border-teal-300 bg-white rounded-lg text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-teal-700 outline-hidden shadow-2xs cursor-pointer"
                            onChange={(e) => {
                              if (e.target.value) {
                                handleApplyPredefinedService(index, e.target.value);
                                e.target.value = "";
                              }
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

                        {/* Title, Rate, Qty, Discount Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                          <div className="md:col-span-5">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Service Title <span className="text-rose-500">*</span></label>
                            <input 
                              type="text" 
                              required 
                              value={item.name || ''} 
                              onChange={e => handleItemChange(index, 'name', e.target.value)} 
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:border-teal-700 outline-hidden" 
                              placeholder="e.g. Custom Website Development" 
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Rate (₹) <span className="text-rose-500">*</span></label>
                            <input 
                              type="number" 
                              required 
                              value={item.rate === 0 && !item.name ? '' : (item.rate ?? '')} 
                              onChange={e => handleItemChange(index, 'rate', e.target.value === '' ? '' : Number(e.target.value))} 
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:border-teal-700 outline-hidden" 
                              placeholder="0" 
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Qty</label>
                            <input 
                              type="number" 
                              min={1}
                              value={item.quantity ?? 1} 
                              onChange={e => handleItemChange(index, 'quantity', e.target.value === '' ? '' : Number(e.target.value))} 
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-center text-slate-900 focus:border-teal-700 outline-hidden" 
                            />
                          </div>
                          <div className="md:col-span-2">
                            <div className="flex justify-between items-center mb-1">
                              <label className="block text-[11px] font-semibold text-slate-700">Discount</label>
                              {(item.discountAmount || 0) > 0 && (
                                <span className="text-[9.5px] font-mono font-bold text-emerald-700">-₹{Math.round(item.discountAmount || 0)}</span>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <input 
                                type="number" 
                                min={0}
                                placeholder="0"
                                value={item.discountValue ?? ''} 
                                onChange={e => handleItemChange(index, 'discountValue', e.target.value === '' ? '' : Number(e.target.value))} 
                                className="w-full min-w-0 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:border-teal-700 outline-hidden" 
                              />
                              <select
                                value={item.discountType || 'percentage'}
                                onChange={e => handleItemChange(index, 'discountType', e.target.value)}
                                className="px-1.5 py-1.5 bg-slate-100 border border-slate-300 rounded-lg text-[10px] font-bold text-slate-700 outline-hidden shrink-0 cursor-pointer"
                              >
                                <option value="percentage">%</option>
                                <option value="fixed">₹</option>
                              </select>
                            </div>
                          </div>
                          {items.length > 1 && (
                            <div className="md:col-span-1 flex justify-end">
                              <button 
                                type="button" 
                                onClick={() => handleRemoveItem(index)} 
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs leading-relaxed focus:border-teal-700 outline-hidden" 
                            rows={2} 
                            placeholder="Detail features, delivery timelines, scope of work..."
                          ></textarea>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Meta & Google Ads Budget & Lead Estimator Calculator (Positioned AFTER Service Selection) */}
                <div className="bg-gradient-to-br from-teal-50/70 via-slate-50 to-teal-50/50 rounded-xl border border-teal-200/90 shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 bg-white/70 border-b border-teal-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 bg-teal-700 text-white rounded-md">
                        <Target className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-xs font-bold text-teal-950 uppercase tracking-wider">
                        3. Ads Campaign Budget &amp; Lead Estimator
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdCalculator(!showAdCalculator)}
                      className="text-xs font-bold text-teal-800 hover:text-teal-950 cursor-pointer"
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
                            className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                              adPlatform === 'meta'
                                ? 'bg-teal-700 text-white shadow-2xs'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <span>📱 Meta Ads (FB &amp; IG)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdPlatform('google')}
                            className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                              adPlatform === 'google'
                                ? 'bg-teal-700 text-white shadow-2xs'
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
                        <div className="bg-white/80 p-2.5 rounded-lg border border-teal-100">
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] font-bold text-slate-700">Daily Budget:</label>
                            <span className="text-xs font-mono font-bold text-teal-800">₹{adDailyBudget}/day</span>
                          </div>
                          <input
                            type="number"
                            min={100}
                            step={50}
                            value={adDailyBudget}
                            onChange={e => setAdDailyBudget(Math.max(1, Number(e.target.value)))}
                            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-md text-xs font-mono font-bold mb-1.5 focus:border-teal-700 outline-hidden"
                            placeholder="200"
                          />
                          <div className="flex flex-wrap gap-1">
                            {[200, 300, 500, 1000, 2000].map(amt => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setAdDailyBudget(amt)}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                  adDailyBudget === amt
                                    ? 'bg-teal-700 text-white font-bold'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-teal-50'
                                }`}
                              >
                                ₹{amt}/d
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Duration Days */}
                        <div className="bg-white/80 p-2.5 rounded-lg border border-teal-100">
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] font-bold text-slate-700">Duration (Days):</label>
                            <span className="text-xs font-mono font-bold text-teal-800">{adDays} Days</span>
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={adDays}
                            onChange={e => setAdDays(Math.max(1, Number(e.target.value)))}
                            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-md text-xs font-mono font-bold mb-1.5 focus:border-teal-700 outline-hidden"
                            placeholder="15"
                          />
                          <div className="flex flex-wrap gap-1">
                            {[7, 15, 30, 45, 60].map(d => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setAdDays(d)}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                  adDays === d
                                    ? 'bg-teal-700 text-white font-bold'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-teal-50'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Calculated Outcome & Add button */}
                      <div className="bg-white p-3 rounded-xl border border-teal-200 space-y-2.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-600 font-medium">Calculated Ad Spend:</span>
                          <span className="font-mono font-bold text-sm text-teal-950">
                            ₹{adDailyBudget.toLocaleString('en-IN')} × {adDays}d = <span className="text-teal-700 font-bold">₹{adStats.totalBudget.toLocaleString('en-IN')}</span>
                          </span>
                        </div>
                        
                        <div className="bg-teal-50/70 p-2 rounded-lg border border-teal-100 text-xs">
                          <div className="flex items-center gap-1.5 text-teal-950 font-bold mb-0.5 text-[11px]">
                            <TrendingUp className="w-3.5 h-3.5 text-teal-700" />
                            <span>Estimated Leads Proportion:</span>
                          </div>
                          <p className="text-slate-700 text-[11px] leading-relaxed">
                            ~<strong className="text-teal-900 font-bold">{adStats.dailyMinLeads}–{adStats.dailyMaxLeads} leads/day</strong> ({adStats.totalMinLeads}–{adStats.totalMaxLeads} leads across {adDays} days) based on niche &amp; competition.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddAdCampaignToQuote}
                          className="w-full py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
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
                    <h3 className="text-xs font-bold text-teal-950 uppercase tracking-wider flex items-center gap-2">
                      <Percent className="w-3.5 h-3.5 text-teal-700" />
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
                          onClick={() => handleToggleGst(false)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            !applyGst 
                              ? 'bg-teal-700 text-white shadow-2xs' 
                              : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          Without GST (0%)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleGst(true, gstRate === 0 ? 18 : gstRate)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            applyGst 
                              ? 'bg-teal-700 text-white shadow-2xs' 
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
                              if (val === 0) {
                                handleToggleGst(false);
                              } else {
                                handleToggleGst(true, val);
                              }
                            }}
                            className="px-2.5 py-1.5 border border-teal-300 bg-white rounded-lg text-xs font-bold text-teal-950 focus:ring-2 focus:ring-teal-700 outline-hidden cursor-pointer"
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
                    <div className="bg-teal-50/60 rounded-xl p-3 border border-teal-100 space-y-2 text-xs">
                      <div className="flex justify-between text-slate-700">
                        <span>Services Subtotal (Gross):</span>
                        <span className="font-mono font-bold text-slate-900">₹{subtotal.toLocaleString('en-IN')}</span>
                      </div>

                      {totalDiscount > 0 && (
                        <div className="flex justify-between text-emerald-800 font-semibold bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                          <span>Discount on Services:</span>
                          <span className="font-mono font-bold">- ₹{totalDiscount.toLocaleString('en-IN')}</span>
                        </div>
                      )}

                      <div className="flex justify-between text-slate-700">
                        <span>Taxable Amount (Net Base):</span>
                        <span className="font-mono font-bold text-slate-900">₹{totalTaxable.toLocaleString('en-IN')}</span>
                      </div>

                      {applyGst && gstRate > 0 && (
                        <div className="flex justify-between text-teal-950 font-semibold border-t border-teal-100 pt-1.5">
                          <span>
                            GST ({gstRate}%):
                          </span>
                          <span className="font-mono font-bold text-teal-800">+ ₹{totalGst.toLocaleString('en-IN')}</span>
                        </div>
                      )}

                      <div className="flex justify-between text-teal-950 font-bold text-sm border-t-2 border-teal-200 pt-2">
                        <span>Grand Total Estimate:</span>
                        <span className="font-mono text-base text-teal-700 font-bold">₹{grandTotal.toLocaleString('en-IN')}</span>
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
                    className="px-4 py-2 font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-bold flex items-center gap-1.5 border border-teal-200 transition-all cursor-pointer"
                    title="Download Estimate as PDF"
                  >
                    {isDownloadingPdf ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                        <span>Generating PDF...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 text-teal-700" />
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
                    className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleSaveQuote()} 
                    disabled={isSaving}
                    className="px-6 py-2.5 font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-2xs text-xs flex items-center gap-2 transition-all cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-6 overflow-hidden border border-slate-200">
            <div className="bg-slate-900 px-6 py-3 text-white flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold">Estimate Preview</h2>
                <p className="text-xs text-slate-400">Quote #{viewingQuote.quoteNumber}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const q = viewingQuote;
                    setViewingQuote(null);
                    handleEditQuote(q);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Edit this estimate"
                >
                  <Edit className="w-3.5 h-3.5 text-teal-400" />
                  <span>Edit Estimate</span>
                </button>
                {viewingQuote.status !== 'converted' && (
                  <button
                    onClick={async () => {
                      const quoteToConvert = viewingQuote;
                      setViewingQuote(null);
                      await handleConvertToInvoice(quoteToConvert);
                    }}
                    disabled={convertingQuoteId === viewingQuote.id}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                    title="Convert this estimate into an invoice"
                  >
                    {convertingQuoteId === viewingQuote.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileCheck className="w-4 h-4" />
                    )}
                    <span>Convert to Invoice</span>
                  </button>
                )}
                <button 
                  onClick={() => {
                    const clientTarget = viewingQuote.client?.name || (viewingQuote as any).clientName || (viewingQuote as any).customerName;
                    const filename = getClientPdfFilename(clientTarget, `Estimate-${viewingQuote.quoteNumber}`);
                    downloadElementAsPdf('modal-quote-pdf', filename);
                  }} 
                  className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 rounded text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Download PDF
                </button>
                <button onClick={() => setViewingQuote(null)} className="p-1 rounded hover:bg-white/10 cursor-pointer"><X className="w-5 h-5" /></button>
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
