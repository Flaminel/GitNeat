# Decisions

Each entry records one decision, the reason, and the known limits.
Add new entries at the end.
Do not edit old entries. Add a new entry that supersedes the old one.

## D1. Electron, React and TypeScript

- Decision: GitNeat uses Electron 45, React 19, TypeScript 5 and Vite 8.
- Reason: Source 11.9.0 uses Electron and React (see `docs/EVIDENCE.md`). Electron gives one code base for macOS and Windows.
- Limits: The app bundle is large (about 100 MB), the same as Source.

## D2. The git CLI is the backend

- Decision: All repository operations run the `git` executable through one IPC channel (`git` in `electron/main.ts`).
- Reason: Source uses nodegit (libgit2) and ships a git binary. Nodegit needs a native build for each platform and Electron version. The git CLI needs no native build and supports every git feature, including worktrees and interactive rebase.
- Limits: The user must install git. On Windows, install Git for Windows. Each operation starts a process. For very large repositories, this is slower than libgit2.

## D3. The renderer parses git output

- Decision: The main process only runs `git` and returns stdout, stderr and the exit code. The renderer builds the arguments and parses the output (`src/repo.ts`).
- Reason: One generic channel keeps `electron/main.ts` small. All git knowledge is in one place.
- Limits: The renderer can run any git command. The renderer loads only local bundled code, so this is acceptable. If GitNeat ever loads remote content, restrict the channel to a list of commands.

## D4. All tabs share one window and one renderer

- Decision: Repository tabs are React state in `src/App.tsx`. GitNeat has one `BrowserWindow`.
- Reason: The user asked for tabs, not windows. One renderer keeps tab switches fast and makes shared state simple.
- Limits: Only the active tab is mounted. A tab switch reloads that repository from git, but first shows its last loaded state (D49).
- Evidence: Source also keeps one live repository per window. It saves a store snapshot for each repository path and restores it on a tab switch (see `docs/EVIDENCE.md` section 4.1).

## D5. Native context menus

- Decision: The renderer describes a menu as data (`MenuSpec[]`). The main process shows it with `Menu.popup` and returns the ID of the clicked item.
- Reason: The Source screenshot shows native macOS menus. Native menus look correct on macOS and Windows with no extra code.
- Limits: Menu items cannot show custom icons or colors.

## D6. Graph lane layout

- Decision: `src/graph.ts` assigns lanes in one pass over commits in `--date-order`. Each row stores line segments from the top edge or middle to the middle or bottom edge. Each row draws its own SVG.
- Reason: Row-local drawing works with list virtualization. Only visible rows render.
- Rules: The first parent continues in the lane of the commit. Other parents reuse an existing lane or take the first free lane. Lanes that point to the same commit meet at the row of that commit. Lane slots are not compacted, so a lane keeps its position and color.
- Limits: Colors follow the lane slot, not the branch name. A reused slot can show a new color for a different branch.
- Superseded in part by D20: the color is now the column index.
- Superseded in part by D57: the edges use the Source arc shape, and the lane x moved.
- Evidence: Source also uses a 28 px row and SVG lane edges (see `docs/EVIDENCE.md` section 3).

## D7. Commit limit

- Decision: The graph loads at most 2000 commits.
- Reason: The log parse and layout stay below 100 ms for this size.
- Limits: Older history is not visible until the user scrolls to the end. D78 loads more.
- Superseded in part by D81: the first load is 2000 commits, and each later step adds 200.

## D8. Rebase operations use a prepared todo file

- Decision: Drop, move up, move down, edit message and interactive rebase all run `git rebase -i`. GitNeat writes the todo list to a temporary file. `GIT_SEQUENCE_EDITOR` is `cp "<todo file>"`. A new message for an older commit uses an `exec git commit --amend -F <file>` line.
- Reason: Git runs the editor commands through its own shell, so `cp` works on macOS and on Windows (Git for Windows includes `sh` and `cp`). No helper script is necessary.
- Limits: Rebase does not keep merge commits. GitNeat disables these actions when the range contains a merge commit.

## D9. In-progress operation detection

- Decision: GitNeat detects merge, rebase, cherry-pick and revert with the pseudo-refs `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD` and `REVERT_HEAD`.
- Reason: This needs no file system access in the renderer.
- Limits: A rebase that stops on a failed `exec` line has no `REBASE_HEAD`. GitNeat does not show the banner for it. To fix, check the `rebase-merge` directory in the git directory.

## D10. Stashes in the graph

- Decision: GitNeat shows each stash as a row above its base commit, with only one parent.
- Reason: The stash index commit and untracked commit add rows that have no meaning to the user.

## D11. No proprietary service features

- Decision: GitNeat does not copy AI recompose, Cloud Patches, Jira, Trello, Teams or the Source account.
- Reason: These features need Source servers.
- Alternative: "Start a pull request" opens the compare page of GitHub, GitLab or Bitbucket in the browser.

## D12. No avatars from external services

- Decision: Commit nodes show the initials of the author, not a Gravatar image.
- Reason: A Gravatar request sends a hash of each author email to a third party.

## D13. Undo and redo move HEAD back

- Decision: Each action records HEAD and the current branch before and after it runs. Undo moves back to the "before" state. Redo moves to the "after" state.
- Rules: If the branch changed, undo runs `git switch`. If only HEAD moved, undo runs `git reset --keep`. For a commit, undo and redo run `git reset --soft`, so the changes stay staged.
- Reason: Source has Undo and Redo in the toolbar. A HEAD snapshot covers commit, merge, rebase, reset, cherry-pick, revert and checkout with one mechanism.
- Limits: Undo cannot restore deleted branches, deleted tags, stash changes or pushes. Undo refuses to run if HEAD changed after the action. The stack is lost when the tab closes.

## D14. Screenshot hook for tests

- Decision: If `GITNEAT_SCREENSHOT` is set, the main process hides the window, runs `GITNEAT_SCREENSHOT_JS` in the page, saves a PNG and quits.
- Reason: The hook gives a repeatable visual check without a UI test framework.
- Limits: Native context menus do not show in the capture. `test/menus.test.ts` checks the menu content instead.

## D15. Left panel sections size to their content

- Decision: Each section header is always visible. An open section takes the height of its content. When the panel is full, the section shrinks and gets its own scroll bar.
- Reason: This is the Source layout. The first version scrolled the whole panel, so lower sections went out of view.

## D16. Menu tests use a fake bridge

- Decision: `test/menus.test.ts` replaces `window.gitneat` with a fake. The fake records the menu and answers the git calls that the menu needs.
- Reason: The menu order is the main Source behavior to keep. The tests compare it to the order in the reference screenshot.
- Tool: `tsx` runs the tests, because the app imports modules without file extensions.

## D17. Branch drag and drop

- Decision: You can drag a branch label in the graph onto the label of another branch. GitNeat then shows a menu with merge, rebase, interactive rebase, fast-forward and push.
- Reason: Source has the same drag and drop behavior.

## D18. Theme colors come from the Source dark theme

- Decision: `src/styles.css` uses the background, panel, text and accent values from `docs/EVIDENCE.md` section 7. The 10 lane colors are the Source `--graph-color-0..9` values.
- Superseded in part by D21: GitNeat now uses Open Sans.

## D19. The diff view uses Monaco

- Decision: Inline view and split view use the Monaco diff editor (`renderSideBySide` false or true). Hunk view is a GitNeat table with Monaco syntax colors.
- Reason: Source uses the Monaco diff editor for inline and split view (see `docs/EVIDENCE-DIFF.md` section 2). The default mode is hunk, as in Source.
- Rules: GitNeat loads Monaco from `node_modules`, not from a CDN. One editor worker computes the diff. Language services (TypeScript, JSON, CSS, HTML workers) are not loaded. Syntax colors come from the Monarch grammars.
- Staging: Hunk view has a 26 px strip on each hunk with Discard Hunk and Stage Hunk (unstaged), Unstage Hunk (staged) or Revert Hunk (commit). Lines are selected in the line number columns. Monaco views have "Stage selected lines", "Unstage selected lines" and "Discard selected lines" in the editor context menu.
- Patches: `src/diff.ts` builds the patch for a hunk or for selected lines. `git apply --recount` applies it. `test/diff.test.ts` checks the patches against a real repository.
- Limits: The hunk view uses `dangerouslySetInnerHTML` for the output of `monaco.editor.colorize`. Monaco escapes the file text. Files with more than 20000 changed lines show without syntax colors. "Ignore whitespace" turns off staging, because the patch then does not match the file.

## D20. Lane color is the column index

- Decision: Each lane takes the color of its column (`--lane-0` for column 0, and so on). A curve between two columns takes the color of the higher column.
- Reason: The Source screenshot shows the same color for all commits in one column.

## D21. Open Sans at 12 px

- Decision: GitNeat bundles Open Sans with `@fontsource/open-sans` and uses a 12 px base size.
- Reason: Source uses Open Sans and a root size of 62.5 % with 1.2 rem text. A side by side screenshot showed 8 to 11 % wider text before this change.

## D22. Hardening after the code review

- Decision: The main process blocks `-c`, `--upload-pack`, `--receive-pack`, `--exec` and `--config-env` in the `git` IPC call. `open-path`, `show-item`, `read-file` and `write-file` accept only paths inside an open repository. The file watcher closes itself on error. `GIT_OPTIONAL_LOCKS=0` stops background `git status` calls from taking `index.lock`.
- Reason: A renderer bug must not run commands or open files outside the repository. The lock prevents failed commits during a refresh.
- Rules: User-typed names (branches, tags, remotes) that start with `-` or contain characters that git does not allow are rejected in the dialog. `git clone` puts `--` before the URL.

