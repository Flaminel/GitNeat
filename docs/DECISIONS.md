# Decisions

Each entry records one decision, the reason, and the known limits.
Add new entries at the end.
Do not edit old entries. Add a new entry that supersedes the old one.

## D1. Electron, React and TypeScript

- Decision: Krill uses Electron 45, React 19, TypeScript 5 and Vite 8.
- Reason: Source 11.9.0 uses Electron and React (see `docs/EVIDENCE.md`). Electron gives one code base for macOS and Windows.
- Limits: The app bundle is large (about 100 MB), the same as Source.

## D2. The git CLI is the backend

- Decision: All repository operations run the `git` executable through one IPC channel (`git` in `electron/main.ts`).
- Reason: Source uses nodegit (libgit2) and ships a git binary. Nodegit needs a native build for each platform and Electron version. The git CLI needs no native build and supports every git feature, including worktrees and interactive rebase.
- Limits: The user must install git. On Windows, install Git for Windows. Each operation starts a process. For very large repositories, this is slower than libgit2.

## D3. The renderer parses git output

- Decision: The main process only runs `git` and returns stdout, stderr and the exit code. The renderer builds the arguments and parses the output (`src/repo.ts`).
- Reason: One generic channel keeps `electron/main.ts` small. All git knowledge is in one place.
- Limits: The renderer can run any git command. The renderer loads only local bundled code, so this is acceptable. If Krill ever loads remote content, restrict the channel to a list of commands.

## D4. All tabs share one window and one renderer

- Decision: Repository tabs are React state in `src/App.tsx`. Krill has one `BrowserWindow`.
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

- Decision: Drop, move up, move down, edit message and interactive rebase all run `git rebase -i`. Krill writes the todo list to a temporary file. `GIT_SEQUENCE_EDITOR` is `cp "<todo file>"`. A new message for an older commit uses an `exec git commit --amend -F <file>` line.
- Reason: Git runs the editor commands through its own shell, so `cp` works on macOS and on Windows (Git for Windows includes `sh` and `cp`). No helper script is necessary.
- Limits: Rebase does not keep merge commits. Krill disables these actions when the range contains a merge commit.

## D9. In-progress operation detection

- Decision: Krill detects merge, rebase, cherry-pick and revert with the pseudo-refs `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD` and `REVERT_HEAD`.
- Reason: This needs no file system access in the renderer.
- Limits: A rebase that stops on a failed `exec` line has no `REBASE_HEAD`. Krill does not show the banner for it. To fix, check the `rebase-merge` directory in the git directory.

## D10. Stashes in the graph

- Decision: Krill shows each stash as a row above its base commit, with only one parent.
- Reason: The stash index commit and untracked commit add rows that have no meaning to the user.

## D11. No proprietary service features

- Decision: Krill does not copy AI recompose, Cloud Patches, Jira, Trello, Teams or the Source account.
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

- Decision: If `KRILL_SCREENSHOT` is set, the main process hides the window, runs `KRILL_SCREENSHOT_JS` in the page, saves a PNG and quits.
- Reason: The hook gives a repeatable visual check without a UI test framework.
- Limits: Native context menus do not show in the capture. `test/menus.test.ts` checks the menu content instead.

## D15. Left panel sections size to their content

- Decision: Each section header is always visible. An open section takes the height of its content. When the panel is full, the section shrinks and gets its own scroll bar.
- Reason: This is the Source layout. The first version scrolled the whole panel, so lower sections went out of view.

## D16. Menu tests use a fake bridge

- Decision: `test/menus.test.ts` replaces `window.krill` with a fake. The fake records the menu and answers the git calls that the menu needs.
- Reason: The menu order is the main Source behavior to keep. The tests compare it to the order in the reference screenshot.
- Tool: `tsx` runs the tests, because the app imports modules without file extensions.

## D17. Branch drag and drop

- Decision: You can drag a branch label in the graph onto the label of another branch. Krill then shows a menu with merge, rebase, interactive rebase, fast-forward and push.
- Reason: Source has the same drag and drop behavior.

## D18. Theme colors come from the Source dark theme

- Decision: `src/styles.css` uses the background, panel, text and accent values from `docs/EVIDENCE.md` section 7. The 10 lane colors are the Source `--graph-color-0..9` values.
- Superseded in part by D21: Krill now uses Open Sans.

