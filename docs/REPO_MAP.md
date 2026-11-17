# Repository map

Use this map to find the file to change.

## Processes

GitNeat has two processes.

1. The main process (`electron/`) creates the window, runs `git`, shows native menus and dialogs, and watches the repository folders.
2. The renderer (`src/`) holds all UI and all git logic.

The preload script (`electron/preload.ts`) connects the two. It exposes `window.gitneat`. The type of `window.gitneat` is in `src/api.ts`.

On the `rust-rewrite` branch, a Tauri app in `rust/app` can replace the main process. `src/tauri-api.ts` then sets `window.gitneat` (see D29 in `docs/DECISIONS.md`). Run it with `npm run tauri:dev`.

## Files

| Path | Purpose |
| --- | --- |
| `electron/main.ts` | Window, IPC handlers, `git` runner, native menu popup, file watcher, saved state file |
| `electron/preload.ts` | Exposes the IPC handlers as `window.gitneat` |
| `src/api.ts` | Types for `window.gitneat` and `MenuSpec` |
| `src/tauri-api.ts` | `window.gitneat` for the Tauri app, through Tauri `invoke` and `listen` |
| `rust/MAP.md` | Rust port status: units, waves, claims |
| `rust/app/src/main.rs` | Tauri window, plugins, menu event handler, command list |
| `rust/app/src/commands.rs` | One Tauri command per `window.gitneat` call |
| `rust/app/src/git.rs` | `git` runner and the blocked option check |
| `rust/app/src/menu.rs` | Native context menu from `MenuSpec` |
| `rust/app/src/watch.rs` | Repository folder watcher with a 400 ms debounce |
| `rust/app/src/store.rs` | Saved state file |
| `rust/app/src/paths.rs` | Path normalize and the check for paths inside an open repository |
| `rust/app/src/load.rs` | `load_repo`: backend choice and the `git` CLI path |
| `rust/app/src/load_gix.rs` | `load_repo` with gix, in-process (D40) |
| `rust/app/src/actions.rs`, `rust/app/src/actions/` | Git logic of each repository action, dispatched by the `action` command (D41) |
| `rust/app/src/menus.rs`, `rust/app/src/menus/` | Context menu builders for the `context_menu` command (D42) |
| `rust/app/examples/` | Command line entry points that the TS comparison tests run |
| `rust/graph`, `rust/diff`, `rust/merge`, `rust/repo` | Rust ports of `src/graph.ts`, `src/diff.ts`, `src/merge.ts` and the parsers of `src/repo.ts`, with recorded cases |
| `test/load-repo.test.ts`, `test/actions.test.ts`, `test/menus-rust.test.ts` | TS against Rust comparison tests. They run only with `GITNEAT_RUST_COMPARE=1`. |
| `rust/app/tauri.conf.json` | Tauri build and bundle settings |
| `src/repo.ts` | Loads and parses repository data: log, refs, status, stashes, worktrees, commit detail, diffs, remote web URLs |
| `src/graph.ts` | Lane layout for the commit graph |
| `src/merge.ts` | Merge conflict parser, selections and Output builder |
| `src/diff.ts` | Unified diff parser and patch builder for hunks and selected lines |
| `src/monaco.ts` | Monaco setup: worker, `gitneat` theme, language detection |
| `src/actions.ts` | Git operations that change the repository (checkout, merge, rebase, reset, push, and so on) |
| `src/menus.ts` | Context menu content for commits, branches, tags, stashes, remotes, worktrees, files and tabs |
| `src/ui.tsx` | Prompt and confirm dialogs, toasts, task runner, menu helper, `Splitter` and saved panel widths |
| `src/App.tsx` | Tabs, saved state, open repository |
| `src/RepoView.tsx` | Layout of one tab: toolbar, left panel, center, right panel |
| `src/components/` | UI parts: `Toolbar`, `Tabs`, `Sidebar`, `GraphView`, `DetailPanel`, `DiffView` (hunk, inline, split, blame, history), `MergeView` (merge conflict tool), `RebaseModal` |
| `src/components/icons.tsx` | Inline SVG icons |
| `src/styles.css` | Theme colors and all styles |
| `test/graph.test.ts` | Lane layout tests |
| `test/menus.test.ts` | Context menu order tests with a fake `window.gitneat` |
| `test/diff.test.ts` | Patch tests that run `git apply` in a temporary repository |
| `test/merge.test.ts` | Merge parser and Output tests that run `git merge-file` in a temporary repository |
| `.github/workflows/build.yml` | CI: typecheck, tests, macOS and Windows packages, release on `v*` tags. Job `tauri`: Rust checks and Tauri bundles for macOS, Windows and Linux |
| `build/icon.svg`, `build/icon.png` | App icon. Edit the SVG, then run `magick -background none -density 96 build/icon.svg -resize 1024x1024 build/icon.png`. |
| `docs/EVIDENCE.md` | What the Source analysis found, with evidence |
| `docs/EVIDENCE-DIFF.md` | Evidence for the Source diff and merge views |
| `docs/DECISIONS.md` | Design decisions and their limits |

