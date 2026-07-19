'use client';

import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Minimal toast system in the glass style — carries the role of
 * `TransactionErrorToast` (README §11.3): backend `ApiError` codes are mapped to
 * specific copy by the caller, and this renders whatever it is given.
 */

interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
}

interface ToastState {
  toast: (kind: Toast['kind'], message: string) => void;
}

const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
          >
            <span
              className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                t.kind === 'error'
                  ? 'bg-red-400'
                  : t.kind === 'success'
                    ? 'bg-green-400'
                    : 'bg-white/80'
              }`}
            />
            <p className="text-sm text-white/90 flex-1">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="text-white/50 hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}
