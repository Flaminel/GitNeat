# Repository map

Use this map to find the file to change.

## Processes

GitNeat has one frontend, one Rust core and two hosts (D108).

1. The core (`rust/core`) runs `git`, reads repositories with gix, runs the repository actions, builds the context menu items, runs the terminal and watches the repository folders. It has no window code. The entry point is `commands::invoke(name, args)`.
2. The Tauri host (`rust/tauri`) creates the window, shows dialogs and native menus, and forwards each call to the core.
3. The Electron host (`electron/` and `rust/addon`) does the same. The addon loads the core into Node. The Electron main process shows dialogs and menus.
4. The webview (`src/`) holds the React UI.

`src/bridge-api.ts` builds `window.gitneat` from a transport. `src/tauri-api.ts` and `src/electron-api.ts` are the two transports. The type of `window.gitneat` is in `src/api.ts`.

## Files

| Path | Purpose |
| --- | --- |
| `src/api.ts` | Types for `window.gitneat` and `MenuSpec` |
| `src/keymap.ts` | Keyboard Shortcuts table, accelerator matcher and filter (D102) |
| `src/components/KeyboardShortcuts.tsx` | Keyboard Shortcuts modal (D102) |
| `src/components/MenuBar.tsx` | Menu bar for Windows and Linux (D102) |
| `src/components/TabsList.tsx` | Tabs list popup (D102) |
| `src/components/TerminalPanel.tsx` | Terminal panel view and context menu (D103) |
| `src/terminalSessions.ts` | xterm sessions by repository path (D103) |
| `src/graphNav.ts` | Next and previous commit on the branch for Shift+J and Shift+K (D102) |
| `src/bridge-api.ts` | `window.gitneat` built from a `Transport` (D108) |
| `src/tauri-api.ts` | Transport for the Tauri app: the Tauri command `dispatch` and `listen` |
| `src/electron-api.ts` | Transport for the Electron app: `window.gitneatBridge` from the preload script |
| `electron/main.ts` | Electron window, dialogs, shell calls, popup menus, askpass shim, routing to the addon (D108) |
| `electron/preload.ts` | Exposes `window.gitneatBridge` with `invoke`, `listen` and window actions |
| `electron/menu.ts` | Popup menu from `MenuSpec` for Electron |
| `electron/askpass.ts` | Askpass helper for Electron. The shim runs it with `ELECTRON_RUN_AS_NODE` (D108) |
| `rust/addon/src/lib.rs` | Node addon: `init(callback)` and `invoke(name, args)` over the core |
| `rust/tauri/src/main.rs` | Tauri window, plugins, menu event handler, event sink, the `dispatch` command |
| `rust/tauri/src/ui.rs` | Tauri side of the dialog, menu, clipboard and shell calls. Other names go to the core |
| `rust/tauri/src/menu.rs` | Native popup menu from `MenuSpec` |
| `rust/tauri/src/appmenu.rs` | macOS app menu and the panel check items |
| `rust/tauri/tauri.conf.json` | Tauri config, icons and capabilities |
| `scripts/addon.mjs`, `scripts/bundle.mjs` | Build the addon and the Electron bundle |
| `rust/core/src/emit.rs` | Event sink. The host sets it. The core emits `repo-changed`, `term-data` and similar events |
| `rust/MAP.md` | Rust port status: units, waves, claims |
| `rust/core/src/commands.rs` | `invoke(name, args)`: one boxed handler per `window.gitneat` call that needs no window |
| `rust/core/src/git.rs` | `git` runner and the blocked option check |
| `rust/core/src/askpass.rs` | Askpass server and helper for credential and SSH passphrase prompts (D90) |
| `rust/core/src/menu.rs` | The `MenuSpec` type |
| `rust/core/src/appmenu.rs` | App menu table for all platforms. The macOS menu and the webview menu bar come from it (D83, D102) |
| `rust/core/src/terminal.rs` | Terminal PTY sessions: the commands `term_*` and the events `term-data` and `term-exit` (D103) |
| `rust/core/src/watch.rs` | Repository folder watcher with a 400 ms debounce |
| `rust/core/src/store.rs` | Saved state file. Folder choice: `GITNEAT_USER_DATA`, portable marker (D80), app data folder |
| `rust/core/src/paths.rs` | Path normalize and the check for paths inside an open repository |
| `rust/core/src/load.rs` | `load_repo` and `load_commits` (one page, D81): backend choice, the `git` CLI path and the graph rows |
| `rust/core/src/loaders.rs` | Commit detail, file list, diff, diff sides, blame, file history, merge tool, image sides, compare files, amend message and commit hook check loaders (D45, D47, D86, D91, D93) |
| `rust/core/src/load_gix.rs` | `load_repo` with gix, in-process (D40) |
| `rust/core/src/actions.rs`, `rust/core/src/actions/` | Git logic of each repository action, dispatched by the `action` command (D41) |
| `rust/core/src/setup.rs` | Commands `repo_templates`, `clone_repo` (with the event `clone-progress`) and `init_repo` (D96) |
| `rust/core/src/templates.rs`, `rust/core/templates/` | Embedded `.gitignore` and license templates for Init (D96). Generated list, plain text files. |
| `rust/core/src/actions/discard.rs` | Snapshot, undo and redo of discarded changes (D89) |
| `rust/core/src/actions/files.rs` | Create file, delete file and repository maintenance actions (D95) |
| `rust/core/src/actions/submodule.rs` | Submodule loader (`load_submodules`) and the actions add, update, reset, commit, edit URL and delete (D97) |
| `rust/core/src/actions/tools.rs` | Open a file in the external diff or merge tool with `git difftool` and `git mergetool`, and the tool config check (D92) |
| `rust/core/src/menus.rs`, `rust/core/src/menus/` | Context menu builders for the `context_menu` command (D42) |
| `rust/core/examples/` | Command line entry points that the TS comparison tests run |
| `rust/graph`, `rust/diff`, `rust/merge`, `rust/repo` | Rust ports of the lane layout, the diff parser, `src/merge.ts` and the parsers of `src/repo.ts`, with recorded cases |
| `test/load-repo.test.ts`, `test/loaders.test.ts`, `test/actions.test.ts`, `test/menus-rust.test.ts` | TS against Rust comparison tests. They run only with `GITNEAT_RUST_COMPARE=1`. |
| `rust/core/tauri.conf.json` | Tauri build and bundle settings |
| `src/repo.ts` | Repository and graph row types, the loaders (each calls a Rust command) and remote web URLs |
| `src/merge.ts` | Merge conflict selections and the Output builder (D46). `load_merge` in `rust/core/src/loaders.rs` parses the conflict (D47). |
| `src/diff.ts` | Diff types and the patch builder for hunks and selected lines (D46) |
| `src/monaco.ts` | Monaco setup: worker, `gitneat` theme, language detection |
| `src/actions.ts` | UI flow of each repository action (prompts, confirms, toasts, undo records). The git work runs in Rust through `action`. |
| `src/menus.ts` | Context menus: asks Rust for the menu with `contextMenu`, then runs the handler for the chosen id |
| `src/ui.tsx` | Prompt and confirm dialogs, toasts, task runner, menu helper, `Splitter`, `useStored` and `LayoutContext` for the saved layout sizes and view options (D55) |
| `src/App.tsx` | Tabs, saved state (with `layout`, D55), open repository. A tab without a path is a NEW tab (D51). |
| `src/RepoView.tsx` | Layout of one tab: toolbar, left panel, center, right panel. Cache of the last loaded state for each open tab (`forgetRepos`) |
| `src/components/` | UI parts: `Toolbar`, `Tabs`, `Sidebar`, `GraphView`, `DetailPanel`, `DiffView` (hunk, inline, split, blame, history), `NewTab` (NEW tab page: Open, Clone, Start buttons and the Recent list), `MergeView` (merge conflict tool), `RebaseModal` |
| `src/components/RepoModal.tsx` | Clone and Init modal (D96) |
| `src/components/RepoManagement.tsx` | Repo Management tab: groups, batch fetch and pull, workspace modal (D100) |
| `src/repoManagement.ts` | Workspace and group types, group order, All repositories list and caption rule (D100) |
| `test/repo-management.test.ts` | Tests for `src/repoManagement.ts` |
| `rust/core/src/workspaces.rs` | Commands `repo_summaries`, `find_repos`, `pick_directories`, `import_code_workspace`, `repo_readme`, `create_readme`, `pick_icon` and `icon_data` (D100) |
| `rust/core/src/shellpath.rs` | macOS login shell PATH at start (D100) |
| `rust/core/src/editors.rs` | External editor list, detection and launch: `external_editors`, `open_in_editor` (D100) |
| `src/repoSetup.ts` | Name, path and form checks for the Clone and Init modal |
| `test/repo-setup.test.ts` | Tests for `src/repoSetup.ts` |
| `src/components/icons.tsx` | Inline SVG icons |
| `src/pendingMessage.ts` | Commit form text for each repository (summary and description). The right panel and the submodule commit use it (D97). |
| `test/pending-message.test.ts` | Tests for `src/pendingMessage.ts` |
| `src/palette.ts` | Command palette logic: fuzzy score, frecency (D95), rank, item builders and availability rules |
| `src/paletteCommands.ts` | Palette command list and the domain item loaders. `RepoView` registers the open repository with `setRepoApi`. |
| `src/components/Palette.tsx` | Command palette dialog (D95) |
| `test/palette.test.ts` | Tests for `src/palette.ts` |
| `src/commitLimit.ts` | Page size, load more rule and footer rule for the commit settings (D84) |
| `src/leftPanel.ts` | Left panel section sizes: bounds, push rule and handle rules (D67) |
| `src/styles.css` | Theme colors and all styles |
| `test/golden/` | Expected output of the Rust loaders, actions and menus as JSON, one file for each test file (D111) |
| `test/golden.ts` | `golden(name)` check function and the `enabled` flag. `UPDATE_GOLDEN=1` writes the files. |
| `test/rust.ts` | Builds and runs the Rust example binaries: `load_repo`, `parse` and the others |
| `test/actions.test.ts`, `test/menus-rust.test.ts`, `test/loaders.test.ts` | Run the Rust code on fixture repositories and compare with `test/golden/` (D111) |
| `test/load-repo.test.ts` | Same for `load_repo`. Runs only with `GITNEAT_SLOW=1` (D111). |
| `test/commit-limit.test.ts` | Tests for `src/commitLimit.ts` |
| `test/left-panel.test.ts` | Tests for the section size rules in `src/leftPanel.ts` |
| `test/diff.test.ts` | Patch tests for `src/diff.ts` that run `git apply` in a temporary repository. The parser is the Rust `parse` example. |
| `test/merge.test.ts` | Tests for `src/merge.ts` that run `git merge-file` in a temporary repository. The parser is the Rust `parse` example. |
| `test/discard-undo.test.ts` | Undo and redo of a discard, through the Rust `action` example. Runs only with `GITNEAT_RUST_COMPARE=1`. |
| `test/reword.test.ts` | Tests for `rewordDepth` in `src/actions.ts`: which commits the right panel can amend or reword (D53) |
| `.github/workflows/build.yml` | CI job `tauri`: tests, Rust checks and Tauri bundles for macOS, Windows and Linux. Release on `v*` tags |
| `build/icon.svg`, `build/icon.png` | App icon. Edit the SVG, then run `magick -background none -density 96 build/icon.svg -resize 1024x1024 build/icon.png`. |
| `docs/EVIDENCE.md` | What the Source analysis found, with evidence |
| `docs/EVIDENCE-DIFF.md` | Evidence for the Source diff and merge views |
| `docs/DECISIONS.md` | Design decisions and their limits |
| Parity plan (artifact, D50) | Open tasks against Source, with status: https://claude.ai/artifact/YTgdQpC5mdTiZbnmzdfRTt |

