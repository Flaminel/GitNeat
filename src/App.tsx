import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskpassReply, AskpassRequest, ExternalEditor, gitneat } from "./api";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { MenuBar } from "./components/MenuBar";
import { NewTab } from "./components/NewTab";
import { TabsList } from "./components/TabsList";
import { TERMINAL_EVENT } from "./terminalSessions";
import { AppMenu, matchAccel, menuAccels } from "./keymap";
import { repoName, Tab, Tabs } from "./components/Tabs";
import { samePath } from "./repo";
import { AUTO_FETCH_MAX, DEFAULT_SETTINGS, forgetRepos, MAX_COMMITS_MIN, RepoPrefs, RepoView, Settings, SubmoduleAutoUpdate, TERMINAL_FONT_SIZE, TERMINAL_LINE_HEIGHT, TerminalCursor } from "./RepoView";
import { Palette } from "./components/Palette";
import { RepoModal, RepoModalTab } from "./components/RepoModal";
import { RepoManagement } from "./components/RepoManagement";
import { GroupPrefs, Workspace } from "./repoManagement";
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
  workspaces: Workspace[];
  groups: Record<string, GroupPrefs>;
  groupOrder: string[];
}

const EMPTY: State = { tabs: [], active: 0, recent: [], favorites: [], aliases: {}, closed: [], prefs: {}, layout: {}, settings: DEFAULT_SETTINGS, workspaces: [], groups: {}, groupOrder: [] };
const MANAGEMENT = -1;
const NO_PREFS: RepoPrefs = { hidden: [], solo: [] };
const AUTO_UPDATE_LABELS: Record<SubmoduleAutoUpdate, string> = { default: "Use global setting", enabled: "Enabled", disabled: "Disabled" };
const NEW_TAB: Tab = {};
const NO_EDITOR = "<None>";
const CUSTOM_EDITOR = "<Custom>";
const NO_EDITOR_MESSAGE = "There is no external editor configured in your settings";
const RECENT_LIMIT = 100;
const REPO_PATH_WARN_LIMIT = 5;
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
const PANEL_IDS = ["left-panel", "details-panel"];
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
  const [repoModal, setRepoModal] = useState<RepoModalTab | null>(null);
  const [editors, setEditors] = useState<ExternalEditor[]>([]);
  const [menus, setMenus] = useState<AppMenu[]>([]);
  const [shortcuts, setShortcuts] = useState(false);
  const [tabsList, setTabsList] = useState(false);
  const [panels, setPanels] = useState<{ left: boolean; details: boolean; terminal: boolean } | null>(null);
  const mac = gitneat().platform === "darwin";

  useEffect(() => {
    void gitneat().appMenu().then(setMenus);
  }, []);

  useEffect(() => {
    void gitneat().setPanelChecks(panels && panels.left, panels && panels.details, panels && panels.terminal);
  }, [panels]);

  useEffect(() => {
    gitneat()
      .storeGet()
      .then((saved) => {
        loaded.current = true;
        const s = { ...EMPTY, ...(saved as Partial<State>) };
        s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
        if (!s.settings.rememberTabs) {
          s.tabs = [];
          s.active = 0;
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

  const loadedState = !!state;
  useEffect(() => {
    if (!loadedState) {
      return;
    }
    void gitneat()
      .externalEditors()
      .then((found) => {
        setEditors(found);
        if (found.length === 1) {
          update((s) => (s.settings.externalEditor ? s : { ...s, settings: { ...s.settings, externalEditor: found[0].id } }));
        }
      });
  }, [loadedState, update]);

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
    const { autoFetch, lazyLoad, maxCommits, autoPrune, defaultBranch, rememberTabs, toolbarLabels, syntaxHighlighting, autoUpdateSubmodules, externalEditor, externalEditorPath, inAppTerminal, terminalFont, terminalFontSize, terminalLineHeight, terminalCursor } = state.settings;
    const editorLabel = (id: string) => (id === "custom" ? CUSTOM_EDITOR : editors.find((e) => e.id === id)?.label ?? NO_EDITOR);
    const v = await ui.prompt(
      "Preferences",
      [
        { name: "autoFetch", label: "Auto-Fetch Interval", help: "In minutes, between 0 and 60 (0 disables auto-fetch). Fetches all visible remotes.", value: String(autoFetch) },
        { name: "autoPrune", label: "Auto-Prune", kind: "checkbox", value: String(autoPrune) },
        {
          name: "autoUpdateSubmodules",
          label: "Keep submodules up to date",
          help: "Automatically update all submodules after performing a Git action",
          kind: "checkbox",
          value: String(autoUpdateSubmodules),
        },
        { name: "defaultBranch", label: "Default Branch Name", help: "Sets the default branch name when initializing new repositories.", placeholder: "main", value: defaultBranch, ref: true },
        { name: "externalEditor", label: "External Editor", kind: "select", options: [NO_EDITOR, ...editors.map((e) => e.label), CUSTOM_EDITOR], value: editorLabel(externalEditor) },
        {
          name: "externalEditorPath",
          label: "Editor Executable",
          help: `Path to the editor executable. Used when External Editor is ${CUSTOM_EDITOR}.`,
          value: externalEditorPath,
        },
        { name: "inAppTerminal", label: "Use In-App Terminal Instead", help: "Open Repo in Terminal shows the terminal panel instead of an external terminal.", kind: "checkbox", value: String(inAppTerminal) },
        { name: "terminalFont", label: "In-App Terminal Font", help: "Font family. Changes apply on the next terminal start.", value: terminalFont },
        { name: "terminalFontSize", label: "In-App Terminal Font Size", help: `From ${TERMINAL_FONT_SIZE.min} to ${TERMINAL_FONT_SIZE.max}.`, value: String(terminalFontSize) },
        { name: "terminalLineHeight", label: "In-App Terminal Line Height", help: `From ${TERMINAL_LINE_HEIGHT.min} to ${TERMINAL_LINE_HEIGHT.max}.`, value: String(terminalLineHeight) },
        { name: "terminalCursor", label: "In-App Terminal Cursor Style", kind: "select", options: ["Block", "Underline", "Bar"], value: terminalCursor.replace(/^./, (c) => c.toUpperCase()) },
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
    const fontSize = Number(v.terminalFontSize.trim());
    const lineHeight = Number(v.terminalLineHeight.trim());
    if (!Number.isInteger(fontSize) || fontSize < TERMINAL_FONT_SIZE.min || fontSize > TERMINAL_FONT_SIZE.max) {
      ui.toast(`The terminal font size must be a whole number from ${TERMINAL_FONT_SIZE.min} to ${TERMINAL_FONT_SIZE.max}.`, "error", "Preferences");
      return;
    }
    if (!(lineHeight >= TERMINAL_LINE_HEIGHT.min && lineHeight <= TERMINAL_LINE_HEIGHT.max)) {
      ui.toast(`The terminal line height must be a number from ${TERMINAL_LINE_HEIGHT.min} to ${TERMINAL_LINE_HEIGHT.max}.`, "error", "Preferences");
      return;
    }
    update((s) => ({
      ...s,
      settings: {
        inAppTerminal: v.inAppTerminal === "true",
        terminalFont: v.terminalFont.trim(),
        terminalFontSize: fontSize,
        terminalLineHeight: lineHeight,
        terminalCursor: v.terminalCursor.toLowerCase() as TerminalCursor,
        autoFetch: fetchMinutes,
        lazyLoad: v.lazyLoad === "true",
        maxCommits: commitCount,
        autoPrune: v.autoPrune === "true",
        defaultBranch: v.defaultBranch.trim() === "main" ? "" : v.defaultBranch.trim(),
        rememberTabs: v.rememberTabs === "true",
        toolbarLabels: v.toolbarLabels === "true",
        syntaxHighlighting: v.syntaxHighlighting === "true",
        autoUpdateSubmodules: v.autoUpdateSubmodules === "true",
        externalEditor: v.externalEditor === CUSTOM_EDITOR ? "custom" : editors.find((e) => e.label === v.externalEditor)?.id ?? "",
        externalEditorPath: v.externalEditorPath.trim(),
      },
    }));
  };

  const repoPreferences = async () => {
    const path = state?.tabs[state.active]?.path;
    if (!state || !path) {
      return;
    }
    const current = state.prefs[path]?.commitDefaults;
    const auto = state.prefs[path]?.autoUpdateSubmodules ?? "default";
    const v = await ui.prompt(
      "Repository Preferences",
      [
        { name: "push", label: "Push after each commit", kind: "checkbox", value: String(current?.push ?? false) },
        { name: "skipHooks", label: "Skip git hooks by default when committing", kind: "checkbox", value: String(current?.skipHooks ?? false) },
        {
          name: "autoUpdateSubmodules",
          label: "Keep submodules up to date",
          kind: "select",
          options: Object.values(AUTO_UPDATE_LABELS),
          value: AUTO_UPDATE_LABELS[auto],
        },
      ],
      "Save",
    );
    if (!v) {
      return;
    }
    const commitDefaults = { push: v.push === "true", skipHooks: v.skipHooks === "true" };
    const autoUpdateSubmodules = (Object.keys(AUTO_UPDATE_LABELS) as SubmoduleAutoUpdate[]).find((k) => AUTO_UPDATE_LABELS[k] === v.autoUpdateSubmodules) ?? "default";
    update((s) => ({ ...s, prefs: { ...s.prefs, [path]: { ...(s.prefs[path] ?? NO_PREFS), commitDefaults, autoUpdateSubmodules } } }));
  };

  const openInEditor = async (paths: string[]) => {
    if (!state) {
      return;
    }
    const { externalEditor, externalEditorPath } = state.settings;
    if (paths.length >= REPO_PATH_WARN_LIMIT && !(await ui.confirm("", `GitNeat will open ${paths.length} repositories in your external editor. Are you sure you want to continue?`))) {
      return;
    }
    try {
      if (!externalEditor) {
        throw new Error(NO_EDITOR_MESSAGE);
      }
      await gitneat().openInEditor(externalEditor, externalEditorPath, paths);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(NO_EDITOR_MESSAGE)) {
        const answer = await ui.choose(NO_EDITOR_MESSAGE, [{ label: "View External Editor Settings", value: "settings" }]);
        if (answer?.choice === "settings") {
          void preferences();
        }
      } else {
        ui.toast(message, "error");
      }
    }
  };

  const openTerminal = (path: string) => {
    if (state?.settings.inAppTerminal) {
      window.dispatchEvent(new CustomEvent(TERMINAL_EVENT, { detail: "open" }));
    } else {
      void gitneat().openTerminal(path);
    }
  };

  const newTab = () => update((s) => ({ ...s, tabs: [...s.tabs, NEW_TAB], active: s.tabs.length }));

  const closeTabs = (keep: (i: number) => boolean) =>
    update((s) => {
      const closed = s.tabs.filter((t, i) => !keep(i) && t.path);
      const tabs = s.tabs.filter((_, i) => keep(i));
      if (!tabs.length) {
        return { ...s, tabs: [NEW_TAB], active: 0, closed: [...closed, ...s.closed].slice(0, 20) };
      }
      if (s.active === MANAGEMENT) {
        return { ...s, tabs, closed: [...closed, ...s.closed].slice(0, 20) };
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
    update((s) => {
      if (s.active === MANAGEMENT) {
        return { ...s, active: step > 0 ? 0 : s.tabs.length - 1 };
      }
      return { ...s, active: (s.active + step + s.tabs.length) % Math.max(1, s.tabs.length) };
    });

  const openManagement = () => update((s) => ({ ...s, active: MANAGEMENT }));

  const runMenu = (id: string) => {
    if (!state) {
      return;
    }
    const [name, index] = id.split(":");
    const path = state.tabs[state.active]?.path;
    const actions: Record<string, () => unknown> = {
      "new-tab": newTab,
      "close-tab": () => state.active !== MANAGEMENT && state.tabs.length && closeTabs((i) => i !== state.active),
      "reopen-tab": () => reopen(),
      clone: clone,
      init: init,
      open: openDialog,
      "repo-management": openManagement,
      terminal: () => path && openTerminal(path),
      "terminal-panel": () => window.dispatchEvent(new CustomEvent(TERMINAL_EVENT, { detail: "toggle" })),
      "file-manager": () => path && gitneat().openPath(path),
      "external-editor": () => path && openInEditor([path]),
      undo: () => pressKey("KeyZ"),
      redo: () => pressKey("KeyZ", true),
      "left-panel": () => pressKey("KeyJ"),
      "details-panel": () => pressKey("KeyK"),
      fullscreen: () => gitneat().toggleFullscreen(),
      exit: () => gitneat().windowAction("close"),
      shortcuts: () => setShortcuts((s) => !s),
      "tabs-list": () => setTabsList((s) => !s),
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

  const accels = useMemo(() => menuAccels(menus), [menus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) {
        return;
      }
      const hit = accels.find((a) => matchAccel(a.accel, e));
      if (!mac && hit?.id !== "terminal-panel" && (e.target as HTMLElement).closest(".xterm")) {
        return;
      }
      if (hit && !PANEL_IDS.includes(hit.id)) {
        e.preventDefault();
        runMenu(hit.id);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && ["KeyO", "KeyH", "KeyP"].includes(e.code)) {
        e.preventDefault();
        const domains: Record<string, Domain | null> = { KeyO: "openRepo", KeyH: state.tabs[state.active]?.path ? "history" : null, KeyP: "top" };
        const domain = domains[e.code];
        if (domain) {
          setPalette(e.code === "KeyP" ? (p) => (p ? null : domain) : domain);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reopen = (index = 0) =>
    update((s) => {
      const tab = s.closed[index];
      if (!tab) {
        return s;
      }
      return { ...s, tabs: [...s.tabs, tab], active: s.tabs.length, closed: s.closed.filter((_, i) => i !== index) };
    });

  const clone = () => setRepoModal("clone");
  const init = () => setRepoModal("init");

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
  const { externalEditor, externalEditorPath } = state.settings;
  const editorName = !externalEditor ? null : externalEditor === "custom" ? externalEditorPath.split(/[\\/]/).pop() || "Custom" : editors.find((e) => e.id === externalEditor)?.label ?? null;
  const paletteApp: AppApi = {
    newTab,
    clone,
    init,
    closeTab: () => state.active !== MANAGEMENT && closeTabs((i) => i !== state.active),
    openManagement,
    preferences,
    zoom: (step) => (step ? stepZoom(step) : update((s) => ({ ...s, layout: { ...s.layout, zoom: 1 } }))),
    toggleSetting: (key) => update((s) => ({ ...s, settings: { ...s.settings, [key]: !s.settings[key] } })),
    openRepo: openTab,
    openInEditor: (path) => openInEditor([path]),
    openTerminal,
    recent: state.recent,
    favorites: state.favorites,
    aliases: state.aliases,
  };
  return (
    <LayoutContext.Provider value={layoutStore}>
      <div className={`app${state.settings.toolbarLabels ? "" : " no-tool-labels"}`}>
        {!mac && <MenuBar menus={menus} checks={panels ? { "left-panel": panels.left, "details-panel": panels.details, "terminal-panel": panels.terminal } : {}} run={runMenu} />}
        <Tabs
          tabs={state.tabs}
          active={state.active}
          onManagement={openManagement}
          canReopen={state.closed.length > 0}
          onActivate={(i) => update((s) => ({ ...s, active: i }))}
          onClose={(i) => closeTabs((j) => j !== i)}
          onCloseOthers={(i) => closeTabs((j) => j === i)}
          onCloseRight={(i) => closeTabs((j) => j <= i)}
          aliases={state.aliases}
          favorites={state.favorites}
          onRename={(i) => void renameRepo(state.tabs[i].path!)}
          onFavorite={(i) => toggleFavorite(state.tabs[i].path!)}
          onReopen={() => reopen()}
          tabsListOpen={tabsList}
          onTabsList={() => setTabsList((s) => !s)}
          tabsList={
            <TabsList
              tabs={state.tabs}
              closed={state.closed}
              aliases={state.aliases}
              onSelect={(i) => {
                setTabsList(false);
                update((s) => ({ ...s, active: i }));
              }}
              onClose={(i) => closeTabs((j) => j !== i)}
              onReopen={(i) => {
                setTabsList(false);
                reopen(i);
              }}
              onDismiss={() => setTabsList(false)}
            />
          }
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
        {state.active === MANAGEMENT ? (
          <RepoManagement
            open={state.tabs.flatMap((t) => (t.path ? [t.path] : []))}
            favorites={state.favorites}
            recent={state.recent}
            aliases={state.aliases}
            workspaces={state.workspaces}
            groups={state.groups}
            order={state.groupOrder}
            onOrder={(ids) => update((s) => ({ ...s, groupOrder: ids }))}
            editorName={editorName}
            onOpenInEditor={openInEditor}
            prune={state.settings.autoPrune}
            recurse={state.settings.autoUpdateSubmodules}
            onOpenTabs={(paths) => paths.forEach(openTab)}
            onCloseRepos={(paths) => closeTabs((i) => !paths.some((p) => !!state.tabs[i].path && samePath(state.tabs[i].path!, p)))}
            onFavorite={toggleFavorite}
            onRemoveRecent={(paths) => update((s) => ({ ...s, recent: s.recent.filter((r) => !paths.includes(r)) }))}
            onWorkspaces={(fn) => update((s) => ({ ...s, workspaces: fn(s.workspaces) }))}
            onGroups={(fn) => update((s) => ({ ...s, groups: fn(s.groups) }))}
            onOpenDialog={openDialog}
            onClone={clone}
            onInit={init}
          />
        ) : activePath ? (
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
            onPanels={setPanels}
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
        {repoModal && <RepoModal start={repoModal} defaultBranch={state.settings.defaultBranch} onClose={() => setRepoModal(null)} onOpen={openTab} />}
        {shortcuts && <KeyboardShortcuts onClose={() => setShortcuts(false)} />}
        <StatusBar zoom={zoom} />
      </div>
    </LayoutContext.Provider>
  );
}