## D23. Edit This File

- Decision: For an unstaged file, "Edit This File" makes the right side of the Monaco diff editable. "Save Changes" writes the file through the `write-file` IPC call.
- Reason: Source has the same button in the diff toolbar.
- Limits: GitNeat does not warn if the file changes on disk during the edit.

## D24. Branch menus use ref groups

- Decision: A local branch and a remote branch with the same name on the same commit form one group. The graph branch menu works on the group. `refGroups` in `src/menus.ts` builds the groups.
- Reason: The Source menu builder (`getRefGroupMenuItems` in `render.bundle.js`) works on ref groups. The user's screenshot of the branch menu shows the result.
- Rules: If a group has more than one checkout target, "Checkout" is a submenu with each ref and "this commit". "Create worktree from" uses the same rule. "Pull (fast-forward if possible)", "Push" and "Set Upstream" show for every local branch when the repository has a remote. "Hide" shows only in the left panel. "Create patch from commit" shows only in the graph.
- Merge items follow the Source merge states. If HEAD is behind the branch, the menu shows "Fast-forward". If the branch is behind HEAD, the menu shows "Fast-forward <branch> to <current>". Otherwise the menu shows "Merge".
- Limits: GitNeat does not copy "Explain Branch Changes" or "Share commit as Cloud Patch" (see D11). If HEAD is behind the branch, Source labels the second item "Merge <current> into <branch>". GitNeat labels it "Merge <branch> into <current>" and runs `git merge --no-ff`.

## D25. Hunk view renders from a full-file model

- Decision: The hunk view tokenizes the new file in a Monaco model. Each added or context line takes its colors from that model. Bracket colors come from the bracket pairs of the model (gold, orchid, blue for nesting levels 0, 1, 2).
- Reason: The Source screenshots show bracket pair colors in the hunk view. Tokens from the full file are also correct inside multi-line comments and strings.
- Rules: Deleted lines show without syntax colors, as in Source. If a delete block and an add block are next to each other, each delete line pairs with an add line. The changed part between the common prefix and suffix gets a stronger background.
- Limits: `renderModelLine` uses `tokenization` and `bracketPairs`, which are internal Monaco APIs. If a Monaco update removes them, the hunk view falls back to plain text.

## D26. File View and Edit in Working Directory

- Decision: The diff toolbar has the Source "File View" and "Diff View" toggle. File View shows the full file in a Monaco editor. For a commit or a staged file, "Edit in Working Directory" opens the working copy of the file in File View for editing.
- Reason: The Source screenshots show this toolbar.

## D27. Merge conflict tool

- Decision: Click a conflicted file in the WIP panel to open `MergeView` in the center instead of `DiffView`. A and B panes sit side by side. The Output pane sits below them. `src/merge.ts` holds the logic and has no `window` imports.
- Reason: The Source screenshots and strings show this three pane layout (see section 6 of `docs/EVIDENCE-DIFF.md`).
- Rules: `git show :2:` and `:3:` give the A and B blobs. `git merge-file -p --diff3` on the stage blobs gives the conflict chunks. An exit code above 127 is an error. A selection per conflict is an ordered list of picked lines. The Output text comes from `buildOutput`. A new pick replaces the Output text. Save writes the file and runs `git add`. For unresolved conflicts, a menu offers Save Output, Create Conflict Chunks and Cancel. A missing stage 2 or 3 shows "Keep Modified Version" and "Delete The File". A binary file shows "Take A" and "Take B".
- Limits: `merge-file` merges non-conflicting changes by itself. The A and B panes show each side with those changes applied, not the raw stage blob. Scroll sync uses pixels, so the two panes can differ in line alignment. "Create Conflict Chunks" ignores manual edits in Output. GitNeat does not copy the Premium gate on Output editing.

## D28. Left panel collapse

- Decision: The sidebar header has a "Collapse Panel" button. Cmd+J (Ctrl+J on Windows and Linux) toggles the collapse. A collapsed panel is a 32px rail with an "Expand Panel" button and one icon per section with its count. Clicking a section icon expands the panel and opens that section. The collapsed flag is saved in local storage.
- Reason: Source uses `view:toggleRefPanel` on Cmd+J and shows the same rail.
- Rules: The shortcut does nothing while focus is in an input, a textarea or a Monaco editor. The splitter is hidden while the panel is collapsed.

## D29. Rust rewrite on Tauri 2

- Decision: On the `rust-rewrite` branch, a Tauri 2 app in `rust/app` replaces Electron. The React UI stays. The Rust crate implements every `window.gitneat` call as a Tauri command.
- Reason: Electron is large and slow on Windows. Tauri keeps the UI and moves the backend to Rust.
- Rules: `src/tauri-api.ts` sets `window.gitneat` when `__TAURI_INTERNALS__` exists. Electron does not load it, so both shells run the same UI.
- Limits: This entry supersedes D1 only on the `rust-rewrite` branch. `electron/` stays as reference until cutover.

## D30. Faithful port first

- Decision: Each unit moves to Rust with the same behavior as the TypeScript or Electron code. Bug fixes come after the port, one change each.
- Reason: If a port also fixes bugs, a difference from the old app can be a fix or a new bug. A faithful port keeps the two apart.

## D31. Hybrid git backend

- Decision: Reads on the hot path (refs, log, stashes, worktrees, status, operation state) move in-process to `gix` when a benchmark proves a gain and a test proves equal results. Writes, network operations, hooks, signing, `merge-file`, `blame` and diff text stay on the `git` CLI.
- Reason: `loadRepo` in `src/repo.ts` starts about 15 `git` processes per refresh. A process start is slow on Windows.
- Limits: This entry refines D2. Until the benchmark exists, all calls use the CLI.

## D32. Targets

- Decision: The Tauri app builds for macOS, Windows and Linux. CI job `tauri` in `.github/workflows/build.yml` builds the dmg, msi, nsis, AppImage and deb bundles.

## D33. State file stays compatible

- Decision: The Tauri app reads and writes `gitneat-state.json` in the Electron `userData` folder: `~/Library/Application Support/GitNeat` on macOS, `%APPDATA%\GitNeat` on Windows and `~/.config/GitNeat` on Linux. `GITNEAT_USER_DATA` overrides the folder.
- Reason: Open tabs and recent repositories carry over from the Electron app.
- Rules: `serde_json` has the `preserve_order` feature, so the key order and the 2-space indent match `JSON.stringify(data, null, 2)`.

## D34. Port proof and checkpoints

- Decision: Each unit gets its proof from `rust-anything record`, `diff` and `gate`. Work stops for approval after each wave in `rust/MAP.md`.
- Reason: `rust-anything app record` and `app replay` support only CLIs, HTTP servers and libraries.

## D35. Window chrome in Tauri

- Decision: On macOS, the window uses the overlay title bar with the traffic lights at 12, 11. On Windows and Linux, the window has no decorations. `WindowControls` in `src/components/Tabs.tsx` draws the minimize, maximize and close buttons.
- Reason: Tauri has no equivalent of the Electron `titleBarOverlay`.
- Rules: `data-tauri-drag-region` on the tab bar moves the window. `-webkit-app-region` stays for Electron.
- Limits: The maximize button does not show the Windows 11 snap layout flyout.

## D36. Context menu result in Tauri

- Decision: The `menu` command shows the menu, waits for it to close, and then reads the chosen id in a task on the main thread.
- Reason: The popup call blocks until the menu closes on all three platforms. The click event reaches the event loop before the queued task. This matches the `setTimeout` in the Electron handler.
- Rules: Item ids get the prefix `gitneat:`. Items without an id do nothing, as in Electron.

## D37. Known differences of the Tauri shell

- Limits: `GITNEAT_SCREENSHOT` and the related variables do nothing in the Tauri app. The `git` command has no 512 MB output limit. A watcher error does not remove the watcher. The error text for a missing `git` executable is different.

## D38. Submodule paths come only from path keys

- Decision: `loadRepo` reads submodule paths with `git config -f .gitmodules --get-regexp '^submodule\..*\.path$'`.
- Reason: The old pattern `path` matched every key that contains "path". A submodule named `path-utils` added its URL to the list of paths.
- Rules: The TS and the Rust `load_repo` use the same pattern. `test/load-repo.test.ts` checks the list for the `submodules` fixture.

## D39. Git settings for speed on Windows