## Where to change things

| Task | File |
| --- | --- |
| Add or reorder a context menu item | `rust/core/src/menus/`, then the handler for its id in `src/menus.ts` |
| Change the branch menu groups (Checkout and worktree submenus, merge items) | `rust/core/src/menus/`, then `branchHandlers` in `src/menus.ts` for the ids |
| Add a git operation | `src/actions.ts`, then call it from `src/menus.ts` or `src/components/Toolbar.tsx` |
| Load more data from git | `rust/core/src/load.rs`, `rust/core/src/load_gix.rs` and the `RepoData` type in `src/repo.ts` |
| Change graph lanes or colors | `rust/graph/src/port.rs` for lanes, `src/styles.css` (`--lane-*`) for colors |
| Change row height | `ROW_HEIGHT` in `src/components/GraphView.tsx` |
| Add a left panel section | `src/components/Sidebar.tsx` |
| Add or change an app menu item or a zoom step (D83, D102) | `rust/core/src/appmenu.rs`, then `runMenu` in `src/App.tsx`. The key handler reads the accelerators from the same table |
| Change the Keyboard Shortcuts list (D102) | `keymapGroups` in `src/keymap.ts` |
| Add a new IPC call | `rust/core/src/commands.rs`, the command list in `rust/core/src/lib.rs`, `src/api.ts` and `src/tauri-api.ts` |
| Change the Clone or Init modal, the shallow options or the init files (D96) | `src/components/RepoModal.tsx`, `rust/core/src/setup.rs`, `rust/core/templates/` |
| Change the NEW tab page, its lists or its search | `src/components/NewTab.tsx`, `.new-tab` and `.recent` in `src/styles.css` |
| Change the Repo Management tab, its groups or the workspaces (D100) | `src/components/RepoManagement.tsx`, `src/repoManagement.ts`, `rust/core/src/workspaces.rs`, `.rm-*` in `src/styles.css` |
| Change the external editor list or the launch (D100) | `rust/core/src/editors.rs`, `openInEditor` and `preferences` in `src/App.tsx` |
| Change favorites, aliases or the breadcrumb menu (D82) | `toggleFavorite` and `renameRepo` in `src/App.tsx`, the repository crumb in `src/components/Toolbar.tsx` |
| Change the Tauri window buttons | `WindowControls` in `src/components/Tabs.tsx`, `.window-controls` in `src/styles.css` |
| Change the build targets | `bundle` in `rust/core/tauri.conf.json` and `.github/workflows/build.yml` |
| Change undo or redo | `undo` and `redo` in `src/actions.ts`, the stacks in `src/RepoView.tsx` |
| Change the Preferences dialog, auto-fetch or the commit settings (D84) | `preferences` in `src/App.tsx`, the auto-fetch effect and `loadMore` in `src/RepoView.tsx`, `src/commitLimit.ts` |
| Change the submodule menu, status or actions (D97) | `submodule_menu` in `rust/core/src/menus.rs`, `rust/core/src/actions/submodule.rs`, the submodule functions in `src/actions.ts`, the SUBMODULES section in `src/components/Sidebar.tsx` |
| Change a drag and drop action | `dropMenu` in `src/menus.ts` |
| Change the left panel selection, the multi menu or the folder menu (D98) | `clickRef` and `menuRef` in `src/components/Sidebar.tsx`, `refsMenu` and `folderMenu` in `src/menus.ts`, `refs_menu` and `folder_menu` in `rust/core/src/menus/branch.rs`, `deleteBranches` in `src/actions.ts` |
| Change commit search | `query` and `matches` in `src/components/GraphView.tsx` |
| Change the commit description in the graph | `describe` in `rust/repo/src/port.rs`, `descMenu` in `src/components/GraphView.tsx`, `.message-body` in `src/styles.css` (D58) |
| Change hunk view syntax or bracket colors | `renderModelLine` in `src/components/DiffView.tsx`, `.bracket-*` in `src/styles.css` |
| Change the image diff or its overlay (D91) | `ImageView` in `src/components/DiffView.tsx`, `load_images` in `rust/core/src/loaders.rs`, `.diff-image-*` in `src/styles.css` |
| Change the compare view of several commits, or the compare against the working directory item (D93, D99) | `CompareInfo` in `src/components/DetailPanel.tsx`, `select` and `compareWip` in `src/RepoView.tsx`, `compare_actions` in `rust/core/src/menus/branch.rs`, `load_compare` in `rust/core/src/loaders.rs` |
| Change the diff toolbar or modes | `DiffView` in `src/components/DiffView.tsx` |
| Change hunk or line staging | `src/diff.ts` for the patch, `applyPatch` in `src/actions.ts` for the git call |
| Change diff colors | `src/monaco.ts` (Monaco theme) and `.line.add`, `.line.del` in `src/styles.css` |
| Change the merge tool layout or save flow | `MergeView` in `src/components/MergeView.tsx`, `.merge-*` in `src/styles.css` |
| Change how conflicts parse or combine | `rust/merge/src/port.rs` for the parse, `src/merge.ts` for the combine |
| Change a panel width default | `useStoredWidth` calls in `src/RepoView.tsx` and `src/components/GraphView.tsx` |
| Change left panel collapse or the rail | `leftCollapsed` in `src/RepoView.tsx`, the rail in `src/components/Sidebar.tsx`, `.rail` styles in `src/styles.css` |
| Change the Pull options or the default pull mode (D63) | `PULL_OPTIONS` in `src/components/Toolbar.tsx` |
| Change the merge and rebase panel text or buttons (D75) | `WipInfo` in `src/components/DetailPanel.tsx`, `load_operation` in `rust/core/src/loaders.rs` |
| Change the Conflicted Files section (D75) | `WipInfo` in `src/components/DetailPanel.tsx`, `markResolved` in `rust/core/src/actions/history.rs` |
| Change a repository shortcut (D59) | The keydown handler in `src/RepoView.tsx` |
| Change a tab shortcut | The keydown handler in `src/App.tsx` |
| Change the open in diff or merge tool items or Cmd+D (D92) | `rust/core/src/actions/tools.rs`, `file_menu` in `rust/core/src/menus.rs`, `openDiffTool` in `src/actions.ts`, `openInTool` in `src/RepoView.tsx` |
| Add or change a command palette command or domain (D95) | `buildCommands` and `domainItems` in `src/paletteCommands.ts`, ranking in `src/palette.ts`, the dialog in `src/components/Palette.tsx` |
| Change a credential or passphrase prompt (D90) | `askCredentials` in `src/App.tsx`, the prompt parse in `rust/core/src/askpass.rs` |

## Environment variables

| Name | Effect |
| --- | --- |
| `GITNEAT_USER_DATA` | Folder for `gitneat-state.json` (open tabs, recent repositories, hidden and solo branches). A `portable.txt` next to the exe also sets the exe folder (D80). |
| `GITNEAT_BACKEND` | `cli` makes the Tauri `load_repo` use the `git` CLI instead of gix |
| `GITNEAT_ADDON` | Path of the addon file for Electron. The default is `native/gitneat.node` |
| `GITNEAT_RUST_COMPARE` | `1` runs the TS against Rust comparison tests in `npm test` |
| `GITNEAT_ASKPASS_PORT`, `GITNEAT_ASKPASS_TOKEN`, `GITNEAT_ASKPASS_ID` | Set by `run_git` for git. If the port is set, the app executable runs as the askpass helper (D90). |
| `GITNEAT_WINDOW_SIZE` | Window size as `WIDTHxHEIGHT`. The default is `1500x940`. |
