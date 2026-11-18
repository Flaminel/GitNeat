import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitneat } from "./api";
import { NewTab } from "./components/NewTab";
import { Tab, Tabs, tabTitle } from "./components/Tabs";
import { cloneRepo, initRepo } from "./actions";
import { samePath } from "./repo";
import { forgetRepos, RepoPrefs, RepoView } from "./RepoView";
import { Layout, LayoutContext, legacyLayout, useUi } from "./ui";
import pkg from "../package.json";

interface State {
  tabs: Tab[];
  active: number;
  recent: string[];
  closed: Tab[];
  prefs: Record<string, RepoPrefs>;
  layout: Layout;
}

const EMPTY: State = { tabs: [], active: 0, recent: [], closed: [], prefs: {}, layout: {} };
const NO_PREFS: RepoPrefs = { hidden: [], solo: [] };
const NEW_TAB: Tab = {};

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
        const s = { ...EMPTY, ...(saved as Partial<State>) };
        if (!(saved as Partial<State>).layout) {
          s.layout = legacyLayout();
        }
        setState(s.tabs.length ? s : { ...s, tabs: [NEW_TAB], active: 0 });
      });
  }, []);

  useEffect(() => {
    if (loaded.current && state) {
      void gitneat().storeSet(state);
    }
  }, [state]);

  const update = useCallback((fn: (s: State) => State) => setState((s) => (s ? fn(s) : s)), []);

  const layout = state?.layout;
  const setLayout = useCallback(
    (key: string, value: number | boolean | string) => update((s) => ({ ...s, layout: { ...s.layout, [key]: value } })),
    [update],
  );
  const layoutStore = useMemo(() => ({ layout: layout ?? {}, set: setLayout }), [layout, setLayout]);

  const openTab = useCallback(
    (path: string) =>
      update((s) => {
        const existing = s.tabs.findIndex((t) => !!t.path && samePath(t.path, path));
        const recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, 20);
        if (existing >= 0) {
          return { ...s, active: existing, recent };
        }
        if (s.tabs[s.active] && !s.tabs[s.active].path) {
          return { ...s, tabs: s.tabs.map((t, i) => (i === s.active ? { path } : t)), recent };
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

  const newTab = () => update((s) => ({ ...s, tabs: [...s.tabs, NEW_TAB], active: s.tabs.length }));

  const closeTabs = (keep: (i: number) => boolean) =>
    update((s) => {
      const closed = s.tabs.filter((t, i) => !keep(i) && t.path);
      const tabs = s.tabs.filter((_, i) => keep(i));
      if (!tabs.length) {
        return { ...s, tabs: [NEW_TAB], active: 0, closed: [...closed, ...s.closed].slice(0, 20) };
      }
      const before = s.tabs.filter((_, i) => i < s.active && keep(i)).length;
      return { ...s, tabs, active: Math.min(before, tabs.length - 1), closed: [...closed, ...s.closed].slice(0, 20) };
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) {
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        update((s) => ({ ...s, active: (s.active + (e.shiftKey ? s.tabs.length - 1 : 1)) % Math.max(1, s.tabs.length) }));
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        newTab();
      } else if (e.key === "w" && state.tabs.length) {
        e.preventDefault();
        closeTabs((i) => i !== state.active);
      } else if (e.key === "T" || (e.key === "t" && e.shiftKey)) {
        e.preventDefault();
        reopen();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        update((s) => ({ ...s, active: Math.min(Number(e.key) - 1, s.tabs.length - 1) }));
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

  const tabs = state?.tabs;
  useEffect(() => {
    if (tabs) {
      forgetRepos(tabs.flatMap((t) => (t.path ? [t.path] : [])));
    }
  }, [tabs]);

  if (!state) {
    return null;
  }

  const activePath = state.tabs[state.active]?.path;
  return (
    <LayoutContext.Provider value={layoutStore}>
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
          onNew={newTab}
        />
        {activePath ? (
          <RepoView
            key={activePath}
            path={activePath}
            prefs={state.prefs[activePath] ?? NO_PREFS}
            setPrefs={(prefs) => update((s) => ({ ...s, prefs: { ...s.prefs, [activePath]: { ...(s.prefs[activePath] ?? NO_PREFS), ...prefs } } }))}
            mainSections={(main) => {
              const { openSections, sectionHeights } = state.prefs[main] ?? {};
              return openSections ? { openSections, sectionHeights } : undefined;
            }}
            openTab={openTab}
            recent={state.recent}
          />
        ) : (
          <NewTab recent={state.recent} onOpen={openTab} onOpenDialog={openDialog} onClone={clone} onInit={init} />
        )}
        <StatusBar />
      </div>
    </LayoutContext.Provider>
  );
}