- Decision: On Windows, `run_git` in `rust/app/src/git.rs` sets `core.fscache=true` and `core.preloadindex=true` through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n` and `GIT_CONFIG_VALUE_n`. The env from the caller comes after, so the caller wins.
- Reason: `core.fscache` caches file status for whole folders on Git for Windows. These variables do not change the config of the user. See `rust/research/windows-git.md`.
- Limits: GitNeat does not call `mingw64\bin\git.exe` directly. That path skips the `cmd\git.exe` wrapper process, but the wrapper sets `PATH`, `HOME` and `MSYSTEM` for hooks and ssh. Measure it on Windows before it is added. `core.untrackedCache` and `core.fsmonitor` stay off: the first writes the index, the second starts a daemon.

## D40. gix is the default backend for `load_repo`

- Decision: `load_repo` reads the repository with gix in-process (`rust/app/src/load_gix.rs`). `GITNEAT_BACKEND=cli` forces the `git` CLI path in `rust/app/src/load.rs`. If gix returns an error, `load_repo` runs the CLI path.
- Reason: On macOS, a refresh with limit 3000 takes 42.1 ms with the CLI and 3.8 ms with gix on this repository. On glasshouse it takes 60.1 ms and 14.2 ms. Process starts cost more on Windows, so the gain there is larger.
- Rules: gix produces the same text that the CLI produces. The parsers in `rust/repo` read it. The log order is a port of the git date order, not the gix date order (see `rust/research/gix-load-repo.md`). `test/load-repo.test.ts` compares both backends with the TS `loadRepo` on 21 fixtures and 6 variants.
- Limits: gix returns an error, and the CLI path runs, for a bare repository, a shallow repository, `info/grafts`, `refs/replace/`, sparse checkout, and a `cwd` that is not the repository root. No test covers the Windows-specific cases (`core.symlinks=false`, `core.ignoreCase`). The comparison test runs on Windows in CI job `tauri`.

## D41. Repository actions run in Rust

- Decision: The git logic of each action in `src/actions.ts` runs in `rust/app/src/actions/`. One Tauri command `action(cwd, name, args)` dispatches by name. Prompts, confirms, toasts, the undo stack, refresh and tab changes stay in TS.
- Reason: The user chose a full port of `src/actions.ts`.
- Rules: If an action needs a second answer from the user after a git failure, Rust returns `needs-confirm:<kind>:<git error text>`. The kinds are `force-delete`, `force-push` and `rewrite`. TS asks and calls the action again with the answer. An action that goes through `run` returns `{record}` for the undo stack.
- Limits: The TS sequences stay in `src/actions.ts` for Electron until cutover. `test/actions.test.ts` runs each action through both paths on identical fixture repos and compares the result, the UI calls and the repository state. The full compare suite takes about 2 minutes.

## D42. Context menus are built in Rust

- Decision: The Tauri command `context_menu(cwd, kind, args)` builds the menu tree in `rust/app/src/menus/`, shows it with the popup of D36 and returns the chosen id. `src/menus.ts` calls it when `window.gitneat.contextMenu` exists. Then it runs the handler that has the returned id. Without `contextMenu`, the TS code builds and shows the menu as before (Electron).
- Reason: The user chose a full port of `src/menus.ts`.
- Rules: Each TS item has a stable `id`: the handler name, then an index when a list gives several items (`checkout:0`, `reset:hard`, `pushTag:1`). Items inside a ref group submenu of a commit with several branches get the prefix `g<n>:`. Items without a handler (submenu parents) have no id. TS builds the items again after the choice and looks up the handler by id. `showMenu` uses `item.id` when it exists.
- Limits: `test/menus-rust.test.ts` compares the trees of 24 repository fixtures and checks that each id runs the same handler on both paths. Rust lowercases only ASCII in the host of "View on" and does not punycode it.

## D43. Cutover to Tauri

- Decision: GitNeat is a Tauri app only. `electron/`, `tsconfig.electron.json`, the Electron npm packages and the CI job `build` are removed. `npm run dev` and `npm run build` run Tauri.
- Reason: Waves A to E moved the main process, `loadRepo`, the actions and the context menus to Rust.
- Rules: This entry supersedes D1. `GITNEAT_SCREENSHOT` and the related variables are gone (D37). The release job on `v*` tags uses the bundles of job `tauri`.

## D44. PR builds start from a comment

- Decision: A pull request does not start a build. A comment `/build` on the pull request starts the build on macOS, Windows and Linux. `/build windows`, `/build mac` and `/build linux` start one platform. Pushes to `main`, `v*` tags and a manual run (`workflow_dispatch`) still start a build.
- Reason: The full build takes too long to run on each push to a pull request.
- Rules: Only the owner, members and collaborators of the repository can start a build. The build checks out the head of the pull request. The `plan` job adds a rocket reaction to the comment. The workflow has read access to the contents by default.
- Limits: GitHub runs `issue_comment` workflows from the file on the default branch. The comment trigger works only after this workflow is on `main`. The build does not show as a check on the pull request. Open the Actions tab to see it.

## D45. The loaders and the graph layout run in Rust

- Decision: The Tauri commands `load_commit`, `load_all_files`, `load_diff`, `load_sides`, `load_blame` and `load_file_history` in `rust/app/src/loaders.rs` replace the TS loaders in `src/repo.ts`. `load_repo` computes the graph rows with `graph::port::layout` and returns them in `RepoData.rows`.
- Reason: These loaders were the last git logic in TS. One IPC call per loader replaces one IPC call per `git` run.
- Rules: Each loader runs the same `git` arguments as the TS version, through `actions::git` or `actions::raw`. So the blocked option check and the error text stay the same. `load_diff` returns the parsed diff from `diff::port::ParsedDiff`, not the diff text. If the status is not empty, the rows include the `WIP` row first, with `HEAD` as its parent, as `src/RepoView.tsx` did. `load_sides` reads the working file only inside an open repository, as `read_file` does.
- Proof: `test/loaders.test.ts` compares 2425 calls with the TS loaders in `test/reference/repo.ts` on 8 fixtures. `test/load-repo.test.ts` compares the rows with `layoutGraph` in `test/reference/graph.ts`.
- Limits: `read_blame` returns an error for a porcelain line before the first header line. The TS version gave a different result there. `git blame --porcelain` does not produce such a line.

## D46. The merge tool and the patch builders stay in TS

- Decision: `src/merge.ts` and the patch builders in `src/diff.ts` (`hunkPatch`, `linesPatch`, `linesInRange`) stay in TS. The Rust ports in `rust/merge` and `rust/diff` stay as tested libraries.
- Reason: The merge tool and the line selection call these functions on each click. An IPC call per click is slower than the TS call. They run no `git` command.
- Limits: The TS and the Rust versions of these functions can drift. The recorded cases in `rust/merge` and `rust/diff` cover only the Rust side.

## D47. The merge load, the amend message, clone and init run in Rust

- Decision: The Tauri command `load_merge` replaces `load` and `bLabel` in `src/components/MergeView.tsx`. `load_head_message` replaces the `git show` call for amend in `src/components/DetailPanel.tsx`. The actions `clone` and `init` replace the `git` calls in `src/App.tsx`.
- Reason: The user asked to move all git logic out of TS. After this change, no code in `src/` calls the `git` command.
- Rules: `load_merge` parses the `git merge-file` output with `merge::port::Typed::parse_segments`, so `parseMerge` moves to `test/reference/merge.ts`. The selection and Output functions of D46 stay in TS. `src/App.tsx` still makes the folder name from the URL, because the task label shows it.
- Proof: `test/loaders.test.ts` compares `load_merge` on text, binary and delete conflicts for each operation, and `load_head_message` on each fixture. It runs clone and init through both paths and compares the result and the repository state. The suite has 2905 comparisons on 14 fixtures.
- Limits: The `git` command and `GitNeatApi.git` stay, because the TS reference in `test/reference/` calls them. Blame lines of uncommitted changes have the current time, so the test accepts a time difference up to the run time of the fixture for these lines only.

## D48. The `git` command is removed

- Decision: The Tauri command `git` and `GitNeatApi.git` are removed. The webview reaches git only through the named commands and actions in `rust/app`.
- Reason: After D47, no code in `src/` called the `git` command. The command let the webview run `git` with any arguments. This entry supersedes the channel of D2 and D3 and the limit of D3.
- Rules: `test/reference/api.ts` adds `git` and `GitResult` to the API type for the TS reference. The comparison tests mock `window.gitneat.git` with Node. `git::blocked` stays, because `actions::raw` checks each git call with it.

## D49. A tab switch shows the last loaded state of the repository

- Decision: `src/RepoView.tsx` keeps a cache in the module, with one entry for each repository path. An entry holds the `RepoData`, the selected commit, the multi-select, and the undo and redo stacks. When a tab mounts, its state starts from the entry, and `load()` then refreshes the repository in the background.
- Reason: On a slow Windows laptop, a tab switch showed "Loading…" until git returned. Source also restores a store snapshot for each repository path on a tab switch, and then refreshes from disk (see `docs/EVIDENCE.md` section 4.1).
- Rules: `RepoView` writes the entry on each change of these values. `src/App.tsx` calls `forgetRepos` when the tab list changes. It removes the entries of closed tabs. The open diff, the rebase modal, the graph scroll position and the file watcher are not cached. Source does not cache the diff, the modals or the graph scroll either.
- Limits: Until `load()` returns, the tab shows the state from its last visit. An action in that time uses this data. Each open tab keeps one `RepoData` in memory, a few MB for 2000 commits. A tab that is reopened after it was closed loads from git again.

## D50. The parity plan lives in an artifact with a task store

- Decision: The list of gaps between GitNeat and Source 11.9.0 is a private claude.ai artifact, "GitNeat Parity Plan" (https://claude.ai/artifact/YTgdQpC5mdTiZbnmzdfRTt). Its `tasks` collection holds one document for each task, T01 to T37. An implementing agent sets a task to `doing`, then to `done` with the commit sha, or to `blocked` with the reason.
- Reason: The user asked for a plan that agents implement one task at a time and mark as done. The store gives one status for each task without a commit for each status change.
- Rules: The `order` field sets the sequence. Each task names its evidence section in `docs/EVIDENCE.md` (sections 9 to 13). The page shows the agent prompt.
- Limits: The artifact is private to its owner. An agent needs the ArtifactData tool to change a status. The task text is a snapshot of 2026-11-18. The user saw the gaps of T01 to T04 before the Rust rewrite. An agent must check each gap and each file and line reference against the current code. If the gap is gone, the agent sets the task to `done` with the note "already at parity".

## D51. A tab without a path is a NEW tab

- Decision: `Tab.path` is optional. A tab without a path shows `src/components/NewTab.tsx`. The "+" button and Cmd+T add a NEW tab. A click on a recent repository opens it in the current NEW tab. The Open button opens the folder picker.
- Reason: Source 11.9 opens a NEW tab from "+" and Cmd+T, and opens a repository in that tab (see `docs/EVIDENCE.md` section 9). Task T01 of the parity plan (D50).
- Rules: If the active tab is a NEW tab, `openTab` replaces it with the repository. If another tab has the repository open, `openTab` selects that tab and keeps the NEW tab. When the last tab closes, one NEW tab stays. On start, an empty tab list gets one NEW tab. Closed NEW tabs do not go to the reopen list. The search box shows when the Recent list has more than 10 entries. It matches the name or the path, without case. Escape clears it.
- Limits: Cmd+O no longer opens the folder picker. The Favorite section is not shown until task T24 adds favorites. The Recent list holds 20 entries, and GitNeat does not show a missing folder as unreachable. The `.welcome` page is removed.

## D52. A click on the commit sha shows "Copied!"

- Decision: In `CommitInfo` in `src/components/DetailPanel.tsx`, a click on the short sha copies the full sha. After the copy, the text "Copied!" shows next to the sha for 1 s. A right click on a parent sha opens a menu with "Copy sha".
- Reason: The copy had no feedback, so the click looked like it did nothing. Source changes the tooltip from "Copy" to "Copied!" (see `docs/EVIDENCE.md` section 10). Task T02 of the parity plan (D50).
- Rules: "Copied!" shows only after the `clipboard` command returns without an error. The tooltip of the sha is "Copy".
- Limits: GitNeat uses the native `title` tooltip, which cannot change while it shows. For this reason, the text shows next to the sha and not in the tooltip. It goes after 1 s, not when the mouse leaves.

## D53. A click on the commit message amends or rewords it

- Decision: In `CommitInfo` in `src/components/DetailPanel.tsx`, a click on an editable message opens an edit mode. The edit mode has a summary input, a description textarea, an "Update Message" button and a cancel button. `saveMessage` in `src/actions.ts` amends HEAD or rewords an older commit through the rebase plan.
- Reason: Source edits the message in place in the right panel (see `docs/EVIDENCE.md` section 10). Task T03 of the parity plan (D50).
- Rules: `rewordDepth` returns the number of commits above the commit, or null if the commit cannot be edited. The walk starts at HEAD and follows the first parent. Each commit above the target must have one parent. The target must have one parent or none, but HEAD can be a merge commit. If an operation (merge, rebase, cherry-pick or revert) runs, no commit is editable. An editable message has the class `editable-message` with a blue border on hover. The tooltip is "Click to amend your commit message" for HEAD and "Click to reword your commit message" for other commits. For an older commit, the edit mode shows "Rewording this commit message will cause N commits to be rebased.", with N = depth + 1. The cancel button is "Cancel Amend" for HEAD and "Cancel Reword" for other commits. If the new message is equal to the old message, the save closes the edit mode and runs no git command.
- Limits: The context menu item "Edit commit message" still opens the modal prompt, but it uses the same `saveMessage` function. The menu shows the item for merge commits and for commits below a merge. GitNeat cannot amend a stash message. After the save, `RepoView` selects HEAD, because the old sha is gone. The selection does not follow the rewritten commit. The tooltip is the native `title`, without the 250 ms delay.

## D54. The commit message box has a fixed height and scrolls

- Decision: In `CommitInfo` in `src/components/DetailPanel.tsx`, the message box has a fixed height. A long message scrolls inside the box. A handle below the box changes the height. `useStoredWidth("message", 130)` in `src/ui.tsx` saves the height.
- Reason: A long message overlapped the author block and the file list. Source gives the message container a saved height, a bottom resize handle, `overflow-x: hidden` and a scrollable description (see `docs/EVIDENCE.md` section 10). Task T04 of the parity plan (D50).
- Rules: `.message-box` has `overflow-y: auto`, `overflow-x: hidden` and `overflow-wrap: anywhere`, so a long word breaks. The height is 130 px at first, 60 px minimum and 600 px maximum. `Splitter` has a `vertical` prop for a row handle. The handle sets the class `resizing-row` on the body while the drag runs.
- Limits: The height is a value in the app state file (D55), not a profile setting. A short message keeps the full box height. The 600 px maximum does not depend on the panel height, so a tall box can make the file list small. The edit mode does not use the saved height.

## D55. Layout sizes and view options live in the app state file

- Decision: `State` in `src/App.tsx` has a `layout` object. `storeSet` writes it to `gitneat-state.json` with the tabs. `useStored` in `src/ui.tsx` reads and writes one key of `layout` through `LayoutContext`. `useStoredWidth` and `useStoredFlag` use `useStored`.
- Reason: The webview localStorage is lost after a webview data reset or a change of the app identifier. Source keeps panel sizes in the profile settings (see `docs/EVIDENCE.md` section 10). Task T38 of the parity plan (D50).
- Rules: The keys are `left`, `right`, `refs`, `graph`, `message`, `author`, `date`, `sha`, `col.ref`, `col.graph`, `col.message`, `col.author`, `col.date`, `col.sha` (D77), `left.collapsed`, `diff.mode`, `diff.ignoreWhitespace`, `diff.wordWrap`, `graph.description` (D58) and `pull.default` (D63). The setter of the hook takes a `save` flag, true by default. While a drag runs, `Splitter` calls the setter with `save` false, so only the local state changes. On mouseup, `Splitter` calls the setter one time with `save` true, so a drag writes the file one time. Source also saves the size on resize end (see `docs/EVIDENCE.md` section 10). A click on a diff option writes the file at once. If the saved file has no `layout` key, `legacyLayout` copies the old `gitneat.width.*`, `gitneat.flag.*` and diff option values from localStorage. After that, GitNeat does not read localStorage. `layout` is a separate key from `prefs`, because `prefs` holds values for each repository and `layout` holds values for the app.
- Limits: GitNeat does not delete the old localStorage keys. A value of the wrong type in the file falls back to the default.

## D56. The state file is written to a temporary file and renamed

- Decision: `set` in `rust/app/src/store.rs` writes `gitneat-state.json.tmp`, then renames it to `gitneat-state.json`.
- Reason: Before this change, the write emptied the file and then wrote it again. A crash during the write lost the tabs, the recent list, the prefs and the layout.
- Rules: A `tokio::sync::Mutex` lets only one write run at a time, so two `store_set` calls do not write the same temporary file together.
- Limits: The rename does not call `fsync`. After a power loss, the operating system can keep the old file or an empty file.

## D57. Graph geometry follows Source

- Decision: `src/components/GraphView.tsx` draws each edge between two lanes as a vertical stub, an arc of radius 8 and a horizontal run at the row middle. The lane x is `28 + col * 22 + 11`. The automatic graph width is `lanes * 22 + 62`, with the 360 px cap kept.
- Rules: Each row has a band in the lane color from the node center to the right end, at 10 % (50 % when selected). Hover adds `rgba(77,136,255,.1)` over the full row. The ref connector is 1 px at 25 % opacity, and 2 px at 100 % on the HEAD row. Pills use the opaque `--lane-N-bg25`, `-bg45` (hover) and `-bg50` (current or selected) tints, radius 2 and padding 5 px.
- Nodes: the commit ring is 22 px with an 18 px avatar. The merge dot is 12 px. The stash node is a 22 px square with a dotted border. The WIP node is a 22 px circle with a dotted border. A stash message is italic and dim.
- Search: a row that does not match the search keeps its graph and pills. Its text color becomes `--text-dimmed` with a 0.2 s transition.
- Header: 26 px with 12 px labels in sentence case. The message cell has no divider. The date label is 10 px with radius 2 at `right: 0`.
- Reason: `docs/EVIDENCE.md` sections 3 and 13.
- Limits: The selected row no longer has the blue `--selected` background. The 50 % lane band marks it. Task T39 adds the commit description after the subject. No side by side screenshot was taken: the screen was locked during T05.

## D58. The graph shows the commit description after the subject

- Decision: `Commit` has an optional `body`. `read_log` in `rust/repo/src/port.rs` reads the full message from a seventh field and makes the body with `describe`. Both loaders write the full message into that field: `%B` in `rust/app/src/load.rs`, the raw message in `rust/app/src/load_gix.rs`. `GraphView` shows the body after the subject in `.message-body` at opacity 0.6.
- Reason: Source shows the description in the graph (see `docs/EVIDENCE.md` section 11). Task T39 of the parity plan (D50).
- Rules: `describe` follows `updateSummaryAndBody` of Source. It trims the message, takes the text after the first newline, trims it and joins the lines and paragraphs with " | ". A stash row has no body. The key `graph.description` in `layout` (D55) holds `always`, `hover` or `never`. The default is `always`, as in Source. A right click on the graph header opens the menu "Show commit description in graph" with the three values. A check mark shows the current value. The class `desc-<value>` on `.graph-view` hides the body with CSS.
- Proof: on the Whisparr repository (13749 commits, limit 3000), the median load time went from 89.9 ms to 93.1 ms with gix and from 355.1 ms to 361.4 ms with the git CLI. The recorded cases have eight new `parseLog` cases from the TS reference. The `subjectspaces` fixture has a commit with three paragraphs.
- Limits: The summary stays the git subject, so a subject on two lines shows in the subject and again in the body. The search does not match the body. `load_file_history` does not read the body. The native menu has no check items, so the current value has a "✓ " prefix in its label. Source puts the setting in Preferences and in the column settings. No screenshot was taken: the screen was locked during T39.

## D59. Repository keyboard shortcuts

- Decision: Ctrl+Tab and Ctrl+Shift+Tab switch to the next and the previous tab. The handler in `src/App.tsx` no longer uses Cmd+Tab, because macOS uses Cmd+Tab for the app switcher. One keydown handler in `src/RepoView.tsx` runs the repository shortcuts: Cmd+Z undo, Cmd+Y and Cmd+Shift+Z redo, Cmd+B create branch, Cmd+L fetch all, Cmd+Shift+S stage all, Cmd+Shift+U unstage all, Cmd+Shift+M focus the commit message, and Cmd+J (D28).
- Reason: Source uses these shortcuts (see `docs/EVIDENCE.md` section 9). Task T06 of the parity plan (D50).
- Rules: On Windows and Linux, Ctrl replaces Cmd. A repository shortcut does nothing while the focus is in an input, a textarea, a select or a Monaco editor. Alt with the shortcut does nothing. Cmd+B does nothing without a HEAD commit. Cmd+Shift+S and Cmd+Shift+U do nothing when no file is in the matching list. Cmd+Shift+M selects the WIP row and focuses the commit summary. It does nothing when the work tree has no changes.
- Limits: Cmd+Z in an input stays the text undo of the browser. Cmd+Shift+M does not work from inside an input. No manual check in the app: the screen was locked during T06.

## D60. Graph keyboard navigation

- Decision: In the graph, Shift+Up and Shift+Down extend the selection by one row. `H` selects the HEAD commit. The handler in `src/components/GraphView.tsx` keeps a cursor at the moving end of the range and calls the select callback of `src/RepoView.tsx` with the `range` mode. The detail panel shows a second value, `shown`. `shown` follows the selection at once, except while the user holds an arrow key. When the key repeats, `shown` stops. On key up, `shown` takes the current selection.
- Reason: Source uses `selectPrevious(e.shiftKey)`, `selectNext(e.shiftKey)`, `selectHead` and loads the detail on key up (see `docs/EVIDENCE.md` section 11). Task T07 of the parity plan (D50).
- Rules: The graph keys do nothing while the focus is in an input, a textarea, a select or a Monaco editor. The graph keys do nothing with Cmd, Ctrl or Alt. Shift+H does nothing. `H` does nothing without a HEAD commit. The range skips the WIP row and the stash rows (see the `select` callback).
- Limits: The graph scrolls to the anchor of the range, not to the cursor. A long Shift range can move the cursor out of view. No manual check in the app: the screen was locked during T07.

## D61. Summary character counter

- Decision: `SummaryCounter` in `src/components/DetailPanel.tsx` shows 72 minus the length of the summary at the right of the summary input. Below 0, the counter gets the class `is-exceeded` and the new `--orange` token (#de9b43) in `src/styles.css`.
- Reason: Source shows the characters left before `commitMessageSoftLimit` (see `docs/EVIDENCE.md` section 10). Task T08 of the parity plan (D50).
- Rules: The WIP commit form and the amend and reword form both show the counter. The counter counts code points. The tooltip is the Source text. The counter uses `--text-faint`, which has the value of the Source `--text-disabled` (0.4 alpha). The input keeps `maxLength` 200.
- Limits: No manual check in the app: the screen was locked during T08.

## D62. Search result counter

- Decision: The graph search shows "{i} of {N}" and "0 results", as in Source. `GraphView` in `src/components/GraphView.tsx` keeps the matches in graph order in `matchList`. The index is the position of the selected commit in `matchList`. Enter and Shift+Enter move the selection to the next and the previous match.
- Reason: Source uses `CommitSearch-ResultsText` and `CommitSearch-NoResults` (see `docs/EVIDENCE.md` section 11). Task T09 of the parity plan (D50).
- Rules: If the query has no match, the counter shows "0 results". If the selected commit is not a match, the counter shows "0 of {N}". An empty query shows no counter.
- Limits: Typing does not select the first match. No manual check in the app: the screen was locked during T09.

## D63. Default pull action and detached HEAD guards

- Decision: The key `pull.default` in `layout` (D55) holds the default pull mode: `fetch`, `ff`, `ff-only` or `rebase`. The default is `ff`. The Pull button in `src/components/Toolbar.tsx` runs the default mode. The dropdown has the four options and the submenu "Select a default pull/fetch operation to execute when clicking this button". A click on an option runs it. A click on an item of the submenu sets the default and does not run it.
- Reason: Source keeps the default in the profile setting `pullType` and sets it with a star on each row (see `docs/EVIDENCE.md` section 9). Task T10 of the parity plan (D50).
- Rules: In detached HEAD, the three pull options are disabled and "Fetch All" stays enabled. The Pull button is disabled if the default is not "Fetch All". The Push button is disabled. Each disabled button has the Source tooltip "{label} is not available when in a detached HEAD state". The Push tooltip is "Push to {upstream}" when the current branch has an upstream, else "Push". The tooltip is on the `.tool` wrapper, so a disabled button also shows it.
- Limits: The native menu has no star icons, so a submenu replaces the stars and a "✓ " prefix marks the default. Source does not disable Push in detached HEAD. GitNeat disables it, because the push action needs a branch. The default is one value for the app, not one value for each profile. No manual check in the app: the screen was locked during T10.

## D64. Left panel polish

- Decision: The ahead and behind badges in `src/components/Sidebar.tsx` show an arrow with the tooltips "{n} ahead" and "{n} behind". A count above 99 shows "99+". The status line says "Soloing" while solo is on, else "Viewing". The filter shows a clear button when it has text. While the filter has text, the tree ignores the collapsed folders, so matching folders show open. The Remote and Tags headers have a menu with "Hide all" and "Show all". The Local menu uses the same code.
- Reason: Source uses `RefBar-NAhead`, `RefBar-NBehind`, `RefBar-StatusSoloing` and the section header menus (see `docs/EVIDENCE.md` section 11). Task T11 of the parity plan (D50).
- Rules: `ctx.setHidden(fulls, hide)` in `src/RepoView.tsx` adds or removes a list of refs in one write. The old code called `toggleHidden` in a loop, which kept only the last change. "Show all local branches" no longer clears the hidden remotes.
- Limits: The top "Show All" button still clears the hidden and solo lists. No manual check in the app: the screen was locked during T11.

## D65. Hide all stashes

- Decision: The Stashes header menu has "Hide all stashes" and "Show all stashes". Hide adds the name `refs/stash` to the `hidden` list of the tab. `load_repo` in `rust/app/src/load.rs` and `rust/app/src/load_gix.rs` skips `insert_stashes` when the list holds that name. The graph rows and lanes are then built without the stash rows.
- Reason: Source has Hide all on each section header (see `docs/EVIDENCE.md` section 11). Follow-up of task T11 (D64).
- Rules: The saved prefs and the `loadRepo` call keep their shape. Solo mode does not change the stash rows.
- Limits: The Stashes list in the left panel still shows every stash, with no dimmed state. No manual check in the app: the screen was locked during T11.

## D66. Collapsed folders and open sections persist per repository

- Decision: `RepoPrefs` in `src/RepoView.tsx` has the optional fields `closed` and `openSections`. `RepoView` passes them to `Sidebar` as props. The app store saves them with the other tab prefs. `setPrefs` in `src/App.tsx` merges a partial value into the saved prefs of the tab.
- Reason: Source writes both lists to the settings file of the repository (see `docs/EVIDENCE.md` section 11). Task T12.
- Rules: The defaults are no collapsed folder and the sections LOCAL and REMOTE open. `setPrefs` takes a `Partial<RepoPrefs>`, so the callers of `hidden` and `solo` keep their shape.
- Rules: A tab of a linked worktree copies `openSections` from the main worktree tab, and replaces its own list. The main tab must have a saved list. `RepoView` does this once for each mount, after the first load, through the `mainSections` prop.
- Limits: Source also copies the section heights. D67 adds them. No manual check in the app.

## D67. Resizable left panel sections with saved heights

- Decision: `RepoPrefs` in `src/RepoView.tsx` has the optional field `sectionYsByKey`, a map from section name to the Y of the section bottom edge in pixels. This is the Source value. The height of a section is the difference to the previous Y. `src/leftPanel.ts` ports the Source rules, and `Sidebar` draws the handles with `Splitter`.
- Reason: Source saves `layout.leftPanel.sectionYsByKey` for each repository (see `docs/EVIDENCE.md` section 11). Task T41.
- Rules: A collapsed section is 30 px high. An open section is at least 138 px high (30 + 108). The default Y step is 162 (132 + 30).
- Rules: `handleBounds` clamps each Y to the panel height minus the minimums below. `boundedYs` then pushes each later section so that it keeps its minimum height. The last section ends at the panel height.
- Rules: `resizableHandles` gives no handle to the last section, to leading or trailing sections with a fixed height, or to the last open section before a trailing run of collapsed sections.
- Rules: The drag writes the saved map once, when the user releases the mouse. During the drag the map is local state. The saved map holds all section keys.
- Rules: The `mainSections` prop of `RepoView` returns `openSections` and `sectionYsByKey`. A linked worktree copies both from the main worktree once for each mount (D66).
- Limits: The panel height comes from a `ResizeObserver` on the sections container. Before the first measure the sections have no fixed height. GitNeat always shows the six sections, and Source hides some by account type. No manual check in the app: the Tauri window was not started in this task. `test/left-panel.test.ts` covers the rules.

## D68. Graph avatar color from the author email

- Decision: The inner circle of a commit node uses one of the ten lane tints `--lane-N-bg50`. `authorColor` in `src/components/GraphView.tsx` picks N from a hash of the lowercase author email. If the email is empty, it hashes the author name.
- Reason: Source gives the initials avatar a color for each author. Task T13.
- Rules: The same author always gets the same color. The hash is `hash * 31 + code`, modulo 10. The ring keeps the lane color.
- Limits: No image from an external service (D12). Two authors can share a color, because the palette has ten colors. The right panel avatar keeps `--avatar-bg`. Source uses `DEFAULT_AVATAR_BACKGROUND_COLOR` `#199489` when it has no image. Its exact color rule is not in the evidence. No manual check in the app: the Tauri window was not started in this task.

