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

Domain terms and their Rust names are in `rust/GLOSSARY.md`.

## Units

A session claims a unit before it starts: set the state to `claimed by <session> <date>`. When `rust-anything gate` passes, set the state to `done`.

| Wave | Unit | State | Notes |
| --- | --- | --- | --- |
| A | `electron/` to `rust/app` (Tauri shell) | done | 17 IPC handlers are Tauri commands. CI job `tauri`. |
| B | `src/graph.ts` | done | crate `rust/graph`, gate passed, 202/202 cases. Bench 0.08x through napi: call it from Rust only. |
| B | `src/diff.ts` | done | crate `rust/diff`, gate passed, 1149/1149 cases. Bench 0.34x through napi. |
| B | `src/merge.ts` | done | crate `rust/merge`, gate passed, 867/867 cases. Bench 0.27x through napi. |
| B | parsers in `src/repo.ts` | done | crate `rust/repo`, gate passed, 1971/1971 cases. Bench 0.13x through napi. Also `parse_worktrees`, `parse_remotes`, `parse_stashes`, `insert_stashes` with unit tests only. |
| C | `loadRepo` in `src/repo.ts` | done | `load_repo` command with gix default and CLI fallback (D40). 252 comparisons with TS equal. 3.8 ms against 42.1 ms on this repo. |
| D | `src/actions.ts` | done | `action` command with 58 actions in `rust/app/src/actions/` (D41). 164 scenarios equal with TS. |
| E | `src/menus.ts` | done | `context_menu` command builds 10 menu kinds in `rust/app/src/menus/`. `test/menus-rust.test.ts` compares the trees with TS. |

## Port rules

These rules come from mistakes in earlier units. Follow them in each new unit.

1. Run every `rust-anything` command with Node 24 on `PATH`. Node 26 removed a flag that `bench` uses.
2. In a new unit crate, set `serde` to `features = ["derive"]` and add `chunks_exact_to_as_chunks = "allow"` under `[lints.clippy]`. The generated `wire.rs` fails this lint on Rust 1.100.
3. Put typed core functions in an `impl` block. `refresh` exports every top-level `pub fn` in `port.rs`, and the build fails on `&` parameters. `rust/graph` has a top-level `pub fn layout`: move it before you run `refresh` on that crate.
4. A TS function that returns `string | null` needs a `serde_json::Value` return in the wrapper. `Option<String>` becomes `undefined` in JS.
5. Remove recorded cases larger than 1 MB from `cases.jsonl` before you commit.
6. Do not edit `lib.rs`, `wire.rs`, `js.rs` or `index.cjs`. `bridge` and `refresh` generate them.
7. Bench results through napi are below 1x for every Wave B unit. The app calls the ports from Rust, so the napi bench does not apply.

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
