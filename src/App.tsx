import { useCallback, useEffect, useRef, useState } from "react";
import { gitneat } from "./api";
import { Tab, Tabs, tabTitle } from "./components/Tabs";
import { cloneRepo, initRepo } from "./actions";
import { samePath } from "./repo";
import { RepoPrefs, RepoView } from "./RepoView";
import { useUi } from "./ui";
import pkg from "../package.json";

interface State {
  tabs: Tab[];
  active: number;
  recent: string[];
  closed: Tab[];
  prefs: Record<string, RepoPrefs>;
}

const EMPTY: State = { tabs: [], active: 0, recent: [], closed: [], prefs: {} };
const NO_PREFS: RepoPrefs = { hidden: [], solo: [] };

function StatusBar() {
  const [base] = useState(() => window.devicePixelRatio);
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const onResize = () => setZoom(Math.round((window.devicePixelRatio / base) * 100));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [base]);
  return (
    <div className="statusbar">
      <span className="statusbar-fill" />
      <span title="Zoom (Cmd/Ctrl + and Cmd/Ctrl -)">{zoom}%</span>
      <span className="statusbar-version">{pkg.version}</span>
    </div>
  );
}

export function App() {
  const ui = useUi();
  const [state, setState] = useState<State | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    gitneat()
      .storeGet()
      .then((saved) => {
        loaded.current = true;
        setState({ ...EMPTY, ...(saved as Partial<State>) });
      });
  }, []);

  useEffect(() => {
    if (loaded.current && state) {
      void gitneat().storeSet(state);
    }
  }, [state]);

  const update = useCallback((fn: (s: State) => State) => setState((s) => (s ? fn(s) : s)), []);

  const openTab = useCallback(
    (path: string) =>
      update((s) => {
        const existing = s.tabs.findIndex((t) => samePath(t.path, path));
        const recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, 20);
        if (existing >= 0) {
          return { ...s, active: existing, recent };
        }
        return { ...s, tabs: [...s.tabs, { path }], active: s.tabs.length, recent };
      }),
    [update],
  );

  const openDialog = useCallback(async () => {
    const result = await gitneat().openRepoDialog();
    if (typeof result === "string") {
      openTab(result);
    } else if (result) {
      ui.toast(result.error, "error");
    }
  }, [openTab, ui]);

  const closeTabs = (keep: (i: number) => boolean) =>
    update((s) => {
      const closed = s.tabs.filter((_, i) => !keep(i));
      const tabs = s.tabs.filter((_, i) => keep(i));
      const activePath = s.tabs[s.active]?.path;
      const active = Math.max(0, tabs.findIndex((t) => t.path === activePath));
      return { ...s, tabs, active: Math.min(active, Math.max(0, tabs.length - 1)), closed: [...closed, ...s.closed].slice(0, 20) };
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !state) {
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        void openDialog();
      } else if (e.key === "w" && state.tabs.length) {
        e.preventDefault();
        closeTabs((i) => i !== state.active);
      } else if (e.key === "T" || (e.key === "t" && e.shiftKey)) {
        e.preventDefault();
        reopen();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        update((s) => ({ ...s, active: Math.min(Number(e.key) - 1, s.tabs.length - 1) }));
      } else if (e.key === "Tab") {
        e.preventDefault();
        update((s) => ({ ...s, active: (s.active + (e.shiftKey ? s.tabs.length - 1 : 1)) % Math.max(1, s.tabs.length) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reopen = () =>
    update((s) => {
      const [tab, ...rest] = s.closed;
      if (!tab) {
        return s;
      }
      return { ...s, tabs: [...s.tabs, tab], active: s.tabs.length, closed: rest };
    });

  const clone = async () => {
    const v = await ui.prompt("Clone a repository", [{ name: "url", label: "Repository URL", placeholder: "https://github.com/owner/repo.git" }], "Choose folder");
    if (!v?.url.trim()) {
      return;
    }
    const parent = await gitneat().pickDirectory();
    if (!parent) {
      return;
    }
    const name = v.url.trim().replace(/\/$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "") || "repo";
    const target = `${parent}/${name}`;
    if (await ui.task(`Clone ${name}`, () => cloneRepo(parent, v.url.trim(), target))) {
      openTab(target);
    }
  };

  const init = async () => {
    const dir = await gitneat().pickDirectory();
    if (dir && (await ui.task("Init", () => initRepo(dir)))) {
      openTab(dir);
    }
  };

  if (!state) {
    return null;
  }

  const activeTab = state.tabs[state.active];
  return (
    <div className="app">
      <Tabs
        tabs={state.tabs}
        active={state.active}
        canReopen={state.closed.length > 0}
        onActivate={(i) => update((s) => ({ ...s, active: i }))}
        onClose={(i) => closeTabs((j) => j !== i)}
        onCloseOthers={(i) => closeTabs((j) => j === i)}
        onCloseRight={(i) => closeTabs((j) => j <= i)}
        onRename={async (i) => {
          const v = await ui.prompt("Rename tab", [{ name: "title", label: "Tab name", value: tabTitle(state.tabs[i]) }], "Rename");
          if (v) {
            update((s) => ({ ...s, tabs: s.tabs.map((t, j) => (j === i ? { ...t, title: v.title.trim() || undefined } : t)) }));
          }
        }}
        onReopen={reopen}
        onMove={(from, to) =>
          update((s) => {
            const tabs = [...s.tabs];
            const [moved] = tabs.splice(from, 1);
            tabs.splice(to, 0, moved);
            return { ...s, tabs, active: to };
          })
        }
        onNew={openDialog}
      />
      {activeTab ? (
        <RepoView
          key={activeTab.path}
          path={activeTab.path}
          prefs={state.prefs[activeTab.path] ?? NO_PREFS}
          setPrefs={(prefs) => update((s) => ({ ...s, prefs: { ...s.prefs, [activeTab.path]: prefs } }))}
          openTab={openTab}
          recent={state.recent}
        />
      ) : (
        <div className="welcome">
          <h1>GitNeat</h1>
          <div className="welcome-actions">
            <button className="primary" onClick={openDialog}>
              Open a repository
            </button>
            <button onClick={clone}>Clone a repository</button>
            <button onClick={init}>Start a local repository</button>
          </div>
          {state.recent.length > 0 && (
            <div className="recent">
              <h4>Recent repositories</h4>
              {state.recent.map((p) => (
                <a key={p} onClick={() => openTab(p)}>
                  <b>{p.split(/[\\/]/).pop()}</b> <span>{p}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      <StatusBar />
    </div>
  );
}
