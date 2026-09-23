import React, { useState } from 'react';
import { CustomerOnboarding } from '../../types';
import { X, Target, Plus, CheckCircle2, TrendingUp } from 'lucide-react';
import { calculateAdBudgetStats } from '../../constants/services';

interface TopupAdsModalProps {
  onboarding: CustomerOnboarding;
  onClose: () => void;
  onSuccess: (updated: CustomerOnboarding) => void;
  onTopupAds: (id: string, topupData: any) => Promise<CustomerOnboarding>;
}

export const TopupAdsModal: React.FC<TopupAdsModalProps> = ({
  onboarding,
  onClose,
  onSuccess,
  onTopupAds
}) => {
  const [platform, setPlatform] = useState<'meta' | 'google' | 'both'>((onboarding.adPlatform as any) || 'meta');
  const [dailyBudget, setDailyBudget] = useState<number>(onboarding.adDailyBudget || 200);
  const [durationDays, setDurationDays] = useState<number>(15);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const stats = calculateAdBudgetStats(platform === 'both' ? 'meta' : platform, dailyBudget, durationDays);
  const formatINR = (val: number) => '₹' + Math.round(val || 0).toLocaleString('en-IN');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dailyBudget <= 0 || durationDays <= 0) {
      setError('Please provide valid daily budget and duration.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const updated = await onTopupAds(onboarding.id, {
        dailyBudget: Number(dailyBudget),
        durationDays: Number(durationDays),
        platform
      });
      onSuccess(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to top-up ad budget');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-violet-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 text-white rounded-lg">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Top-up &amp; Extend Ads Campaign</h3>
              <p className="text-[11px] text-violet-200">{onboarding.businessName} ({onboarding.customerName})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-violet-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Ad Status */}
        <div className="p-4 bg-violet-50/60 border-b border-violet-100 flex items-center justify-between text-xs">
          <div>
            <span className="text-slate-500 block">Current Ad Budget:</span>
            <span className="font-mono font-bold text-slate-900">{formatINR(onboarding.adTotalBudget)}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Current Status:</span>
            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
              onboarding.isAdExpired 
                ? 'bg-rose-100 text-rose-800' 
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              {onboarding.isAdExpired ? '🔴 Budget Expired' : '🟢 Campaign Active'}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs">
              {error}
            </div>
          )}

          {/* Platform Selector */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Select Ad Platform:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPlatform('meta')}
                className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all text-center ${
                  platform === 'meta'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                📱 Meta Ads (FB/IG)
              </button>
              <button
                type="button"
                onClick={() => setPlatform('google')}
                className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all text-center ${
                  platform === 'google'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                🔎 Google Ads
              </button>
              <button
                type="button"
                onClick={() => setPlatform('both')}
                className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all text-center ${
                  platform === 'both'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                🚀 Meta + Google
              </button>
            </div>
          </div>

          {/* Daily Budget & Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center mb-1">
                <label className="font-bold text-slate-700">Daily Budget:</label>
                <span className="font-mono font-bold text-violet-700">₹{dailyBudget}/day</span>
              </div>
              <input
                type="number"
                min={100}
                step={50}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold font-mono outline-hidden focus:border-violet-600 mb-2"
                placeholder="200"
              />
              <div className="flex flex-wrap gap-1">
                {[200, 300, 500, 1000, 2000].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setDailyBudget(amt)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all ${
                      dailyBudget === amt
                        ? 'bg-violet-600 text-white font-bold'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-violet-50'
                    }`}
                  >
                    ₹{amt}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center mb-1">
                <label className="font-bold text-slate-700">Duration:</label>
                <span className="font-mono font-bold text-violet-700">{durationDays} Days</span>
              </div>
              <input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold font-mono outline-hidden focus:border-violet-600 mb-2"
                placeholder="15"
              />
              <div className="flex flex-wrap gap-1">
                {[7, 15, 30, 45, 60].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationDays(d)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all ${
                      durationDays === d
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

          {/* Outcome Forecast */}
          <div className="p-3 bg-violet-50 rounded-xl border border-violet-200 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-600 font-medium">New Ad Budget to Add:</span>
              <span className="font-mono font-extrabold text-sm text-violet-950">
                ₹{dailyBudget} × {durationDays}d = <span className="text-indigo-600">{formatINR(stats.totalBudget)}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-violet-900">
              <TrendingUp className="w-3.5 h-3.5 text-violet-600 shrink-0" />
              <span>Projected Lead Output: <strong>{stats.totalMinLeads}–{stats.totalMaxLeads} leads</strong> across {durationDays} days.</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Top-up in progress...' : `Confirm Ad Top-up (${formatINR(stats.totalBudget)})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
