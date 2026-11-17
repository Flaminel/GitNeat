# GitNeat

GitNeat is an open source Git client for macOS, Windows and Linux with repository tabs, a commit graph, and Source-style context menus.

## Features

- Repository tabs. Reorder, rename, close other tabs, and reopen closed tabs.
- Left panel. Local branches in folders, remotes, worktrees, stashes, tags, and submodules. Hide and solo items.
- Commit graph. Lanes, ref labels, and WIP and stash rows.
- Right panel. Commit details, file list in path or tree view, stage and unstage files, commit and amend.
- Diff view. Hunk and split modes.
- Context menus for commits, branches, tags, stashes, remotes, worktrees, files, and tabs.
- Interactive rebase with drop, reword, squash, fixup, and reorder.
- Merge and rebase conflict banner with continue and abort.

## Requirements

- Git 2.30 or later. Make the `git` command available on the PATH.
- On Windows, install Git for Windows.
- Node.js 24 and Rust (stable) to build the app.
- On Linux, the WebKitGTK and GTK development packages that Tauri needs.

## Build and run

Run these commands in the root folder of the repository.

1. Run `npm install` to install the dependencies.
2. Run `npm run dev` to start the app in development mode with hot reload.
3. Run `npm run build` to build the app for the current platform. The installers go to `rust/target/release/bundle/`.

Note: Build each platform on that platform.

## Tests

- Run `npm test` to run the unit tests.
- Run `GITNEAT_RUST_COMPARE=1 npm test` to also compare the Rust code with the TypeScript reference in `test/reference/`.
- Run `npm run typecheck` to check the TypeScript types.
- In `rust/`, run `cargo test`.

## Documentation

- [docs/REPO_MAP.md](docs/REPO_MAP.md): Map of the source files and where to change each task.
- [docs/DECISIONS.md](docs/DECISIONS.md): Design decisions and their limits.
- [docs/EVIDENCE.md](docs/EVIDENCE.md): Evidence from the Source analysis.

## Not included

GitNeat does not include Source account features, AI features, Cloud Patches, issue tracker integrations, or Teams. See [D11](docs/DECISIONS.md#d11-no-proprietary-service-features) in `docs/DECISIONS.md`.

## License

GitNeat is released under the GNU General Public License version 3 (GPL-3.0). See the `LICENSE` file.
