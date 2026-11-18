import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitneat } from "./api";
import { NewTab } from "./components/NewTab";
import { repoName, Tab, Tabs } from "./components/Tabs";
import { cloneRepo, initRepo } from "./actions";
import { samePath } from "./repo";
import { forgetRepos, RepoPrefs, RepoView } from "./RepoView";
import { Layout, LayoutContext, legacyLayout, useUi } from "./ui";
import pkg from "../package.json";

interface State {
  tabs: Tab[];
  active: number;
  recent: string[];
  favorites: string[];
  aliases: Record<string, string>;
  closed: Tab[];
  prefs: Record<string, RepoPrefs>;
  layout: Layout;
}

const EMPTY: State = { tabs: [], active: 0, recent: [], favorites: [], aliases: {}, closed: [], prefs: {}, layout: {} };
const NO_PREFS: RepoPrefs = { hidden: [], solo: [] };
const NEW_TAB: Tab = {};
const RECENT_LIMIT = 100;
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
const SUPPORT_URL = "https://github.com/Flaminel/GitNeat";

function pressKey(code: string, shiftKey = false) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code, shiftKey, metaKey: true, ctrlKey: true, bubbles: true }));
}

function StatusBar({ zoom }: { zoom: number }) {
  return (
    <div className="statusbar">
      <span className="statusbar-fill" />
      <span title="Zoom (Cmd/Ctrl + and Cmd/Ctrl -)">{Math.round(zoom * 100)}%</span>
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
        for (const t of s.tabs as (Tab & { title?: string })[]) {
          if (t.path && t.title) {
            s.aliases = { ...s.aliases, [t.path]: t.title };
          }
          delete t.title;
        }
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
        const recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, RECENT_LIMIT);
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

  const toggleFavorite = (path: string) =>
    update((s) => ({ ...s, favorites: s.favorites.includes(path) ? s.favorites.filter((p) => p !== path) : [...s.favorites, path] }));

  const renameRepo = async (path: string) => {
    const v = await ui.prompt("Rename repository", [{ name: "alias", label: "Alias", value: state?.aliases[path] ?? repoName(path) }], "Save alias");
    if (!v) {
      return;
    }
    const alias = v.alias.trim();
    update((s) => {
      const { [path]: _, ...rest } = s.aliases;
      return { ...s, aliases: alias && alias !== repoName(path) ? { ...rest, [path]: alias } : rest };
    });
  };

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

  const zoom = typeof state?.layout.zoom === "number" ? state.layout.zoom : 1;
  useEffect(() => {
    void gitneat().setZoom(zoom);
  }, [zoom]);

  const stepZoom = (step: number) =>
    update((s) => {
      const current = typeof s.layout.zoom === "number" ? s.layout.zoom : 1;
      const index = Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(current) + step));
      return { ...s, layout: { ...s.layout, zoom: ZOOMS[index] } };
    });

  const selectTab = (step: number) =>
    update((s) => ({ ...s, active: (s.active + step + s.tabs.length) % Math.max(1, s.tabs.length) }));

  const runMenu = (id: string) => {
    if (!state) {
      return;
    }
    const [name, index] = id.split(":");
    const path = state.tabs[state.active]?.path;
    const actions: Record<string, () => unknown> = {
      "new-tab": newTab,
      "close-tab": () => state.tabs.length && closeTabs((i) => i !== state.active),
      "reopen-tab": reopen,
      clone: clone,
      init: init,
      open: openDialog,
      terminal: () => path && gitneat().openTerminal(path),
      "file-manager": () => path && gitneat().openPath(path),
      undo: () => pressKey("KeyZ"),
      redo: () => pressKey("KeyZ", true),
      "left-panel": () => pressKey("KeyJ"),
      "zoom-in": () => stepZoom(1),
      "zoom-out": () => stepZoom(-1),
      "zoom-reset": () => update((s) => ({ ...s, layout: { ...s.layout, zoom: 1 } })),
      "next-tab": () => selectTab(1),
      "previous-tab": () => selectTab(-1),
      tab: () => update((s) => ({ ...s, active: Math.min(Number(index) - 1, s.tabs.length - 1) })),
      favorite: () => state.favorites[Number(index) - 1] && openTab(state.favorites[Number(index) - 1]),
      "support-docs": () => gitneat().openExternal(SUPPORT_URL),
    };
    void actions[name]?.();
  };

  const menuHandler = useRef(runMenu);
  menuHandler.current = runMenu;
  useEffect(() => gitneat().onAppMenu((id) => menuHandler.current(id)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) {
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        selectTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) {
        return;
      }
      const key = e.key.toLowerCase();
      let id = "";
      if (key === "t") {
        id = e.shiftKey ? "reopen-tab" : "new-tab";
      } else if (key === "w" && state.tabs.length) {
        id = "close-tab";
      } else if (/^[1-9]$/.test(key)) {
        id = `tab:${key}`;
      } else if (key === "=" || key === "+") {
        id = "zoom-in";
      } else if (key === "-") {
        id = "zoom-out";
      } else if (key === "0") {
        id = "zoom-reset";
      }
      if (id) {
        e.preventDefault();
        runMenu(id);
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
          aliases={state.aliases}
          favorites={state.favorites}
          onRename={(i) => void renameRepo(state.tabs[i].path!)}
          onFavorite={(i) => toggleFavorite(state.tabs[i].path!)}
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
              const { openSections, sectionYsByKey } = state.prefs[main] ?? {};
              return openSections ? { openSections, sectionYsByKey } : undefined;
            }}
            openTab={openTab}
            recent={state.recent}
            favorites={state.favorites}
            aliases={state.aliases}
            onViewAll={newTab}
          />
        ) : (
          <NewTab
            recent={state.recent}
            favorites={state.favorites}
            aliases={state.aliases}
            onOpen={openTab}
            onOpenDialog={openDialog}
            onClone={clone}
            onInit={init}
            onFavorite={toggleFavorite}
            onAlias={(p) => void renameRepo(p)}
            onRemoveRecent={(p) => update((s) => ({ ...s, recent: s.recent.filter((r) => r !== p) }))}
            onRemoveAllRecent={() => update((s) => ({ ...s, recent: [] }))}
          />
        )}
        <StatusBar zoom={zoom} />
      </div>
    </LayoutContext.Provider>
  );
}