## Where to change things

| Task | File |
| --- | --- |
| Add or reorder a context menu item | `src/menus.ts` |
| Change the branch menu groups (Checkout and worktree submenus, merge items) | `branchGroups`, `checkoutItems`, `worktreeItems`, `mergeItems` in `src/menus.ts` |
| Add a git operation | `src/actions.ts`, then call it from `src/menus.ts` or `src/components/Toolbar.tsx` |
| Load more data from git | `src/repo.ts` (`loadRepo` and the `RepoData` type) |
| Change graph lanes or colors | `src/graph.ts` for lanes, `src/styles.css` (`--lane-*`) for colors |
| Change row height | `ROW_HEIGHT` in `src/components/GraphView.tsx` |
| Add a left panel section | `src/components/Sidebar.tsx` |
| Add a new IPC call | `electron/main.ts`, `electron/preload.ts`, `src/api.ts`, then the same call in `rust/app/src/commands.rs`, `rust/app/src/main.rs` and `src/tauri-api.ts` |
| Change the Tauri window buttons | `WindowControls` in `src/components/Tabs.tsx`, `.window-controls` in `src/styles.css` |
| Change the build targets | `build` in `package.json` and `.github/workflows/build.yml` |
| Change undo or redo | `run`, `undo` and `redo` in `src/actions.ts`, the stacks in `src/RepoView.tsx` |
| Change a drag and drop action | `dropMenu` in `src/menus.ts` |
| Change commit search | `query` and `matches` in `src/components/GraphView.tsx` |
| Change hunk view syntax or bracket colors | `renderModelLine` in `src/components/DiffView.tsx`, `.bracket-*` in `src/styles.css` |
| Change the diff toolbar or modes | `DiffView` in `src/components/DiffView.tsx` |
| Change hunk or line staging | `src/diff.ts` for the patch, `applyPatch` in `src/actions.ts` for the git call |
| Change diff colors | `src/monaco.ts` (Monaco theme) and `.line.add`, `.line.del` in `src/styles.css` |
| Change the merge tool layout or save flow | `MergeView` in `src/components/MergeView.tsx`, `.merge-*` in `src/styles.css` |
| Change how conflicts parse or combine | `src/merge.ts` |
| Change a panel width default | `useStoredWidth` calls in `src/RepoView.tsx` and `src/components/GraphView.tsx` |
| Change left panel collapse, its shortcut or the rail | `leftCollapsed` and the Cmd+J handler in `src/RepoView.tsx`, the rail in `src/components/Sidebar.tsx`, `.rail` styles in `src/styles.css` |

## Environment variables

| Name | Effect |
| --- | --- |
| `GITNEAT_USER_DATA` | Folder for `gitneat-state.json` (open tabs, recent repositories, hidden and solo branches). The Tauri app reads it too. |
| `GITNEAT_BACKEND` | `cli` makes the Tauri `load_repo` use the `git` CLI instead of gix |
| `GITNEAT_RUST_COMPARE` | `1` runs the TS against Rust comparison tests in `npm test` |
| `GITNEAT_WINDOW_SIZE` | Window size as `WIDTHxHEIGHT`. The default is `1500x940`. The Tauri app reads it too. |
| `GITNEAT_SCREENSHOT` | PNG path. The app captures the window and quits. |
| `GITNEAT_SCREENSHOT_DELAY` | Milliseconds before the capture. The default is 2500. |
| `GITNEAT_SCREENSHOT_JS` | JavaScript that runs in the page before the capture |
| `VITE_DEV` | Load the renderer from the Vite dev server (`npm run dev` sets it) |

Some editors set `ELECTRON_RUN_AS_NODE=1` in the shell. If your shell has this variable, unset it before you start GitNeat.
