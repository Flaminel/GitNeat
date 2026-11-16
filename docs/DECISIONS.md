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