## D69. File history: Go Deeper

- Decision: `HistoryView` in `src/components/DiffView.tsx` calls `loadFileHistoryPage` with a page count. The Rust function `load_file_history_page` scans the first 30000 x pages commits of `HEAD` and returns the commits in that window that change the file. It returns `end` and `next` (sha and time of the first unscanned commit).
- Reason: Source scans 30000 commits for each page, and shows "Searched until {date} ({sha})" with a "Go Deeper" button until `reachedEndOfHistory` (`docs/EVIDENCE.md` section 12). Task T14.
- Rules: The end row reads "Loading…" while a page loads, "End of History" if `end` is true, else "Searched until" with the "Go Deeper" button. The page count resets when the file or the repository changes.
- Limits: Source continues one revwalk. GitNeat runs `git rev-list` for the window and `git log --follow` for the file again on each click, then filters by window. The cost of `git log --follow` does not depend on the window. The old `load_file_history` command stays for the comparison tests. No manual check in the app: the Tauri window was not started in this task.

## D70. Detached HEAD warning, no Discard on hover

- Decision: A `detached-warning` row shows "You are in a detached HEAD state" above the Unstaged Files section. It has a warning icon and a tooltip with the Source explanation. The unstaged row keeps one hover button, "Stage File". Discard stays in the file context menu.
- Reason: The Source bundle shows one hover button for each WIP row, and a second button only for submodules. `File-Reset` "Discard changes" is a context menu item. The task text said Discard shows on hover. The bundle does not. Task T15 follows the bundle (`docs/EVIDENCE.md` section 10).
- Rules: The warning shows if HEAD has a commit, no branch is checked out and no rebase runs. The WIP view is the only place that renders it.
- Limits: No manual check in the app: the Tauri window was not started in this task. Source sets the warning style with CSS classes whose values are not in the evidence. GitNeat uses a centered row with an orange icon.

