import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Icon from './Icons';

// Lightweight, app-wide toast notifications.
//
//   const toast = useToast();
//   toast.error('Failed to fetch resources');
//   toast.error('Detail…', { title: 'Namespaces' });
//   toast.success('Context switched');
//
// Errors are sticky (no auto-dismiss) since they usually need attention;
// success/info fade after a few seconds. Duplicate messages are coalesced so a
// failing poll doesn't stack dozens of identical toasts.

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const AUTO_DISMISS = { success: 3500, info: 4500, error: 0 }; // 0 = sticky

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    if (!message) return;
    const key = `${type}:${opts.title || ''}:${message}`;
    let id;
    setToasts((list) => {
      // Coalesce an identical, still-visible toast instead of duplicating it.
      const existing = list.find((t) => t.key === key);
      if (existing) {
        id = existing.id;
        return list.map((t) => (t.id === id ? { ...t, count: t.count + 1 } : t));
      }
      id = ++idRef.current;
      return [...list, { id, key, type, message, title: opts.title, count: 1 }];
    });
    const ttl = opts.duration ?? AUTO_DISMISS[type] ?? 4000;
    if (ttl > 0) {
      const timer = setTimeout(() => dismiss(id), ttl);
      timers.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const api = {
    push,
    dismiss,
    error: useCallback((m, o) => push('error', m, o), [push]),
    success: useCallback((m, o) => push('success', m, o), [push]),
    info: useCallback((m, o) => push('info', m, o), [push]),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="alert">
            <span className="toast-icon">
              <Icon name={t.type === 'success' ? 'check' : t.type === 'info' ? 'details' : 'warning'} size={15} />
            </span>
            <div className="toast-body">
              {t.title && <div className="toast-title">{t.title}</div>}
              <div className="toast-msg">{t.message}</div>
            </div>
            {t.count > 1 && <span className="toast-count">×{t.count}</span>}
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
