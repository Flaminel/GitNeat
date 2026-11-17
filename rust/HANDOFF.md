# Handoff

Branch: `rust-rewrite`. Skill to load: `rust-anything`.

## State

- Waves A to E in `rust/MAP.md` are done. The cutover is done (D43): Electron is removed.
- `load_repo` uses gix (D40). Repository actions (D41) and context menus (D42) run in Rust. Dialogs, toasts and the undo stack stay in React.
- `test/reference/` holds the old TS logic. The comparison tests use it as the reference. The app does not load it.
- `rust/graph`, `rust/diff`, `rust/merge` and `rust/repo` are plain libraries. `cargo test` replays their recorded cases.
- These loaders in `src/repo.ts` still run `git` from TS through the `git` command: `loadCommit`, `loadAllFiles`, `loadDiff`, `loadSides`, `loadBlame`, `loadFileHistory`. The UI still calls `src/graph.ts`, `src/diff.ts` and `src/merge.ts`, not their Rust ports.
- Nothing is in progress or broken.

## Checks

1. Run `npm test` and `npm run typecheck`.
2. Run `GITNEAT_RUST_COMPARE=1 npm test` for the comparison tests. They take about 2.5 minutes.
3. In `rust/`, run `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`.
4. Run `npm run dev` to start the app.

## Not verified yet

- The Windows and Linux builds and the comparison tests on Windows. CI job `tauri` runs them on the next push.
- The context menu result on Windows and Linux (D36).
- The speed on Windows. Use `cargo run --release -p gitneat --example bench_load -- <repo>`.

## Next steps

1. Put the workflow of D44 on `main`, then comment `/build windows` on the pull request.
2. Measure `bench_load` on the Windows laptop.
3. Port the loaders that remain in `src/repo.ts`, and use the Rust graph, diff and merge ports from them.
4. Fix the known bugs, one change each (D30).

## Read next

- `rust/MAP.md`
- D29 to D44 in `docs/DECISIONS.md`
