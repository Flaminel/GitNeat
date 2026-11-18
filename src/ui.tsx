import React, { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { gitneat, MenuSpec } from "./api";

export interface Field {
  name: string;
  label: string;
  help?: string;
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
  choices?: Choice[];
  resolve: (values: Record<string, string> | null) => void;
}

interface Toast {
  id: number;
  title?: string;
  text: string;
  kind: "error" | "info";
}

export interface Choice {
  label: string;
  value: string;
  danger?: boolean;
}

export interface Ui {
  prompt(title: string, fields: Field[], ok?: string): Promise<Record<string, string> | null>;
  confirm(title: string, message: string, ok?: string, danger?: boolean): Promise<boolean>;
  choose(message: string, choices: Choice[], fields?: Field[]): Promise<Record<string, string> | null>;
  toast(text: string, kind?: "error" | "info", title?: string): void;
  task(label: string, fn: () => Promise<unknown>, title?: string): Promise<boolean>;
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

  const toast = useCallback((text: string, kind: "error" | "info" = "info", title?: string) => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, title, text, kind }]);
    if (kind === "info") {
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
    }
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

  const choose = useCallback(
    (message: string, choices: Choice[], fields: Field[] = []) =>
      new Promise<Record<string, string> | null>((resolve) => setDialog({ title: "", message, fields, ok: "", choices, resolve })),
    [],
  );

  const task = useCallback(
    async (label: string, fn: () => Promise<unknown>, title = `${label} Failed`) => {
      setBusy(label);
      try {
        await fn();
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error", title);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const ui = useMemo(() => ({ prompt, confirm, choose, toast, task, busy }), [prompt, confirm, choose, toast, task, busy]);

  return (
    <UiContext.Provider value={ui}>
      {children}
      {dialog && <Dialog request={dialog} close={() => setDialog(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} close={() => setToasts((l) => l.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </UiContext.Provider>
  );
}

const LONG_TOAST = 240;

function ToastView({ toast, close }: { toast: Toast; close: () => void }) {
  const [open, setOpen] = useState(false);
  const long = toast.text.length > LONG_TOAST || toast.text.split("\n").length > 4;
  if (toast.kind === "info") {
    return (
      <div className="toast info" onClick={close}>
        {toast.text}
      </div>
    );
  }
  return (
    <div className="toast error">
      <div className="toast-head">
        <strong>{toast.title ?? "Error"}</strong>
        <button className="toast-button" onClick={close}>
          Close
        </button>
      </div>
      <div className={open || !long ? "toast-text" : "toast-text clamped"}>{toast.text}</div>
      <div className="toast-actions">
        <button className="toast-button" onClick={() => void navigator.clipboard?.writeText(toast.text)}>
          Copy
        </button>
        {long && (
          <button className="toast-button" onClick={() => setOpen(!open)}>
            {open ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
    </div>
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
        {request.title && <h3>{request.title}</h3>}
        {request.message && <p className="modal-message">{request.message}</p>}
        {request.fields.map((field, i) => (
          <label key={field.name} className={field.kind === "checkbox" ? "check" : "field"}>
            {field.kind !== "checkbox" && <span>{field.label}</span>}
            {field.kind !== "checkbox" && field.help && <small className="field-help">{field.help}</small>}
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
          {request.choices ? (
            request.choices.map((c) => (
              <button key={c.value} type="button" className={c.danger ? "danger" : "primary"} onClick={() => finish({ ...values, choice: c.value })}>
                {c.label}
              </button>
            ))
          ) : (
            <button type="submit" className={request.danger ? "danger" : "primary"} autoFocus={request.fields.length === 0}>
              {request.ok}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export type Layout = Record<string, number | boolean | string>;

interface LayoutStore {
  layout: Layout;
  set(key: string, value: number | boolean | string): void;
}

export const LayoutContext = createContext<LayoutStore>({ layout: {}, set: () => undefined });

const LEGACY_DIFF: Record<string, string> = {
  "gitneat.diffMode": "diff.mode",
  "gitneat.diffIgnoreWhitespace": "diff.ignoreWhitespace",
  "gitneat.diffWordWrap": "diff.wordWrap",
};

export function legacyLayout(): Layout {
  const out: Layout = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const value = localStorage.getItem(key) ?? "";
      if (key.startsWith("gitneat.width.") && Number(value) > 0) {
        out[key.slice("gitneat.width.".length)] = Number(value);
      } else if (key.startsWith("gitneat.flag.")) {
        out[key.slice("gitneat.flag.".length)] = value === "1";
      } else if (key === "gitneat.diffMode") {
        out[LEGACY_DIFF[key]] = value;
      } else if (LEGACY_DIFF[key]) {
        out[LEGACY_DIFF[key]] = value === "true";
      }
    }
  } catch {
    return out;
  }
  return out;
}

export function useStored<T extends number | boolean | string>(key: string, initial: T, valid: (v: unknown) => boolean = (v) => typeof v === typeof initial): [T, (v: T, save?: boolean) => void] {
  const { layout, set: store } = useContext(LayoutContext);
  const [value, setValue] = useState<T>(() => (valid(layout[key]) ? (layout[key] as T) : initial));
  const set = useCallback(
    (v: T, save = true) => {
      setValue(v);
      if (save) {
        store(key, v);
      }
    },
    [key, store],
  );
  return [value, set];
}

export function useStoredWidth(key: string, initial: number): [number, (n: number, save?: boolean) => void] {
  const [value, set] = useStored(key, initial, (v) => typeof v === "number" && v > 0);
  return [value, useCallback((n: number, save?: boolean) => set(Math.round(n), save), [set])];
}

export const useStoredFlag = (key: string, initial: boolean): [boolean, (b: boolean) => void] => useStored<boolean>(key, initial);

export function Splitter(props: {
  value: number;
  set(n: number, save?: boolean): void;
  min: number;
  max: number;
  invert?: boolean;
  vertical?: boolean;
  className?: string;
}) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = (ev: MouseEvent | React.MouseEvent) => (props.vertical ? ev.clientY : ev.clientX);
    const x0 = pos(e);
    const w0 = props.value;
    let last = w0;
    const mode = props.vertical ? "resizing-row" : "resizing";
    const move = (ev: MouseEvent) => {
      const dx = (pos(ev) - x0) * (props.invert ? -1 : 1);
      last = Math.max(props.min, Math.min(props.max, w0 + dx));
      props.set(last, false);
    };
    const up = () => {
      if (last !== w0) {
        props.set(last);
      }
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove(mode);
    };
    document.body.classList.add(mode);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className={`splitter${props.vertical ? " row-resize" : ""} ${props.className ?? ""}`} onMouseDown={start} />;
}
