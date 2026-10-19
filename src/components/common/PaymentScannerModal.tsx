import React, { useState } from 'react';
import { X, Copy, Check, Download, QrCode, ShieldCheck } from 'lucide-react';
import { toast } from './Toast';

interface PaymentScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentScannerModal: React.FC<PaymentScannerModalProps> = ({
  isOpen,
  onClose
}) => {
  const [copied, setCopied] = useState(false);
  const upiId = 'brewstack243668@aubiz';
  const payeeName = 'BREWSTACK24';

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    toast.success('UPI ID copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = '/upi-qr.png';
    link.download = `BREWSTACK24-UPI-Scanner.png`;
    link.click();
    toast.success('Scanner image download started');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-200 relative my-6">
        {/* Modal Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
          title="Close scanner"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scanner Card Body matching official AU / Merchant Stand */}
        <div className="p-6 text-center space-y-4">
          {/* Header Info */}
          <div className="flex items-center gap-3 text-left pt-1">
            <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-[#e3521b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <line x1="7" y1="8" x2="11" y2="8" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="7" y1="16" x2="15" y2="16" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-extrabold text-slate-900 tracking-wide uppercase truncate">
                {payeeName}
              </h3>
              <p className="text-xs font-semibold text-[#3b3886] underline font-mono truncate">
                {upiId}
              </p>
            </div>
          </div>

          <div className="h-px bg-slate-100 w-full" />

          {/* QR Code Container */}
          <div className="relative mx-auto w-64 h-64 bg-white p-2 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-center">
            <img
              src="/upi-qr.png"
              alt="BREWSTACK24 UPI QR Scanner"
              className="w-full h-full object-contain rounded-xl"
            />
          </div>

          {/* Supported Apps Strip */}
          <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
            <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full text-[10px] font-extrabold text-[#00b9f5]">
              Paytm
            </span>
            <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full text-[10px] font-bold text-slate-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              GPay
            </span>
            <span className="w-6 h-6 rounded-full bg-[#5f259f] text-white text-[11px] font-bold flex items-center justify-center">
              पे
            </span>
            <span className="w-6 h-6 rounded-full bg-[#ff7a00] text-white text-[10px] font-bold flex items-center justify-center">
              ⚡
            </span>
            <span className="px-2 py-0.5 bg-[#e3521b] text-white rounded-full text-[9px] font-black">
              AU
            </span>
            <span className="text-[10px] font-bold text-[#5f259f]">
              30+ Apps
            </span>
          </div>

          {/* Scan Prompt */}
          <div className="space-y-0.5">
            <p className="text-xs text-slate-500 font-medium">
              Scan this QR from any app to pay to
            </p>
            <p className="text-sm font-extrabold text-slate-900 tracking-wide">
              {payeeName}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={handleCopy}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy UPI ID'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="w-full py-2 px-3 bg-teal-800 hover:bg-teal-900 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
