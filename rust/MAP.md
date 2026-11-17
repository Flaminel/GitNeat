# Rust port map

Goal: GitNeat as a Tauri 2 app with a Rust backend and the React UI. The Electron app on `main` stays as reference.

Read this file first in each session. Then read `rust/HANDOFF.md`.

## Decisions

The decisions are in `docs/DECISIONS.md`.

| Entry | Subject |
| --- | --- |
| D29 | Tauri 2, React UI stays |
| D30 | Faithful port first |
| D31 | Hybrid git backend (gix for hot reads, `git` CLI for the rest) |
| D32 | Targets: macOS, Windows, Linux |
| D33 | State file stays compatible |
| D34 | Proof per unit and checkpoints after each wave |
| D35 | Window chrome |
| D36 | Context menu result |
| D37 | Known differences of the Tauri shell |

Domain terms and their Rust names are in `rust/GLOSSARY.md`.

## Units

A session claims a unit before it starts: set the state to `claimed by <session> <date>`. When `rust-anything gate` passes, set the state to `done`.

| Wave | Unit | State | Notes |
| --- | --- | --- | --- |
| A | `electron/` to `rust/app` (Tauri shell) | done | 17 IPC handlers are Tauri commands. CI job `tauri`. |
| B | `src/graph.ts` | open | UTF-16 offsets at lines 39, 63 |
| B | `src/diff.ts` | open | UTF-16 offsets at lines 36, 55, 57 |
| B | `src/merge.ts` | open | |
| B | parsers in `src/repo.ts` | open | `parseLog`, `parseRefs`, `parseStatus`, `parseWorktrees`, `parseRemotes`, `parseNameStatus`, `samePath` |
| C | `loadRepo` in `src/repo.ts` | open | One `load_repo` command. Then the gix backend, the equality test and the benchmark (D31). |
| D | `src/actions.ts` | open | |
| E | `src/menus.ts` | open | |

## Research

| Topic | File | State |
| --- | --- | --- |
| `gix` status against `git status --porcelain=v1` | `rust/research/gix-status.md` | open (before wave C) |
| `gix` commit walk in date order, stash reflog | `rust/research/gix-revwalk.md` | open (before wave C) |
| Process start cost and `diff --no-index -- /dev/null` on Git for Windows | `rust/research/windows-git.md` | open (before wave C) |

## Open questions

- None.

## Out of scope

- The UI in `src/components/`, `src/App.tsx`, `src/RepoView.tsx`, `src/ui.tsx` and `src/main.tsx` stays React.
- Monaco and the fonts stay npm packages in the webview.
