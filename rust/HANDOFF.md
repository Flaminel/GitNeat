# Handoff

Branch: `rust-rewrite`. Skill to load: `rust-anything`.

## State

- Wave A is done. `rust/app` runs the React UI on Tauri 2. All `window.gitneat` calls go to Rust commands. The renderer still holds all git logic in TypeScript.
- Wave B is next: `src/graph.ts`, `src/diff.ts`, `src/merge.ts` and the parsers in `src/repo.ts`. See `rust/MAP.md`.
- Nothing is in progress or broken.

## Checks

1. Run `npm test` and `npm run typecheck`.
2. In `rust/`, run `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`.
3. Run `npm run tauri:dev` to start the app.

## Not verified yet

- The Windows and Linux builds. CI job `tauri` builds them on the next push.
- The context menu result on Windows and Linux (D36).

## Read next

- `rust/MAP.md`
- D29 to D37 in `docs/DECISIONS.md`
