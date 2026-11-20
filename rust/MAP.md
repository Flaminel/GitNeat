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
| D38 | Submodule paths come only from path keys |
| D39 | Git settings for speed on Windows |
| D40 | gix is the default backend for `load_repo` |
| D41 | Repository actions run in Rust |
| D42 | Context menus are built in Rust |
| D43 | Cutover to Tauri |
| D44 | PR builds start from a comment |
| D45 | The loaders and the graph layout run in Rust |
| D46 | The merge tool and the patch builders stay in TS |
| D47 | The merge load, the amend message, clone and init run in Rust |
| D48 | The `git` command is removed |

Domain terms and their Rust names are in `rust/GLOSSARY.md`.

## Units

A session claims a unit before it starts: set the state to `claimed by <session> <date>`. When `rust-anything gate` passes, set the state to `done`.

| Wave | Unit | State | Notes |
| --- | --- | --- | --- |
| A | `electron/` to `rust/core` (Tauri shell) | done | 17 IPC handlers are Tauri commands. CI job `tauri`. |
| B | `src/graph.ts` | done | crate `rust/graph`, gate passed, 202/202 cases. Bench 0.08x through napi: call it from Rust only. |
| B | `src/diff.ts` | done | crate `rust/diff`, gate passed, 1149/1149 cases. Bench 0.34x through napi. |
| B | `src/merge.ts` | done | crate `rust/merge`, gate passed, 867/867 cases. Bench 0.27x through napi. |
| B | parsers in `src/repo.ts` | done | crate `rust/repo`, gate passed, 1971/1971 cases. Bench 0.13x through napi. Also `parse_worktrees`, `parse_remotes`, `parse_stashes`, `insert_stashes` with unit tests only. |
| C | `loadRepo` in `src/repo.ts` | done | `load_repo` command with gix default and CLI fallback (D40). 252 comparisons with TS equal. 3.8 ms against 42.1 ms on this repo. |
| D | `src/actions.ts` | done | `action` command with 58 actions in `rust/core/src/actions/` (D41). 179 scenarios match `test/golden/actions.json` (D111). |
| E | `src/menus.ts` | done | `context_menu` command builds 10 menu kinds in `rust/core/src/menus/`. `test/menus-rust.test.ts` compares the trees with `test/golden/menus.json` (D111). |
| F | Cutover | done | Electron removed (D43). The TS reference was deleted (D111). Unit crates are plain libraries with `cargo test` replays. |
| G | loaders in `src/repo.ts`, `layoutGraph`, `parseDiff`, the merge tool load, the amend message, clone and init | done | 8 loader commands in `rust/core/src/loaders.rs` (D45, D47). `clone` and `init` actions. `test/loaders.test.ts` compares with `test/golden/loaders.json` on 14 fixtures (D111). Rows in `RepoData`. `src/graph.ts` deleted. The merge selections, the Output builder and the patch builders stay in TS (D46). |

## Port rules

These rules come from mistakes in earlier units. Follow them in each new unit.

The unit crates `rust/graph`, `rust/diff`, `rust/merge` and `rust/repo` are plain libraries now. The napi bridge is gone. Each crate replays its recorded `cases.jsonl` with `cargo test` (graph 202, diff 1149, merge 867, repo 1971). A case that differs fails the test.

1. Obsolete: napi needed Node 24 on `PATH`.
2. Obsolete: the generated `wire.rs` is gone.
3. Obsolete: the `port.rs` exports are gone. The `serde_json::Value` wrappers live in `port::wrappers` under `cfg(test)` and only the replay calls them.
4. Obsolete: the `Value` return type was for the napi wrapper.
5. Remove recorded cases larger than 1 MB from `cases.jsonl` before you commit.
6. Obsolete: `lib.rs` is hand-written now.
7. Obsolete: the app calls the ports from Rust, so the napi bench does not apply.

## Research

| Topic | File | State |
| --- | --- | --- |
| `gix` for each read in `loadRepo` (refs, log walk, stashes, worktrees, remotes, status, operation) | `rust/research/gix-load-repo.md` | done |
| Process start cost, read speed settings and `diff --no-index -- /dev/null` on Git for Windows | `rust/research/windows-git.md` | done |

## Open questions

- None.

## Out of scope

- The UI in `src/components/`, `src/App.tsx`, `src/RepoView.tsx`, `src/ui.tsx` and `src/main.tsx` stays React.
- Monaco and the fonts stay npm packages in the webview.