## D71. Author block email tooltip, committer rule and co-authors

- Decision: `load_commit` reads the committer email (`%ce`) and the `Co-authored-by` trailers (`%(trailers:key=Co-authored-by,valueonly,unfold)`). `CommitDetail` gets `committerEmail` and `coAuthors` (raw `Name <email>` values). The frozen reference in `test/reference/repo.ts` has the same fields.
- Rules: The author name and the committer name have the email as a tooltip. The committer block shows if the name or the email differs from the author. A "Co-authors:" row shows a 20 px avatar and the name of each co-author, with the email as a tooltip.
- Reason: The Source bundle shows these three items (`docs/EVIDENCE.md` section 10). Task T16.
- Limits: The tooltip is the native `title`. Source uses a 500 ms delay. The avatar shows initials, as in the rest of the panel. A trailer without an email shows the whole value as the name. No manual check in the app: the Tauri window was not started in this task.

## D72. Missing context menu items

- Decision: The stash menu has "Edit stash message" and Hide. The remote menu has Hide and Solo. The tag submenu "Push tag to remote" has "Push {tag} to all remotes". A local tag delete asks to delete the tag from the remotes. A worktree remove that git refuses asks for a Force Remove.
- Reason: The Source menus have these items (`docs/EVIDENCE.md` sections 2.3, 2.4, 2.8 and 11). Task T17.
- Rules: Stash Hide toggles `refs/stash`, the same key as "Hide all stashes". Remote Hide and Solo act on all refs of the remote. The labels read Show or Stop soloing if all refs of the remote are hidden or soloed. The menu omits both items if the remote has no refs.
- Rules: `stashEdit` runs `git stash store -m` for the same commit, then drops the old entry. The `removeWorktree` action returns `needs-confirm:force-remove` when git asks for `--force`. After the confirm, the retry uses `--force --force`, so it also removes a locked worktree.
- Limits: "Edit stash message" moves the stash to the top of the stash list, because git cannot change a message in place. The tag prompt does not check which remotes hold the tag. A remote without the tag shows a toast error.
- Limits: "Compare commit against working directory" is not added. GitNeat has no compare view in the right panel. The task needs a new loader and a new detail mode. Follow-up task.
- Limits: No manual check in the app: the Tauri window was not started in this task. The menu trees and handlers are covered by the comparison tests. The Rust actions were run on a temporary repository.

