# Repository map

Use this map to find the file to change.

## Processes

Krill has two processes.

1. The main process (`electron/`) creates the window, runs `git`, shows native menus and dialogs, and watches the repository folders.
2. The renderer (`src/`) holds all UI and all git logic.

The preload script (`electron/preload.ts`) connects the two. It exposes `window.krill`. The type of `window.krill` is in `src/api.ts`.

## Files

| Path | Purpose |
| --- | --- |
| `electron/main.ts` | Window, IPC handlers, `git` runner, native menu popup, file watcher, saved state file |
| `electron/preload.ts` | Exposes the IPC handlers as `window.krill` |
| `src/api.ts` | Types for `window.krill` and `MenuSpec` |
| `src/repo.ts` | Loads and parses repository data: log, refs, status, stashes, worktrees, commit detail, diffs, remote web URLs |
| `src/graph.ts` | Lane layout for the commit graph |
| `src/actions.ts` | Git operations that change the repository (checkout, merge, rebase, reset, push, and so on) |
| `src/menus.ts` | Context menu content for commits, branches, tags, stashes, remotes, worktrees, files and tabs |
| `src/ui.tsx` | Prompt and confirm dialogs, toasts, menu helper |
| `src/App.tsx` | Tabs, saved state, open repository |
| `src/RepoView.tsx` | Layout of one tab: toolbar, left panel, center, right panel |
| `src/components/` | UI parts: `Toolbar`, `Tabs`, `Sidebar`, `GraphView`, `DetailPanel`, `DiffView`, `RebaseModal` |
| `src/styles.css` | Theme colors and all styles |
| `test/` | Unit tests. Run `npm test`. |
| `docs/EVIDENCE.md` | What the Source analysis found, with evidence |
| `docs/DECISIONS.md` | Design decisions and their limits |

## Where to change things

| Task | File |
| --- | --- |
| Add or reorder a context menu item | `src/menus.ts` |
| Add a git operation | `src/actions.ts`, then call it from `src/menus.ts` or `src/components/Toolbar.tsx` |
| Load more data from git | `src/repo.ts` (`loadRepo` and the `RepoData` type) |
| Change graph lanes or colors | `src/graph.ts` for lanes, `src/styles.css` (`--lane-*`) for colors |
| Change row height | `ROW_HEIGHT` in `src/components/GraphView.tsx` |
| Add a left panel section | `src/components/Sidebar.tsx` |
| Add a new IPC call | `electron/main.ts`, `electron/preload.ts`, `src/api.ts` |
| Change the build targets | `build` in `package.json` and `.github/workflows/build.yml` |
