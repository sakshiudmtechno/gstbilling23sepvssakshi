import React, { useState, useEffect } from 'react';
import { Client } from '../../types';
import { INDIAN_STATES, validateGSTIN, getStateByCode } from '../../utils/gstUtils';
import { X, Check, Building2, AlertCircle } from 'lucide-react';
import { toast } from '../common/Toast';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (clientData: Partial<Client>) => Promise<void>;
  editingClient?: Client | null;
}

export const ClientModal: React.FC<ClientModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingClient
}) => {
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Madhya Pradesh');
  const [stateCode, setStateCode] = useState('23');
  const [country, setCountry] = useState('India');
  const [pinCode, setPinCode] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [customerType, setCustomerType] = useState<'B2B' | 'B2C' | 'SEZ' | 'Export'>('B2B');
  const [notes, setNotes] = useState('');
  const [gstinStatus, setGstinStatus] = useState<{ isValid: boolean; message?: string }>({ isValid: true });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingClient) {
      setName(editingClient.name || '');
      setContactPerson(editingClient.contactPerson || '');
      setEmail(editingClient.email || '');
      setPhone(editingClient.phone || '');
      setBillingAddress(editingClient.billingAddress || '');
      setShippingAddress(editingClient.shippingAddress || '');
      setCity(editingClient.city || '');
      setState(editingClient.state || 'Madhya Pradesh');
      setStateCode(editingClient.stateCode || '23');
      setCountry(editingClient.country || 'India');
      setPinCode(editingClient.pinCode || '');
      setGstin(editingClient.gstin || '');
      setPan(editingClient.pan || '');
      setCustomerType((editingClient.customerType as any) || 'B2B');
      setNotes(editingClient.notes || '');
      setGstinStatus({ isValid: true });
    } else {
      // Reset defaults for new client
      setName('');
      setContactPerson('');
      setEmail('');
      setPhone('');
      setBillingAddress('');
      setShippingAddress('');
      setCity('');
      setState('Madhya Pradesh');
      setStateCode('23');
      setCountry('India');
      setPinCode('');
      setGstin('');
      setPan('');
      setCustomerType('B2B');
      setNotes('');
      setGstinStatus({ isValid: true });
    }
  }, [editingClient, isOpen]);

  const handleGstinChange = (val: string) => {
    const uppercaseVal = val.toUpperCase().trim();
    setGstin(uppercaseVal);

    if (uppercaseVal.length === 15) {
      const validation = validateGSTIN(uppercaseVal);
      setGstinStatus(validation);
      if (validation.isValid && validation.stateCode) {
        setStateCode(validation.stateCode);
        const stateObj = getStateByCode(validation.stateCode);
        if (stateObj) {
          setState(stateObj.name);
        }
        if (validation.pan) {
          setPan(validation.pan);
        }
      }
    } else if (uppercaseVal.length > 0) {
      setGstinStatus({ isValid: false, message: 'GSTIN must be 15 alphanumeric characters' });
    } else {
      setGstinStatus({ isValid: true });
    }
  };

  const handleStateChange = (selectedStateName: string) => {
    setState(selectedStateName);
    const found = INDIAN_STATES.find(s => s.name === selectedStateName);
    if (found) {
      setStateCode(found.code);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Client name is required');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        email: email.trim(),
        phone: phone.trim(),
        billingAddress: billingAddress.trim(),
        shippingAddress: (shippingAddress || billingAddress).trim(),
        city: city.trim(),
        state: state || 'Madhya Pradesh',
        stateCode: stateCode || '23',
        country: country || 'India',
        pinCode: pinCode.trim(),
        gstin: gstin.trim().toUpperCase(),
        pan: pan.trim().toUpperCase(),
        customerType: customerType || 'B2B',
        notes: notes.trim()
      });
      onClose();
    } catch (err: any) {
      console.error('Error saving client:', err);
      toast.error(err.message || 'Failed to save client');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-8 overflow-hidden border border-slate-200">
        <div className="bg-gradient-to-r from-indigo-900 to-indigo-950 px-6 py-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-300" />
            <div>
              <h2 className="text-lg font-bold">{editingClient ? 'Edit Client' : 'Add New Client / Customer'}</h2>
              <p className="text-xs text-indigo-200">Customer profile &amp; billing details</p>
            </div>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white p-1 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Quick GSTIN Auto-fill Bar */}
          <div className="bg-indigo-50/70 p-3 rounded-xl border border-indigo-100 space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-indigo-950">GSTIN (15 Digits - Optional)</label>
              <span className="text-[11px] text-indigo-600 font-medium">Auto-fills PAN &amp; State</span>
            </div>
            <input
              type="text"
              maxLength={15}
              placeholder="e.g. 23AHWPH3168H2Z2 (Leave blank if unregistered)"
              value={gstin}
              onChange={(e) => handleGstinChange(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-lg text-slate-900 text-xs font-mono font-bold uppercase tracking-wider focus:ring-2 focus:ring-indigo-600 outline-hidden"
            />
            {gstin && (
              <p className={`text-[11px] flex items-center gap-1 ${gstinStatus.isValid ? 'text-emerald-700' : 'text-amber-700'}`}>
                {gstinStatus.isValid ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {gstinStatus.message || (gstinStatus.isValid ? `Valid GSTIN (${state || 'State Detected'})` : 'Invalid format')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Client / Company Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. RADICAL FABROTECH"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs font-semibold focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Type</label>
              <select
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as any)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              >
                <option value="B2B">B2B (Registered Business)</option>
                <option value="B2C">B2C (Consumer / Unregistered)</option>
                <option value="SEZ">SEZ (Special Economic Zone)</option>
                <option value="Export">Export</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
              <input
                type="text"
                placeholder="e.g. Rajesh Sharma"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
              <input
                type="text"
                placeholder="+91 98220 12345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="billing@client.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">PAN Number</label>
              <input
                type="text"
                maxLength={10}
                placeholder="e.g. AHWPH3168H"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-mono uppercase focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                State / Place of Supply <span className="text-rose-500">*</span>
              </label>
              <select
                value={state}
                onChange={(e) => handleStateChange(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Address</label>
              <textarea
                rows={2}
                placeholder="Street address, building, industrial area..."
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
              <input
                type="text"
                placeholder="e.g. Indore / Pune"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">PIN Code</label>
              <input
                type="text"
                maxLength={6}
                placeholder="e.g. 452010"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.trim())}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Internal Notes</label>
              <input
                type="text"
                placeholder="Client specific notes, payment terms, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-indigo-600 outline-hidden"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-900 hover:bg-indigo-800 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {isSaving ? 'Saving...' : editingClient ? 'Update Client' : 'Add Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