## D73. Titled errors and pull and cherry-pick notices

- Decision: `ui.task` takes an optional error title. The default is "{label} Failed". `runNative` in `src/actions.ts` passes the verb of the label, so "Checkout main" shows "Checkout Failed". An error toast stays open until the user closes it. It has Close, Copy and, for text over 240 characters or 4 lines, Expand and Collapse. An info toast closes after 3.5 s.
- Decision: The Rust actions `pull` (modes ff, ff-only and rebase), `pullBranch` for the current branch and `cherryPick` can return `notice`. `runNative` shows it as an info toast. A pull shows "Pulled successfully" if HEAD changed, else "Already up to date". A cherry pick that git reports as empty runs `cherry-pick --abort` and shows a no-op notice.
- Reason: Source has the texts `Error-CheckoutFailed`, `GitHook-HookFailed`, `Notification-PulledSuccessfully`, `Notification-AlreadyUpToDate` and `NotificationMessage-CherrypickWasNoop` (`docs/EVIDENCE.md` section 12). Task T18.
- Limits: The evidence has no success notice for push or fetch, so GitNeat shows none. Source has titles for specific errors, for example `Error-FetchFailedWithName`. GitNeat builds the title from the task label only. The hook title "{hook} Failed" is not added, because GitNeat does not parse the hook name from the git output.
- Limits: The comparison test `test/actions.test.ts` logs only error toasts, because the frozen reference has no notices. No manual check in the app: the Tauri window was not started in this task. The toast layout has no pixel measurement from Source.

## D74. Push rejected: Pull, Force Push and Fetch prompts

- Decision: `ui.choose` shows a dialog without title, with a message, one button for each choice, optional checkbox fields and Cancel. It returns the fields and `choice`, or null.
- Decision: The Rust action `push` returns `needs-confirm:push-remote-changed` for the git texts `fetch first` and `stale info`. For the other rejections it returns `needs-confirm:push-behind`. The args `force` (lease) and `hard` (plain `--force`) select the retry mode.
- Decision: `push` in `src/actions.ts` retries up to 4 times. On `push-behind` it asks "'{branch}' is behind '{upstream}'. Update your branch by doing a Pull." with Pull and Force Push. Pull runs the default pull, then pushes again. If the default is Fetch All, Pull asks for one of the three pull modes. Force Push asks "Force push is a destructive action and cannot be undone. Are you sure?" with a "Don't ask again" checkbox, then pushes with lease.
- Decision: On `push-remote-changed` it asks "WARNING! '{branch}' has changed on the remote since the last fetch." with Fetch and Force Push Anyway. Fetch runs Fetch All and ends. Force Push Anyway asks the same confirm without the checkbox, then pushes with `--force`.
- Reason: Source has these prompts and texts (`docs/EVIDENCE.md` section 12). Task T19.
- Limits: The `{1}` value in the remote-changed text is the branch name. Source passes the full ref name. The bold WARNING! is plain text. The "Don't ask again" value is saved as the layout key `push.skipForceWarning`. Source saves it in an app setting.
- Limits: The reference push in `test/reference/actions.ts` mirrors the flow with `git` calls. The Pull scenario uses a branch that is only behind, because a diverged pull makes a merge commit whose message holds the temporary path.
- Limits: No manual check in the app: the Tauri window was not started in this task.

## D75. Merge and rebase conflict panel, branch names and Skip Commit