## D19. The diff view uses Monaco

- Decision: Inline view and split view use the Monaco diff editor (`renderSideBySide` false or true). Hunk view is a Krill table with Monaco syntax colors.
- Reason: Source uses the Monaco diff editor for inline and split view (see `docs/EVIDENCE-DIFF.md` section 2). The default mode is hunk, as in Source.
- Rules: Krill loads Monaco from `node_modules`, not from a CDN. One editor worker computes the diff. Language services (TypeScript, JSON, CSS, HTML workers) are not loaded. Syntax colors come from the Monarch grammars.
- Staging: Hunk view has a 26 px strip on each hunk with Discard Hunk and Stage Hunk (unstaged), Unstage Hunk (staged) or Revert Hunk (commit). Lines are selected in the line number columns. Monaco views have "Stage selected lines", "Unstage selected lines" and "Discard selected lines" in the editor context menu.
- Patches: `src/diff.ts` builds the patch for a hunk or for selected lines. `git apply --recount` applies it. `test/diff.test.ts` checks the patches against a real repository.
- Limits: The hunk view uses `dangerouslySetInnerHTML` for the output of `monaco.editor.colorize`. Monaco escapes the file text. Files with more than 20000 changed lines show without syntax colors. "Ignore whitespace" turns off staging, because the patch then does not match the file.

## D20. Lane color is the column index

- Decision: Each lane takes the color of its column (`--lane-0` for column 0, and so on). A curve between two columns takes the color of the higher column.
- Reason: The Source screenshot shows the same color for all commits in one column.

## D21. Open Sans at 12 px

- Decision: Krill bundles Open Sans with `@fontsource/open-sans` and uses a 12 px base size.
- Reason: Source uses Open Sans and a root size of 62.5 % with 1.2 rem text. A side by side screenshot showed 8 to 11 % wider text before this change.

## D22. Hardening after the code review

- Decision: The main process blocks `-c`, `--upload-pack`, `--receive-pack`, `--exec` and `--config-env` in the `git` IPC call. `open-path`, `show-item`, `read-file` and `write-file` accept only paths inside an open repository. The file watcher closes itself on error. `GIT_OPTIONAL_LOCKS=0` stops background `git status` calls from taking `index.lock`.
- Reason: A renderer bug must not run commands or open files outside the repository. The lock prevents failed commits during a refresh.
- Rules: User-typed names (branches, tags, remotes) that start with `-` or contain characters that git does not allow are rejected in the dialog. `git clone` puts `--` before the URL.

## D23. Edit This File

- Decision: For an unstaged file, "Edit This File" makes the right side of the Monaco diff editable. "Save Changes" writes the file through the `write-file` IPC call.
- Reason: Source has the same button in the diff toolbar.
- Limits: Krill does not warn if the file changes on disk during the edit.

## D24. Branch menus use ref groups

- Decision: A local branch and a remote branch with the same name on the same commit form one group. The graph branch menu works on the group. `refGroups` in `src/menus.ts` builds the groups.
- Reason: The Source menu builder (`getRefGroupMenuItems` in `render.bundle.js`) works on ref groups. The user's screenshot of the branch menu shows the result.
- Rules: If a group has more than one checkout target, "Checkout" is a submenu with each ref and "this commit". "Create worktree from" uses the same rule. "Pull (fast-forward if possible)", "Push" and "Set Upstream" show for every local branch when the repository has a remote. "Hide" shows only in the left panel. "Create patch from commit" shows only in the graph.
- Merge items follow the Source merge states. If HEAD is behind the branch, the menu shows "Fast-forward". If the branch is behind HEAD, the menu shows "Fast-forward <branch> to <current>". Otherwise the menu shows "Merge".
- Limits: Krill does not copy "Explain Branch Changes" or "Share commit as Cloud Patch" (see D11). If HEAD is behind the branch, Source labels the second item "Merge <current> into <branch>". Krill labels it "Merge <branch> into <current>" and runs `git merge --no-ff`.

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
- Limits: `merge-file` merges non-conflicting changes by itself. The A and B panes show each side with those changes applied, not the raw stage blob. Scroll sync uses pixels, so the two panes can differ in line alignment. "Create Conflict Chunks" ignores manual edits in Output. Krill does not copy the Premium gate on Output editing.
