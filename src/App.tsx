import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskpassReply, AskpassRequest, gitneat } from "./api";
import { NewTab } from "./components/NewTab";
import { repoName, Tab, Tabs } from "./components/Tabs";
import { cloneRepo, initRepo } from "./actions";
import { samePath } from "./repo";
import { AUTO_FETCH_MAX, DEFAULT_SETTINGS, forgetRepos, MAX_COMMITS_MIN, RepoPrefs, RepoView, Settings } from "./RepoView";
import { Palette } from "./components/Palette";
import { Domain, EMPTY_FRECENCY, parseFrecency } from "./palette";
import { AppApi } from "./paletteCommands";
import { Field, Layout, LayoutContext, legacyLayout, Ui, useUi } from "./ui";
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
  settings: Settings;
}

const EMPTY: State = { tabs: [], active: 0, recent: [], favorites: [], aliases: {}, closed: [], prefs: {}, layout: {}, settings: DEFAULT_SETTINGS };
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

const REMEMBER: Field = { name: "remember", label: "Remember me", kind: "checkbox" };

async function askCredentials(ui: Ui, request: AskpassRequest): Promise<AskpassReply | null> {
  const { kind, target, user, retry } = request;
  const password: Field = { name: "password", label: "Password", kind: "password" };
  const invalid = `Invalid credentials for ${target}. Please try again: `;
  const forms: Record<AskpassRequest["kind"], [string, Field[]]> = {
    username: [
      retry ? invalid : `Please enter your credentials for ${target}: `,
      [{ name: "username", label: "Username" }, password, REMEMBER],
    ],
    password: [retry ? invalid : `Enter password for ${user ? target.replace("://", `://${user}@`) : target}:`, [password, REMEMBER]],
    passphrase: [
      retry ? `Incorrect passphrase for SSH key '${target}'. Try again:` : `Enter passphrase for SSH key '${target}':`,
      [{ ...password, label: "Passphrase" }],
    ],
    other: [target, [/\(yes\/no/.test(target) ? { name: "password", label: "Answer" } : password]],
  };
  const [message, fields] = forms[kind];
  const values = await ui.prompt("", fields, "Submit", message);
  if (!values) {
    return null;
  }
  return { username: values.username ?? "", password: values.password ?? "", remember: values.remember === "true" };
}

export function App() {
  const ui = useUi();
  const [state, setState] = useState<State | null>(null);
  const loaded = useRef(false);
  const [palette, setPalette] = useState<Domain | null>(null);

  useEffect(() => {
    gitneat()
      .storeGet()
      .then((saved) => {
        loaded.current = true;
        const s = { ...EMPTY, ...(saved as Partial<State>) };
        s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
        if (!s.settings.rememberTabs) {
          s.tabs = [];
        }
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

  const preferences = async () => {
    if (!state) {
      return;
    }
    const { autoFetch, lazyLoad, maxCommits, autoPrune, defaultBranch, rememberTabs, toolbarLabels, syntaxHighlighting } = state.settings;
    const v = await ui.prompt(
      "Preferences",
      [
        { name: "autoFetch", label: "Auto-Fetch Interval", help: "In minutes, between 0 and 60 (0 disables auto-fetch). Fetches all visible remotes.", value: String(autoFetch) },
        { name: "autoPrune", label: "Auto-Prune", kind: "checkbox", value: String(autoPrune) },
        { name: "defaultBranch", label: "Default Branch Name", help: "Sets the default branch name when initializing new repositories.", placeholder: "main", value: defaultBranch, ref: true },
        { name: "rememberTabs", label: "Remember tabs", kind: "checkbox", value: String(rememberTabs) },
        { name: "toolbarLabels", label: "Show toolbar icon labels", kind: "checkbox", value: String(toolbarLabels) },
        { name: "syntaxHighlighting", label: "Syntax Highlighting", kind: "checkbox", value: String(syntaxHighlighting) },
        { name: "lazyLoad", label: "Lazy Load Commits in Graph", kind: "checkbox", value: String(lazyLoad) },
        {
          name: "maxCommits",
          label: "Initial Commits in Graph",
          help: `Minimum ${MAX_COMMITS_MIN}. If commit lazy loading is enabled, GitNeat loads additional commits if you reach the earliest commit in the graph. Increasing this value may adversely affect performance.`,
          value: String(maxCommits),
        },
      ],
      "Save",
    );
    if (!v) {
      return;
    }
    const fetchMinutes = Number(v.autoFetch.trim());
    const commitCount = Number(v.maxCommits.trim());
    if (!Number.isInteger(fetchMinutes) || fetchMinutes < 0 || fetchMinutes > AUTO_FETCH_MAX) {
      ui.toast(`The Auto-Fetch interval must be a whole number from 0 to ${AUTO_FETCH_MAX}.`, "error", "Preferences");
      return;
    }
    if (!Number.isInteger(commitCount) || commitCount < MAX_COMMITS_MIN) {
      ui.toast(`The maximum commit count must be a whole number of at least ${MAX_COMMITS_MIN}.`, "error", "Preferences");
      return;
    }
    update((s) => ({
      ...s,
      settings: {
        autoFetch: fetchMinutes,
        lazyLoad: v.lazyLoad === "true",
        maxCommits: commitCount,
        autoPrune: v.autoPrune === "true",
        defaultBranch: v.defaultBranch.trim() === "main" ? "" : v.defaultBranch.trim(),
        rememberTabs: v.rememberTabs === "true",
        toolbarLabels: v.toolbarLabels === "true",
        syntaxHighlighting: v.syntaxHighlighting === "true",
      },
    }));
  };

  const repoPreferences = async () => {
    const path = state?.tabs[state.active]?.path;
    if (!state || !path) {
      return;
    }
    const current = state.prefs[path]?.commitDefaults;
    const v = await ui.prompt(
      "Repository Preferences",
      [
        { name: "push", label: "Push after each commit", kind: "checkbox", value: String(current?.push ?? false) },
        { name: "skipHooks", label: "Skip git hooks by default when committing", kind: "checkbox", value: String(current?.skipHooks ?? false) },
      ],
      "Save",
    );
    if (!v) {
      return;
    }
    const commitDefaults = { push: v.push === "true", skipHooks: v.skipHooks === "true" };
    update((s) => ({ ...s, prefs: { ...s.prefs, [path]: { ...(s.prefs[path] ?? NO_PREFS), commitDefaults } } }));
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
      palette: () => setPalette((p) => (p ? null : "top")),
      preferences,
      "repo-preferences": repoPreferences,
      "support-docs": () => gitneat().openExternal(SUPPORT_URL),
    };
    void actions[name]?.();
  };

  const menuHandler = useRef(runMenu);
  menuHandler.current = runMenu;
  useEffect(() => gitneat().onAppMenu((id) => menuHandler.current(id)), []);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(
    () =>
      gitneat().onAskpass((request) => {
        void askCredentials(uiRef.current, request).then((reply) => gitneat().askpassReply(request.request, reply));
      }),
    [],
  );

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
      } else if (key === "p" && !e.shiftKey) {
        id = "palette";
      } else if (key === "o" && e.shiftKey) {
        e.preventDefault();
        setPalette("openRepo");
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
    if (dir && (await ui.task("Init", () => initRepo(dir, state?.settings.defaultBranch ?? "")))) {
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
  const paletteApp: AppApi = {
    newTab,
    clone,
    init,
    closeTab: () => closeTabs((i) => i !== state.active),
    preferences,
    zoom: (step) => (step ? stepZoom(step) : update((s) => ({ ...s, layout: { ...s.layout, zoom: 1 } }))),
    toggleSetting: (key) => update((s) => ({ ...s, settings: { ...s.settings, [key]: !s.settings[key] } })),
    openRepo: openTab,
    recent: state.recent,
    favorites: state.favorites,
    aliases: state.aliases,
  };
  return (
    <LayoutContext.Provider value={layoutStore}>
      <div className={`app${state.settings.toolbarLabels ? "" : " no-tool-labels"}`}>
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
            settings={state.settings}
            onPreferences={() => void preferences()}
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
            onPalette={() => setPalette("top")}
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
        {palette && (
          <Palette
            start={palette}
            app={paletteApp}
            frecency={parseFrecency(state.layout["palette.frecency"] ?? JSON.stringify(EMPTY_FRECENCY))}
            setFrecency={(next) => setLayout("palette.frecency", JSON.stringify(next))}
            onClose={() => setPalette(null)}
          />
        )}
        <StatusBar zoom={zoom} />
      </div>
    </LayoutContext.Provider>
  );
}
