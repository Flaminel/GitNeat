# Repository map

Use this map to find the file to change.

## Processes

GitNeat is a Tauri 2 app with two parts.

1. The Rust app (`rust/app`) creates the window, runs `git`, reads repositories with gix, runs the repository actions, builds the context menus, shows dialogs and watches the repository folders.
2. The webview (`src/`) holds the React UI.

`src/tauri-api.ts` connects the two. It sets `window.gitneat`, which calls the Tauri commands. The type of `window.gitneat` is in `src/api.ts`.

## Files

| Path | Purpose |
| --- | --- |
| `src/api.ts` | Types for `window.gitneat` and `MenuSpec` |
| `src/tauri-api.ts` | `window.gitneat` for the Tauri app, through Tauri `invoke` and `listen` |
| `rust/MAP.md` | Rust port status: units, waves, claims |
| `rust/app/src/main.rs` | Tauri window, plugins, menu event handler, command list |
| `rust/app/src/commands.rs` | One Tauri command per `window.gitneat` call |
| `rust/app/src/git.rs` | `git` runner and the blocked option check |
| `rust/app/src/askpass.rs` | Askpass server and helper for credential and SSH passphrase prompts (D90) |
| `rust/app/src/menu.rs` | Native context menu from `MenuSpec` |
| `rust/app/src/appmenu.rs` | macOS app menu. Each custom item emits the event `app-menu` (D83) |
| `rust/app/src/watch.rs` | Repository folder watcher with a 400 ms debounce |
| `rust/app/src/store.rs` | Saved state file. Folder choice: `GITNEAT_USER_DATA`, portable marker (D80), app data folder |
| `rust/app/src/paths.rs` | Path normalize and the check for paths inside an open repository |
| `rust/app/src/load.rs` | `load_repo` and `load_commits` (one page, D81): backend choice, the `git` CLI path and the graph rows |
| `rust/app/src/loaders.rs` | Commit detail, file list, diff, diff sides, blame, file history, merge tool, image sides, compare files, amend message and commit hook check loaders (D45, D47, D86, D91, D93) |
| `rust/app/src/load_gix.rs` | `load_repo` with gix, in-process (D40) |
| `rust/app/src/actions.rs`, `rust/app/src/actions/` | Git logic of each repository action, dispatched by the `action` command (D41) |
| `rust/app/src/setup.rs` | Commands `repo_templates`, `clone_repo` (with the event `clone-progress`) and `init_repo` (D96) |
| `rust/app/src/templates.rs`, `rust/app/templates/` | Embedded `.gitignore` and license templates for Init (D96). Generated list, plain text files. |
| `rust/app/src/actions/discard.rs` | Snapshot, undo and redo of discarded changes (D89) |
| `rust/app/src/actions/files.rs` | Create file, delete file and repository maintenance actions (D95) |
| `rust/app/src/actions/submodule.rs` | Submodule loader (`load_submodules`) and the actions add, update, reset, commit, edit URL and delete (D97) |
| `rust/app/src/actions/tools.rs` | Open a file in the external diff or merge tool with `git difftool` and `git mergetool`, and the tool config check (D92) |
| `rust/app/src/menus.rs`, `rust/app/src/menus/` | Context menu builders for the `context_menu` command (D42) |
| `rust/app/examples/` | Command line entry points that the TS comparison tests run |
| `rust/graph`, `rust/diff`, `rust/merge`, `rust/repo` | Rust ports of the lane layout, the diff parser, `src/merge.ts` and the parsers of `src/repo.ts`, with recorded cases |
| `test/load-repo.test.ts`, `test/loaders.test.ts`, `test/actions.test.ts`, `test/menus-rust.test.ts` | TS against Rust comparison tests. They run only with `GITNEAT_RUST_COMPARE=1`. |
| `rust/app/tauri.conf.json` | Tauri build and bundle settings |
| `src/repo.ts` | Repository and graph row types, the loaders (each calls a Rust command) and remote web URLs |
| `src/merge.ts` | Merge conflict selections and the Output builder (D46). `load_merge` in `rust/app/src/loaders.rs` parses the conflict (D47). |
| `src/diff.ts` | Diff types and the patch builder for hunks and selected lines (D46) |
| `src/monaco.ts` | Monaco setup: worker, `gitneat` theme, language detection |
| `src/actions.ts` | UI flow of each repository action (prompts, confirms, toasts, undo records). The git work runs in Rust through `action`. |
| `src/menus.ts` | Context menus: asks Rust for the menu with `contextMenu`, then runs the handler for the chosen id |
| `src/ui.tsx` | Prompt and confirm dialogs, toasts, task runner, menu helper, `Splitter`, `useStored` and `LayoutContext` for the saved layout sizes and view options (D55) |
| `src/App.tsx` | Tabs, saved state (with `layout`, D55), open repository. A tab without a path is a NEW tab (D51). |
| `src/RepoView.tsx` | Layout of one tab: toolbar, left panel, center, right panel. Cache of the last loaded state for each open tab (`forgetRepos`) |
| `src/components/` | UI parts: `Toolbar`, `Tabs`, `Sidebar`, `GraphView`, `DetailPanel`, `DiffView` (hunk, inline, split, blame, history), `NewTab` (NEW tab page: Open, Clone, Start buttons and the Recent list), `MergeView` (merge conflict tool), `RebaseModal` |
| `src/components/RepoModal.tsx` | Clone and Init modal (D96) |
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
| `test/reference/` | Frozen TS version of the loaders, the lane layout, the diff parser, the actions and the menus, from before the Rust port. Only the comparison tests and `test/menus.test.ts` use it. |
| `test/commit-limit.test.ts` | Tests for `src/commitLimit.ts` |
| `test/left-panel.test.ts` | Tests for the section size rules in `src/leftPanel.ts` |
| `test/graph.test.ts` | Lane layout tests for `test/reference/graph.ts` |
| `test/menus.test.ts` | Context menu order tests for `test/reference/menus.ts` with a fake `window.gitneat` |
| `test/diff.test.ts` | Patch tests that run `git apply` in a temporary repository |
| `test/merge.test.ts` | Merge parser and Output tests that run `git merge-file` in a temporary repository |
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
| Add or reorder a context menu item | `rust/app/src/menus/`, then the handler for its id in `src/menus.ts` |
| Change the branch menu groups (Checkout and worktree submenus, merge items) | `rust/app/src/menus/`, then `branchHandlers` in `src/menus.ts` for the ids |
| Add a git operation | `src/actions.ts`, then call it from `src/menus.ts` or `src/components/Toolbar.tsx` |
| Load more data from git | `rust/app/src/load.rs`, `rust/app/src/load_gix.rs` and the `RepoData` type in `src/repo.ts` |
| Change graph lanes or colors | `rust/graph/src/port.rs` for lanes, `src/styles.css` (`--lane-*`) for colors |
| Change row height | `ROW_HEIGHT` in `src/components/GraphView.tsx` |
| Add a left panel section | `src/components/Sidebar.tsx` |
| Add or change an app menu item or a zoom step (D83) | `rust/app/src/appmenu.rs`, then `runMenu` in `src/App.tsx` |
| Add a new IPC call | `rust/app/src/commands.rs`, the command list in `rust/app/src/lib.rs`, `src/api.ts` and `src/tauri-api.ts` |
| Change the Clone or Init modal, the shallow options or the init files (D96) | `src/components/RepoModal.tsx`, `rust/app/src/setup.rs`, `rust/app/templates/` |
| Change the NEW tab page, its lists or its search | `src/components/NewTab.tsx`, `.new-tab` and `.recent` in `src/styles.css` |
| Change favorites, aliases or the breadcrumb menu (D82) | `toggleFavorite` and `renameRepo` in `src/App.tsx`, the repository crumb in `src/components/Toolbar.tsx` |
| Change the Tauri window buttons | `WindowControls` in `src/components/Tabs.tsx`, `.window-controls` in `src/styles.css` |
| Change the build targets | `bundle` in `rust/app/tauri.conf.json` and `.github/workflows/build.yml` |
| Change undo or redo | `undo` and `redo` in `src/actions.ts`, the stacks in `src/RepoView.tsx` |
| Change the Preferences dialog, auto-fetch or the commit settings (D84) | `preferences` in `src/App.tsx`, the auto-fetch effect and `loadMore` in `src/RepoView.tsx`, `src/commitLimit.ts` |
| Change the submodule menu, status or actions (D97) | `submodule_menu` in `rust/app/src/menus.rs`, `rust/app/src/actions/submodule.rs`, the submodule functions in `src/actions.ts`, the SUBMODULES section in `src/components/Sidebar.tsx` |
| Change a drag and drop action | `dropMenu` in `src/menus.ts` |
| Change the left panel selection, the multi menu or the folder menu (D98) | `clickRef` and `menuRef` in `src/components/Sidebar.tsx`, `refsMenu` and `folderMenu` in `src/menus.ts`, `refs_menu` and `folder_menu` in `rust/app/src/menus/branch.rs`, `deleteBranches` in `src/actions.ts` |
| Change commit search | `query` and `matches` in `src/components/GraphView.tsx` |
| Change the commit description in the graph | `describe` in `rust/repo/src/port.rs`, `descMenu` in `src/components/GraphView.tsx`, `.message-body` in `src/styles.css` (D58) |
| Change hunk view syntax or bracket colors | `renderModelLine` in `src/components/DiffView.tsx`, `.bracket-*` in `src/styles.css` |
| Change the image diff or its overlay (D91) | `ImageView` in `src/components/DiffView.tsx`, `load_images` in `rust/app/src/loaders.rs`, `.diff-image-*` in `src/styles.css` |
| Change the compare view of several commits (D93) | `CompareInfo` in `src/components/DetailPanel.tsx`, `select` in `src/RepoView.tsx`, `load_compare` in `rust/app/src/loaders.rs` |
| Change the diff toolbar or modes | `DiffView` in `src/components/DiffView.tsx` |
| Change hunk or line staging | `src/diff.ts` for the patch, `applyPatch` in `src/actions.ts` for the git call |
| Change diff colors | `src/monaco.ts` (Monaco theme) and `.line.add`, `.line.del` in `src/styles.css` |
| Change the merge tool layout or save flow | `MergeView` in `src/components/MergeView.tsx`, `.merge-*` in `src/styles.css` |
| Change how conflicts parse or combine | `rust/merge/src/port.rs` for the parse, `src/merge.ts` for the combine |
| Change a panel width default | `useStoredWidth` calls in `src/RepoView.tsx` and `src/components/GraphView.tsx` |
| Change left panel collapse or the rail | `leftCollapsed` in `src/RepoView.tsx`, the rail in `src/components/Sidebar.tsx`, `.rail` styles in `src/styles.css` |
| Change the Pull options or the default pull mode (D63) | `PULL_OPTIONS` in `src/components/Toolbar.tsx` |
| Change the merge and rebase panel text or buttons (D75) | `WipInfo` in `src/components/DetailPanel.tsx`, `load_operation` in `rust/app/src/loaders.rs` |
| Change the Conflicted Files section (D75) | `WipInfo` in `src/components/DetailPanel.tsx`, `markResolved` in `rust/app/src/actions/history.rs` |
| Change a repository shortcut (D59) | The keydown handler in `src/RepoView.tsx` |
| Change a tab shortcut | The keydown handler in `src/App.tsx` |
| Change the open in diff or merge tool items or Cmd+D (D92) | `rust/app/src/actions/tools.rs`, `file_menu` in `rust/app/src/menus.rs`, `openDiffTool` in `src/actions.ts`, `openInTool` in `src/RepoView.tsx` |
| Add or change a command palette command or domain (D95) | `buildCommands` and `domainItems` in `src/paletteCommands.ts`, ranking in `src/palette.ts`, the dialog in `src/components/Palette.tsx` |
| Change a credential or passphrase prompt (D90) | `askCredentials` in `src/App.tsx`, the prompt parse in `rust/app/src/askpass.rs` |

## Environment variables

| Name | Effect |
| --- | --- |
| `GITNEAT_USER_DATA` | Folder for `gitneat-state.json` (open tabs, recent repositories, hidden and solo branches). A `portable.txt` next to the exe also sets the exe folder (D80). |
| `GITNEAT_BACKEND` | `cli` makes the Tauri `load_repo` use the `git` CLI instead of gix |
| `GITNEAT_RUST_COMPARE` | `1` runs the TS against Rust comparison tests in `npm test` |
| `GITNEAT_ASKPASS_PORT`, `GITNEAT_ASKPASS_TOKEN`, `GITNEAT_ASKPASS_ID` | Set by `run_git` for git. If the port is set, the app executable runs as the askpass helper (D90). |
| `GITNEAT_WINDOW_SIZE` | Window size as `WIDTHxHEIGHT`. The default is `1500x940`. |
