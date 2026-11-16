# Krill

Krill is an open source Git client for macOS and Windows with repository tabs, a commit graph, and Source-style context menus.

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
- Node.js 24 to build the app.

## Build and run

Run these commands in the root folder of the repository.

1. Run `npm install` to install the dependencies.
2. Run `npm start` to build and run the app.
3. Run `npm run dev` to start development mode with hot reload.
4. Run `npm run dist:mac` to build the macOS app. The installers go to `release/`.
5. Run `npm run dist:win` to build the Windows installer. The installers go to `release/`.

Note: Build the Windows installer on Windows. Build the macOS app on macOS.

## Tests

- Run `npm test` to run the unit tests.
- Run `npm run typecheck` to check the TypeScript types.

## Screenshot smoke test

Use the screenshot smoke test to capture the app window without user input. Set these environment variables before you start the app.

- `KRILL_USER_DATA`: Folder for the saved state file.
- `KRILL_SCREENSHOT`: PNG file path. The app captures the window and quits.
- `KRILL_SCREENSHOT_DELAY`: Delay in milliseconds before the capture. The default is 2500.
- `KRILL_SCREENSHOT_JS`: JavaScript that runs in the page before the capture.

## Documentation

- [docs/REPO_MAP.md](docs/REPO_MAP.md): Map of the source files and where to change each task.
- [docs/DECISIONS.md](docs/DECISIONS.md): Design decisions and their limits.
- [docs/EVIDENCE.md](docs/EVIDENCE.md): Evidence from the Source analysis.

## Not included

Krill does not include Source account features, AI features, Cloud Patches, issue tracker integrations, or Teams. See [D11](docs/DECISIONS.md#d11-no-proprietary-service-features) in `docs/DECISIONS.md`.

## License

Krill is released under the MIT License. See the `LICENSE` file.
