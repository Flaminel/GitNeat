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
- Limits: Only the active tab is mounted. A tab switch reloads that repository from git.

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
- Evidence: Source also uses a 28 px row and SVG lane edges (see `docs/EVIDENCE.md` section 3).

## D7. Commit limit

- Decision: The graph loads at most 2000 commits.
- Reason: The log parse and layout stay below 100 ms for this size.
- Limits: Older history is not visible. Add a "load more" control if this is a problem.

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
