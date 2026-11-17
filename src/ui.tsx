import React, { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { gitneat, MenuSpec } from "./api";

export interface Field {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  kind?: "text" | "textarea" | "checkbox" | "select";
  options?: string[];
  ref?: boolean;
}

export type MenuItem = "-" | "" | false | null | undefined | { label: string; id?: string; run?: () => unknown; enabled?: boolean; submenu?: MenuItem[] };

type RealItem = Exclude<MenuItem, "" | false | null | undefined>;

function tidy(items: MenuItem[]): RealItem[] {
  const out: RealItem[] = [];
  for (const item of items) {
    if (!item || (item === "-" && (out.length === 0 || out[out.length - 1] === "-"))) {
      continue;
    }
    out.push(item);
  }
  while (out[out.length - 1] === "-") {
    out.pop();
  }
  return out;
}

interface DialogRequest {
  title: string;
  message?: string;
  fields: Field[];
  ok: string;
  danger?: boolean;
  resolve: (values: Record<string, string> | null) => void;
}

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export interface Ui {
  prompt(title: string, fields: Field[], ok?: string): Promise<Record<string, string> | null>;
  confirm(title: string, message: string, ok?: string, danger?: boolean): Promise<boolean>;
  toast(text: string, kind?: "error" | "info"): void;
  task(label: string, fn: () => Promise<unknown>): Promise<boolean>;
  busy: string | null;
}

const UiContext = createContext<Ui | null>(null);

export const useUi = (): Ui => useContext(UiContext) as Ui;

export async function showMenu(items: MenuItem[]): Promise<void> {
  const actions = new Map<string, () => unknown>();
  const toSpec = (list: MenuItem[]): MenuSpec[] =>
    tidy(list).map((item) => {
        if (item === "-") {
          return { type: "separator" };
        }
        const id = item.id ?? String(actions.size + 1);
        if (item.run) {
          actions.set(id, item.run);
        }
        return {
          label: item.label,
          id: item.run ? id : undefined,
          enabled: item.enabled,
          submenu: item.submenu ? toSpec(item.submenu) : undefined,
        };
      });
  const chosen = await gitneat().menu(toSpec(items));
  if (chosen) {
    await actions.get(chosen)?.();
  }
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((text: string, kind: "error" | "info" = "info") => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "error" ? 9000 : 3500);
  }, []);

  const prompt = useCallback(
    (title: string, fields: Field[], ok = "OK") =>
      new Promise<Record<string, string> | null>((resolve) => setDialog({ title, fields, ok, resolve })),
    [],
  );

  const confirm = useCallback(
    (title: string, message: string, ok = "OK", danger = false) =>
      new Promise<boolean>((resolve) =>
        setDialog({ title, message, fields: [], ok, danger, resolve: (v) => resolve(v !== null) }),
      ),
    [],
  );

  const task = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      try {
        await fn();
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const ui = useMemo(() => ({ prompt, confirm, toast, task, busy }), [prompt, confirm, toast, task, busy]);

  return (
    <UiContext.Provider value={ui}>
      {children}
      {dialog && <Dialog request={dialog} close={() => setDialog(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

function Dialog({ request, close }: { request: DialogRequest; close: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.fields.map((f) => [f.name, f.value ?? (f.kind === "select" ? f.options?.[0] ?? "" : "")])),
  );
  const invalid = request.fields.find((f) => f.ref && /^-|\s|\.\.|[~^:?*\[\\]/.test(values[f.name] ?? ""));
  const finish = (result: Record<string, string> | null) => {
    if (result && invalid) {
      return;
    }
    close();
    request.resolve(result);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => finish(null)}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          finish(values);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            finish(null);
          }
        }}
      >
        <h3>{request.title}</h3>
        {request.message && <p className="modal-message">{request.message}</p>}
        {request.fields.map((field, i) => (
          <label key={field.name} className={field.kind === "checkbox" ? "check" : "field"}>
            {field.kind !== "checkbox" && <span>{field.label}</span>}
            {field.kind === "textarea" ? (
              <textarea
                autoFocus={i === 0}
                rows={6}
                value={values[field.name]}
                placeholder={field.placeholder}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              />
            ) : field.kind === "checkbox" ? (
              <>
                <input
                  type="checkbox"
                  checked={values[field.name] === "true"}
                  onChange={(e) => setValues({ ...values, [field.name]: String(e.target.checked) })}
                />
                {field.label}
              </>
            ) : field.kind === "select" ? (
              <select value={values[field.name]} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}>
                {field.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                autoFocus={i === 0}
                value={values[field.name]}
                placeholder={field.placeholder}
                spellCheck={false}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              />
            )}
          </label>
        ))}
        {invalid && <p className="modal-error">{invalid.label} is not a valid git name.</p>}
        <div className="modal-buttons">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className={request.danger ? "danger" : "primary"} autoFocus={request.fields.length === 0}>
            {request.ok}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useStoredWidth(key: string, initial: number): [number, (n: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(`gitneat.width.${key}`));
      return saved > 0 ? saved : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (n: number) => {
      setValue(n);
      try {
        localStorage.setItem(`gitneat.width.${key}`, String(Math.round(n)));
      } catch {
        return;
      }
    },
    [key],
  );
  return [value, set];
}

export function useStoredFlag(key: string, initial: boolean): [boolean, (b: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(`gitneat.flag.${key}`);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (b: boolean) => {
      setValue(b);
      try {
        localStorage.setItem(`gitneat.flag.${key}`, b ? "1" : "0");
      } catch {
        return;
      }
    },
    [key],
  );
  return [value, set];
}

export function Splitter(props: { value: number; set(n: number): void; min: number; max: number; invert?: boolean; className?: string }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = props.value;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - x0) * (props.invert ? -1 : 1);
      props.set(Math.max(props.min, Math.min(props.max, w0 + dx)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className={`splitter ${props.className ?? ""}`} onMouseDown={start} />;
}
