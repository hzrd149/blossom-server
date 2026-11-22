import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

function Toast({ message, dismiss }: { message: string; dismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(dismiss, 5000);
    return () => clearTimeout(timer);
  }, [dismiss]);
  return (
    <div className="alert alert-success shadow-lg pointer-events-auto">
      <span className="min-w-0 break-words">{message}</span>
      <button
        type="button"
        className="btn btn-ghost btn-square"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [items, setItems] = useState<
    { id: number; message: string; dismiss: () => void }[]
  >([]);
  const notify = useCallback((message: string) => {
    const id = nextId.current++;
    const dismiss = () =>
      setItems((current) => current.filter((item) => item.id !== id));
    setItems((current) => [...current.slice(-2), { id, message, dismiss }]);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 pointer-events-none"
      >
        {items.map((item) => (
          <Toast key={item.id} message={item.message} dismiss={item.dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