- Decision: Source has no banner above the panes. It shows everything in the right panel. GitNeat does the same for a merge and a rebase. The old banner stays only for a cherry-pick and a revert, because the evidence has no flow for them.
- Decision: If conflicted files exist, the WIP header reads "Merge conflicts detected" or "Rebase conflicts detected" with a warning icon, in place of "N file changes on {branch}". A line below reads "Merging {from} into {to}" or "Rebasing {from} onto {to}".
- Decision: The Tauri command `load_operation` returns `{from, to}`. For a merge, `from` is `name-rev` of `MERGE_HEAD` and `to` is the current branch. For a rebase, `from` is the short name in `rebase-merge/head-name` and `to` is the first 6 characters of `rebase-merge/onto`. The line hides if a name is empty.
- Decision: During a merge, the commit area has "Commit and Merge" (staged files exist) or a disabled "No Changes to Merge", and "Abort Merge". During a rebase, it has "Continue Rebase" (staged files exist) or "Skip Commit", and "Abort Rebase". "Skip Commit" runs `rebase --skip` (action `skipOperation`).
- Decision: A "Conflicted Files ({n})" section sits above Unstaged Files, with "Mark all resolved". The action `markResolved` runs `git add -- {paths}`. Conflicted files leave the Unstaged section. During an operation, the Staged section reads "Resolved Files ({n})".
- Reason: `ConflictsHeader-Merging`, `ConflictsHeader-Rebasing`, `RightPanel-*ConflictsDetected`, `CommitAndMergeButtonLabel`, `DisabledMergeButtonLabel`, `ContinueRebaseButtonLabel`, `SkipCommitButtonLabel`, `Abort*ButtonLabel` and `getGitRebaseBaseSha` (`docs/EVIDENCE.md` sections 10 and 12). Task T20.
- Limits: Source keeps the commit message box during a merge. GitNeat hides it, and "Commit and Merge" uses the default merge message (`commit --no-edit`).
- Limits: Source reads the merge base name from the HEAD branch shorthand. GitNeat shows the branch name, or the short sha if HEAD is detached.
- Limits: No visual check in the app. The Tauri window started, but `screencapture` returned a black image. The Rust test `operation_info_names_branches` covers a conflicted merge and rebase.

## D76. Checkout with local changes

- Decision: A failed checkout does not offer to stash. Source does the same (`docs/EVIDENCE.md` section 12). The task text asked for a prompt. The Source bundle has none.
- Decision: The actions `checkoutRef` and `checkoutRemote` change the git error "Your local changes ... would be overwritten by checkout" to "1 conflict prevents checkout." or "{n} conflicts prevent checkout." with the line "Commit, stash, or discard your changes first." The toast title stays "Checkout Failed". Undo and redo of a checkout show "{n} conflicts prevent undo checkout." only.
- Decision: `checkoutCommit` stashes first if the working tree has changes (`git stash push --include-untracked`). The message is `Auto stash before checking out "HEAD"`.
- Decision: `checkoutRemote` follows `calculateCheckoutDecision`. No local branch: create it with `--track`. Same sha: `git switch {local}`. The local branch tracks the remote branch and is an ancestor of it: stash with `Auto stash before checking out "{remote branch}"`, then `git switch -C {local} {remote}`. Otherwise the action returns `needs-confirm:remote-diverged`. `src/actions.ts` then asks "A local '{name}' already exists." with a branch name input, "Create Branch Here", "Reset Local to Here" and Cancel. The retry sends `mode` and `newName`. Create runs `switch -c {name} --track {remote}`. Reset stashes and runs `switch -C`.
- Decision: If another worktree holds the local branch, `checkoutRemote` runs in that worktree (`inWorktree`) and then opens it as a tab. The ancestor case resets without a prompt, even if the shas are equal. Otherwise the prompt reads "A local '{name}' already exists in a worktree." with the "Open Worktree and ..." button labels. `openRef` in `src/actions.ts` handles the double click on a ref. A local branch that another worktree holds opens that worktree.
- Reason: Source `autoStash`, `calculateCheckoutDecision`, `checkoutRefOrOpenWorktree` and `gitCheckoutAndUpdateHead`. Task T21.
- Rules: Undo does not restore an auto stash. Source does the same.
- Limits: The conflict count comes from the tab-indented lines of the git error. Untracked file conflicts keep the git text, as in Source.
- Limits: No manual check in the app. The comparison tests cover the actions and the prompts. The Tauri window was not started in this task.

## D77. Graph columns and column settings

- Decision: The graph has the columns Branch / Tag, Graph, Commit message, Author, Date / Time and Sha, in this order. The headers read BRANCH / TAG, GRAPH, COMMIT MESSAGE, AUTHOR, COMMIT DATE / TIME and SHA, as in the Source strings.
- Decision: A gear button at the right end of the header and a right click on the header open the column settings menu. The menu lists the six columns with a check mark. A click shows or hides a column. The last visible column cannot be hidden. The menu then has "Reset columns to default layout" and "Reset columns to compact layout", and the "Show commit description in graph" submenu (D58).
- Decision: The Date / Time cell uses `Intl.DateTimeFormat` with `dateStyle` short and `timeStyle` short. The Sha cell shows 6 characters. The Author cell shows the name. At the minimum width of 32 px it shows the initials in a circle, as Source shows an avatar.
- Rules: The width limits are Source limits. Branch / Tag 32 to 300. Author 32 to 175. Date / Time 50 to 175. Sha 50 to 100. The default widths are Branch / Tag 130 (a stored width stays), Author 130, Date / Time 130 and Sha 100. The visible flags and widths are keys of `layout` (D55). The columns after the message have the resize handle on the left edge.
- Rules: Compact layout hides Date / Time, sets Branch / Tag and Author to 32 px, and sets the Graph width to 150 px. Default layout shows all columns and sets the Graph width to automatic.
- Reason: Source `graphZoneMetaData` and `popupGraphHeaderContextMenu` (`docs/EVIDENCE.md` section 11). Task T22.
- Limits: The Changes column is not built (it needs `--shortstat` for each commit). The column order is fixed, and the user cannot drag a header. The commit message column fills the free width, so it has no resize handle. The menu has no "Compact Graph Column" item, because GitNeat has no graph column mode. Source sets the Sha default to 130 and the maximum to 100. GitNeat uses 100. The visible flags are for the app, not for each repository. Source saves the visibility in the profile and the widths for each repository.
- Limits: No manual check in the Tauri window. `tsc`, the tests and a Vite build pass.

## D78. Lazy commit loading

- Decision: `RepoView` keeps the commit limit in a ref. It starts at 2000 (D7) and grows by 2000. `GraphView` calls `onLoadMore` when the scroll bottom is within 20 rows of the last row and `hasMore` is true. `hasMore` is true if the loaded commit count is at least the limit. `onLoadMore` runs `load` again with the new limit. A second call waits until the load ends.
- Reason: Source loads commits lazily near the bottom (`docs/EVIDENCE.md` section 11). Task T23.
- Rules: GitNeat shows no "Displaying N commits" footer. Source shows the footer only if lazy loading is off, and its default is on. GitNeat has no setting to turn lazy loading off. The task text asked for the footer, but parity follows the bundle.
- Limits: Each step loads the whole log again, with the larger limit. Source loads pages of 200. A page of 2000 keeps the number of reloads low. A repository with 100000 commits reloads 50 times to reach the end. No manual check in the app: the Tauri window was not started in this task.
- Superseded in part by D81: a step appends a page of 200 commits and does not reload the log.
- Superseded in part by D84: the footer shows if lazy loading is off, and the first load count is the setting.

## D79. Search has no filter mode

- Decision: GitNeat does not add a filter mode to the graph search. The search dims the rows that do not match, as in D62.
- Reason: The Source app never sets `searchMode` on the graph. The search runs in "normal" mode and dims rows (`docs/EVIDENCE.md` section 11, search mode). The filter mode of the graph package is not reachable. The task text described it from the package code. Task T40.
- Rules: A dimmed row that is selected or hovered uses `--text-dimmed-selected` (rgba(255,255,255,0.5)). Other dimmed rows use `--text-dimmed`. Source uses the same two colors.
- Limits: The Source author and team filter (`CommitFilter-FilterPlaceholder`, the Filter icon in the graph header) is not built. It uses the same dim path. No manual check in the app. `--filter-match` is not used, because Source does not use it.

## D80. Portable Windows build

- Decision: CI zips `rust/target/release/gitneat.exe` and an empty `portable.txt` into `gitneat-portable-windows.zip` on the Windows job. The zip goes to the same artifact as the installers, so the release job publishes it.
- Rules: `user_data` in `rust/app/src/store.rs` picks the state folder in this order. First `GITNEAT_USER_DATA`. Then the folder of the exe, if `portable.txt` is there. Then the app data folder.
- Reason: The user asked for this task. Source has no portable build, so there is no Source evidence. Task T43.
- Limits: The exe needs the WebView2 runtime on the machine. The zip does not bundle it. The portable build has no updater. The zip step was not run locally: only the Windows CI job runs it.

## D81. Commit pages

