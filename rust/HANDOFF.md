# Handoff

Branch: `rust-rewrite`. Skill to load: `rust-anything`.

## State

- Waves A to E in `rust/MAP.md` are done.
- The Tauri app runs on macOS. `load_repo` uses gix (D40). Repository actions (D41) and context menus (D42) run in Rust. Dialogs, toasts and the undo stack stay in React.
- `src/actions.ts`, `src/menus.ts` and `src/repo.ts` still hold the TS paths for Electron. The comparison tests use them as the reference.
- Nothing is in progress or broken.

## Checks

1. Run `npm test` and `npm run typecheck`.
2. Run `GITNEAT_RUST_COMPARE=1 npm test` for the comparison tests. They take about 2.5 minutes.
3. In `rust/`, run `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`.
4. Run `npm run tauri:dev` to start the app.

## Not verified yet

- The Windows and Linux builds and the comparison tests on Windows. CI job `tauri` runs them on the next push.
- The context menu result on Windows and Linux (D36).
- The speed on Windows. Use `cargo run --release -p gitneat --example bench_load -- <repo>`.

## Next steps

1. Push the branch so CI checks Windows and Linux.
2. Measure `bench_load` on the Windows laptop.
3. Cutover (D29): remove `electron/`, the Electron npm packages and the TS paths that only Electron uses.
4. Fix the known bugs, one change each (D30).

## Read next

- `rust/MAP.md`
- D29 to D42 in `docs/DECISIONS.md`
