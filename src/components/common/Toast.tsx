import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmItem {
  id: string;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface PromptItem {
  id: string;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (val: string) => void;
  onCancel?: () => void;
}

type Listener<T> = (items: T) => void;

let toasts: ToastItem[] = [];
const toastListeners = new Set<Listener<ToastItem[]>>();

let activeConfirm: ConfirmItem | null = null;
const confirmListeners = new Set<Listener<ConfirmItem | null>>();

let activePrompt: PromptItem | null = null;
const promptListeners = new Set<Listener<PromptItem | null>>();

export const toast = {
  show: (message: string, type: ToastType = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    toasts = [...toasts, { id, message, type }];
    toastListeners.forEach(fn => fn(toasts));

    setTimeout(() => {
      toasts = toasts.filter(t => t.id !== id);
      toastListeners.forEach(fn => fn(toasts));
    }, 4000);
  },
  success: (message: string) => toast.show(message, 'success'),
  error: (message: string) => toast.show(message, 'error'),
  info: (message: string) => toast.show(message, 'info'),
};

export const showConfirm = (options: {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) => {
  activeConfirm = {
    id: `confirm_${Date.now()}`,
    title: options.title || 'Please Confirm',
    message: options.message,
    confirmText: options.confirmText || 'Confirm',
    cancelText: options.cancelText || 'Cancel',
    isDanger: options.isDanger ?? true,
    onConfirm: options.onConfirm,
    onCancel: options.onCancel
  };
  confirmListeners.forEach(fn => fn(activeConfirm));
};

export const showPrompt = (options: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}) => {
  activePrompt = {
    id: `prompt_${Date.now()}`,
    title: options.title || 'Input Required',
    message: options.message,
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
    confirmText: options.confirmText || 'Submit',
    cancelText: options.cancelText || 'Cancel',
    onConfirm: options.onConfirm,
    onCancel: options.onCancel
  };
  promptListeners.forEach(fn => fn(activePrompt));
};

// Safe fallback for window.alert in iframe environments
if (typeof window !== 'undefined') {
  window.alert = (msg?: any) => {
    toast.info(String(msg ?? ''));
  };
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  const [confirmModal, setConfirmModal] = useState<ConfirmItem | null>(activeConfirm);
  const [promptModal, setPromptModal] = useState<PromptItem | null>(activePrompt);
  const [promptValue, setPromptValue] = useState<string>('');

  useEffect(() => {
    const handleToasts = (newItems: ToastItem[]) => setItems([...newItems]);
    const handleConfirm = (item: ConfirmItem | null) => setConfirmModal(item);
    const handlePrompt = (item: PromptItem | null) => {
      setPromptModal(item);
      if (item) setPromptValue(item.defaultValue || '');
    };

    toastListeners.add(handleToasts);
    confirmListeners.add(handleConfirm);
    promptListeners.add(handlePrompt);

    return () => {
      toastListeners.delete(handleToasts);
      confirmListeners.delete(handleConfirm);
      promptListeners.delete(handlePrompt);
    };
  }, []);

  const closeToast = (id: string) => {
    toasts = toasts.filter(t => t.id !== id);
    toastListeners.forEach(fn => fn(toasts));
  };

  const handleConfirmAction = () => {
    if (confirmModal) {
      const action = confirmModal.onConfirm;
      activeConfirm = null;
      confirmListeners.forEach(fn => fn(null));
      action();
    }
  };

  const handleCancelAction = () => {
    if (confirmModal) {
      const action = confirmModal.onCancel;
      activeConfirm = null;
      confirmListeners.forEach(fn => fn(null));
      if (action) action();
    }
  };

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (promptModal) {
      const action = promptModal.onConfirm;
      const val = promptValue;
      activePrompt = null;
      promptListeners.forEach(fn => fn(null));
      action(val);
    }
  };

  const handlePromptCancel = () => {
    if (promptModal) {
      const action = promptModal.onCancel;
      activePrompt = null;
      promptListeners.forEach(fn => fn(null));
      if (action) action();
    }
  };

  return (
    <>
      {/* Toasts list bottom-right */}
      <div className="fixed bottom-5 right-5 z-[99999] flex flex-col gap-2 max-w-md w-full pointer-events-none px-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-xl border text-sm font-medium transition-all transform animate-in slide-in-from-bottom-2 ${
              item.type === 'success'
                ? 'bg-emerald-900/90 border-emerald-700 text-white'
                : item.type === 'error'
                ? 'bg-rose-900/90 border-rose-700 text-white'
                : 'bg-slate-900/90 border-slate-700 text-white'
            } backdrop-blur-md`}
          >
            {item.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
            {item.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
            {item.type === 'info' && <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />}
            <div className="flex-1 whitespace-pre-line leading-relaxed">{item.message}</div>
            <button
              onClick={() => closeToast(item.id)}
              className="text-white/60 hover:text-white shrink-0 p-0.5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-slate-900 mb-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                confirmModal.isDanger ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold">{confirmModal.title}</h3>
            </div>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelAction}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {confirmModal.cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer ${
                  confirmModal.isDanger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Modal */}
      {promptModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <form
            onSubmit={handlePromptSubmit}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200"
          >
            <h3 className="text-lg font-bold text-slate-900 mb-2">{promptModal.title}</h3>
            <p className="text-slate-600 text-sm mb-4 leading-relaxed">
              {promptModal.message}
            </p>
            <input
              type="text"
              autoFocus
              value={promptValue}
              placeholder={promptModal.placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm mb-6 text-slate-900"
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handlePromptCancel}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {promptModal.cancelText}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
              >
                {promptModal.confirmText}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