- Decision: A load more step appends a page of 200 commits. The `load_commits` command takes `skip`, `limit` and the lane state. It returns the page commits, the page rows and the new lane state. `layout_from` in `rust/graph/src/port.rs` starts from the given lane state. `RepoData.lanes` holds the lane state after the first load. `RepoView` keeps the lane state in a ref and appends each page to `data.commits` and `data.rows`. A refresh reloads from the top with the loaded count.
- Reason: Task T44. The step of 200 is the Source step (`pagedLazyLoadCommitCount`). Source reloads the full list on each step (`docs/EVIDENCE.md` section 11, page step). GitNeat appends instead, because a full reload for each step of 200 is too slow for a large repository. The rows are the same as one load with the larger count.
- Rules: The page skips log commits only. Stash rows do not count. A stash row goes before its base commit in the page that holds the base. The WIP row is only in the first load. `hasMore` is true if the last load or page returned a full count. A page does not start while a full load runs. A page result is dropped if a full load started after the page.
- Rules: The settings `enableCommitsLazyLoading` and `maxCommitsInGraph` exist since D84.
- Limits: Each page walks the full history to sort it by date (gix) or lets `git log --skip` walk the skipped commits (cli). The page time does not grow with the loaded count: about 190 ms (gix) and 220 ms (cli) per page on a repository with 100000 commits and a merge every 50 commits. A cache of the sort order can remove this cost. The page reads the refs again, but returns no refs, so a ref change shows only after the next refresh. No manual check in the app: the Tauri window was not started in this task.

## D82. Favorites, repository aliases and recent management

- Decision: The saved state has `favorites` (paths, in the order added) and `aliases` (path to name). An alias belongs to the repository path, not to the tab. The tab title is the alias or the folder name. The old `title` of a tab moves into `aliases` when the state loads.
- Decision: The NEW tab shows a "Favorite" section with the first 8 favorites and a "Recent" section with all recents. A row shows the alias or the folder name and the path. A row has a context menu with "Add to favorites" or "Remove from favorites", "Rename" and "Remove from recent". A recent row has an x button. The "Recent" heading has "Remove all". The search matches the alias, the name and the path, and shows if favorites plus recents number more than 10.
- Decision: The tab context menu has "Add to favorites" or "Remove from favorites". "Rename tab" opens a prompt with the button "Save alias". An empty alias, or the folder name, clears the alias.
- Decision: The repository breadcrumb menu has the header "Favorites" with the first 9 favorites and the hints Cmd+1 to Cmd+9. It has the header "Recently opened" with 4 recents that are not favorites. It ends with "View all repositories", which opens a NEW tab.
- Decision: The command `missing_paths` returns the paths that are not folders. The NEW tab marks those rows with "Repo is unreachable and may have been deleted".
- Reason: Source `NewTabView`, `getAlias`, `RepoManagement-removeRecentRepo`, `removeAllRecentRepos`, `RepoManagement-RepoIsUnreachable`, `RECENTLY_OPENED_BREADCRUMBS_LIMIT` and `RenameTabPrompt-MessageRepo` (`docs/EVIDENCE.md` section 9). Task T24.
- Limits: Cmd+1 to Cmd+9 still switch to tab N, as in D51. The hints show the favorite number only. The evidence does not show a favorite shortcut. The recent list holds 100 paths. Source has no visible cap. The Repo Management tab, with its groups and per-repository fetch and pull, is not built. No manual check in the app: the Tauri window was not started in this task.

## D83. Native app menu and zoom

- Decision: On macOS, `rust/app/src/appmenu.rs` builds the app menu and `lib.rs` sets it. The menus are the product menu, File, Edit, View, Window and Help. Tabs and Favorites are submenus of Window, as in Source. A custom item has the id prefix `app:`. The menu event handler emits the event `app-menu` with the id. `App.tsx` runs the action for the id in `runMenu`.
- Decision: The tab and zoom shortcuts of `App.tsx` call the same `runMenu`. On Windows and Linux, which have no menu, the key handler stays the only path. On macOS the menu accelerator takes the key first.
- Decision: Zoom has six steps: 0.8, 0.9, 1, 1.1, 1.2 and 1.3. Cmd or Ctrl with =, - and 0 increase, decrease and reset it. The value is saved in `layout.zoom` (D55). `setZoom` in `src/tauri-api.ts` calls the webview zoom. The status bar shows the value.
- Reason: Source `app menu` template and `ZOOM_FACTORS` (`docs/EVIDENCE.md` section 9). Task T25.
- Limits: Windows and Linux have no menu bar, because the window has no frame and GitNeat draws its own tab bar. Undo and Redo have no accelerator in the menu, so Cmd+Z stays with the repository handler in `RepoView.tsx` and with the text fields. Items for features that do not exist are left out: Preferences (T26), Open Repo Management, External Editor, Command Palette, Keyboard Shortcuts, Open Tabs List, the Show Commit Details Panel toggle and the terminal panel. Select Next Tab and Select Previous Tab have no accelerator in the menu. Ctrl+Tab stays in the key handler. The Reset Zoom accelerator Cmd+0 is an assumption. Help has only "View Support Documentation". No manual check of the clicks: the app started with the menu and did not panic, but no menu item was clicked.

## D84. Preferences, auto-fetch and commit loading settings

- Decision: The saved state has `settings` with `autoFetch` (minutes, default 1), `lazyLoad` (default true) and `maxCommits` (default 2000). The Preferences dialog uses `ui.prompt`. The product menu item "Preferences..." (Cmd+, , id `preferences` in `rust/app/src/appmenu.rs`) and the graph footer link open it. A value that is not valid shows an error toast and saves nothing: auto-fetch must be a whole number from 0 to 60, and the maximum must be a whole number of at least 500.
- Decision: `RepoView` loads `maxCommits` commits first, as Source does (`docs/EVIDENCE.md` section 11, first load count). If lazy loading is on, a scroll to the end appends pages of 200 (D81) up to a ceiling of 100000 commits (`COMMIT_CEILING` in `src/commitLimit.ts`, from `maxCommitsRetrievedAtOnce`). If lazy loading is off, the graph does not load more. It shows the footer "Displaying N commits. Adjust this setting in Preferences" with a link that opens the dialog. A change of `maxCommits` or `lazyLoad` reloads the graph from the top.
- Decision: The auto-fetch timer is in `RepoView`, so it runs for the active tab only, as in Source. Each tick runs "fetch all" and then reloads. A tick waits for the previous fetch to end. An error is silent. There is no failure notice, because the Source bundle has none. The task text named one.
- Reason: Task T26. Source `getDefaultSettings`, `autoFetchSaga`, `getCurrentNumberOfCommits` and `getMoreCommitsSaga` (`docs/EVIDENCE.md` section 11).
- Limits: The task text said that lazy loading stops at the maximum. Source uses the maximum as the first load count and then pages beyond it, so GitNeat follows Source. The Source Preferences also has auto-prune, default branch name and remember tabs. GitNeat does not build them. The dialog is a plain prompt, not the Source Preferences view with sections. No manual check in the app: the Tauri window was not started in this task.

## D85. Auto-prune, default branch name and remember tabs

- Decision: `settings` has three more fields: `autoPrune` (default true), `defaultBranch` (default empty) and `rememberTabs` (default true). The Preferences dialog (D84) shows them.
- Rules: The `pull` and `fetchRemote` actions take `prune`, which is true if absent. A fetch adds `--prune` if it is true and `--no-prune` if it is false, as the Source `-c fetch.prune` argument does. A pull does the same, because Source reads the setting in the pull saga. `Ctx.prune` carries the setting, and auto-fetch passes it.
- Rules: The `init` action takes `branch`. A non-empty name runs `git init -b <name>`. An invalid name makes git fail, and the user sees the git error. Clone does not use the setting, as in Source.
- Rules: If `rememberTabs` is off, the app drops the saved tabs when the state loads and opens one NEW tab. The closed tab list stays.
- Reason: Task T26b. Source `autoPrune`, `init.defaultBranch` and `rememberTabs` (`docs/EVIDENCE.md` section 11).
- Rules: The dialog uses the Source English labels and help texts, with "Initial Commits in Graph" for `maxCommits`. The default branch input uses the git name check of the prompt dialog (no space, no leading dash, none of `~^:?*[\` and no `..`). An empty value or "main" saves as empty, as in Source.
- Limits: GitNeat does not write `init.defaultBranch` to the global git config, which Source does by default when `keepGitConfigInSyncWithProfile` is on. A write would change `git init` in the terminal of the user without a clear sign. GitNeat passes `-b` for its own init only. Source checks the name with `Reference.isValidName`. GitNeat uses the prompt rule, and git has the last word. "Show All Commits in Graph" is not built. No manual check in the app: the Tauri window was not started in this task.

## D86. Commit options: push after committing and skip hooks

- Decision: The `commit` action takes `noVerify`. If it is true, the action adds `--no-verify` to `git commit`. The command `has_commit_hook` returns true if the hooks folder holds `pre-commit` or `commit-msg`. The command reads the folder with `git rev-parse --git-path hooks`, so `core.hooksPath` applies.
- Decision: The commit box in `DetailPanel.tsx` has a "Commit options" toggle. It shows "Push after committing" and, only if a hook exists, "Skip Git hooks". The button label adds " and Push" and " (Skip Hooks)".
- Decision: `commit` in `src/actions.ts` pushes the current branch with `push` after a successful commit. A failed commit does not push.
- Reason: Task T27. Source `CommitDetailPanel-CommitOptions` (`docs/EVIDENCE.md` section 10).
- Limits: Only `pre-commit` and `commit-msg` count as hooks, because `--no-verify` skips only these two. The options reset to off on each app start. Source may keep them in the profile, and the evidence does not show it. The push uses the normal push flow, so its prompts and force warnings apply. No manual check in the app: the Tauri window was not started in this task.
