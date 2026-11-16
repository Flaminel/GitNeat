# Source 11.9.0 - Reverse-engineering evidence

Scope: clean-room behavioural reference for an open-source clone. Only short quoted snippets are kept; nothing here is meant to be copied as code.
Legend: **Observed** = quoted from the shipped artifact; **Inferred** = my reading, not directly proven.

Paths below are relative to the extracted asar root:
`/private/tmp/claude-501/-Users-marius-workspace-projects-rea-source/3c19ed18-deb3-4a93-8eb2-b850f9e1edbb/scratchpad/gk`
Abbreviations: `R` = `src/render/static/entryPoints/main/render.bundle.js` (offsets are byte offsets into that file), `M` = `src/main/static/main.bundle.js`, `S` = `src/strings/en-us.json`.

## 0. Provenance / REA evidence IDs
- app.asar sha256: `999373d14dc5d240792765e18aaee6c65a6f79fffdd9031999391742e4d2d966`
- REA analysis: `ev_3de1b669ba8cd058e90355588a66fedc09e732f6ef188ac44a5b8895ba400a9f` (partial: the main bundle exhausted the analyzer heap, so main-process findings below come from direct grep, not REA coverage).
- Electron fuses: `ev_5465292d4ca869522808c3ca240f548c4b70d5d41b3aefd24488987e5cd1ec99` (RunAsNode on, cookie encryption off, inspect args off, asar integrity off).
- Observed `package.json`: `"productName": "Source"`, `"version": "11.9.0"`, `"main": "./src/main/static/main.bundle.js"`, build via pnpm/gulp.

## 1. Commit context menu (graph)

Observed: the menu is built in one async function in R at about offset 2538300-2545600
(`at.default=async({repo,sha,unfilteredRefGroups,inLeftPanel,isParentHidden,isShaSquashable,isMultiSelecting,leftPanelSectionKey})=>{...`).
Its final line fixes the group order:

```
(0,an.buildSeparatedMenu)([Po,Ao,ko,No,Mo,Lo,Fo,Do,(0,an.getCreateTag)(at,ua,ma)],xo)
```

`buildSeparatedMenu` (R ~2588000) inserts `{type:"separator"}` only between non-empty groups; empty groups vanish:
`buildSeparatedMenu=(Ve,at)=>_.reduce(((Ve,it)=>{const ct=it.map(...);return Ve.length?ct.length?[...Ve,{type:"separator"},...ct]:[...Ve]:[...ct]}),[],Ve)`

### 1.1 Group table (order = array order)
| Var | Contents (builder, string key) | Condition (Observed unless marked) |
|---|---|---|
| Po | full branch/remote menu for the single ref on this commit (section 2) | only when exactly one branch/remote ref name is on the sha: `if(1===oa.length){... Po.push(...await getRefGroupItems(...))}`. Tags are filtered out earlier: `pickBy(some(ref.type===branch\|\|remote))` |
| Ao | `getCheckoutCommit` "Checkout this commit" (`ContextMenu-CheckoutCommit`) | else-branch (0 or >=2 refs) AND `!inLeftPanel` (`if(!ct){Ao.push(getCheckoutCommit(...)),ko.push(getWorktreeCommit(...))`) |
| ko | `getWorktreeCommit` "Create worktree from this commit" | same as Ao |
| No | 1 `getCreateBranch` "Create branch here" | always (in this branch of the code) |
|    | 2 `getCherrypick` "Cherry pick commit" | `la\|\|Nr\|\|push` i.e. hidden when sha is HEAD (`la=Boolean(headRef&&sha===headRef.sha)`) or when multi-selecting |
|    | 3 `getCherrypicks` "Cherry pick {n} commits" | `!isRebasing && isMultiSelecting && headRef && selectedShas.includes(sha)` |
|    | 4 `getResetItems` "Reset {HEAD branch} to this commit" with submenu | `if(!at)return[]` where `at` = HEAD ref: needs a HEAD ref. Submenu: Soft ("Soft - keep all changes"), Mixed ("Mixed - keep working copy but reset index"), Hard ("Hard - discard all changes") |
|    | 5 `getRevertCommit` "Revert commit" | always |
|    | 6 `getAmendCommitMessage` "Edit commit message" | `at?[...]:[]` with `at=la`: only for the HEAD commit |
| Mo | AI items (`getGenerateCommitRebaseSingle` "Recompose commit with AI (Preview)", multi variant, `getStartGenerateCommitRebase`) | only if `getIsAiVisible`; Single requires `!multiSelect` and commit has exactly 1 parent: `if(!at\|\|1!==at.parents.length)return` |
|    | `getStartInteractiveRebase` "Interactive Rebase {N} children of {shortSha}" | `!isRebasing && headRef` AND sha is in `distinctCommitsFromHeadToFirstMergeCommit` (`go.find(c=>c.sha===at)`) AND `takeWhile(c=>c.sha!==at, go).length>0`. N = number of commits above it. Never shown for HEAD itself (N=0) |
|    | then `getInteractiveRebaseShortcuts` in this fixed order: Squash X commits -> Edit commit message (reword) -> Drop commit(s) -> Move commit(s) up -> Move commit(s) down | each gated by flags: `shaIsSquashable`, `isRewordable`, `isDroppable`, `canMoveUp`, `canMoveDown` (selectors `getIsRewordableBySha`, `getIsDroppableBySha`, `getCanMoveUpForSha`, `getCanMoveDownForSha`). Multi-select variants "Drop {0} commits", "Move {0} commits up/down" |
| Lo | one submenu per ref when >=2 refs (`getRefGroupSubmenu`), plus "{0} more refs not displayed" when >`COMMIT_MENU_MAX_REFS_TO_SHOW` | `oa.length>1` |
| Fo | "Copy commit sha" (`getCopyCommitId`), "Copy link to this commit on remote: {0}" (single remote) or "Copy link to this commit" submenu (many), optional "Open Jira to this commit", "Create patch from commit" (`Patch-CreateFromCommit`), "Share commit as Cloud Patch" | only when no branch ref on the sha (`oa.length<1&&(Fo.push(...))`); patch items hidden if multi-select and clicked sha not in selection; cloud patch gated by `getIsDraftsEnabled` |
| Do | "Compare commit against working directory" | `getMaybeWipNodeType(state)` truthy (a WIP node exists) and not in left panel |
| last | `getCreateTag`: "Create tag here", "Create annotated tag here" | always, final group (annotated gets GPG-sign flag `getGpgSignTags`) |

Observed snippet (R ~2543000): `oa.length<1&&(Fo.push((0,an.getCopyCommitId)(at,ma),...(0,an.getCopyDeepLinkForCommitItems)(at,ha,ma)),ga&&Fo.push(...getOpenCommitInGij...)`.

### 1.2 Result for the reference screenshot (non-HEAD, no refs, ancestor of HEAD)
Checkout this commit | Create worktree from this commit | Create branch here, Cherry pick commit, Reset <branch> to this commit >, Revert commit | Recompose with AI (only if AI enabled), Interactive Rebase N children of <sha>, Edit commit message, Drop commit, Move commit up, Move commit down | Copy commit sha, Copy link..., Create patch, Share as Cloud Patch | [Compare against working directory if WIP exists] | Create tag here, Create annotated tag here.
**Inferred**: this matches the screenshot order exactly. Differences by case:
- HEAD commit: no Cherry pick; "Edit commit message" appears in group No (after Revert, via `getAmendCommitMessage`); no Interactive Rebase / Move items (nothing above HEAD).
- Commit not an ancestor of HEAD via first-parent-up-to-first-merge (e.g. other branch): `go.find` fails, so the whole Mo group (rebase, drop, move, squash) disappears; Cherry pick stays.
- Merge commit: Recompose-single hidden (needs 1 parent). Drop/Move/Reword availability comes from selectors not inspected (`getIsDroppableBySha`...). **Inferred** they exclude merges.
- During a rebase (`isRebasing`): Cherrypicks multi and the whole Mo group are suppressed.
- Left-panel invocation (`inLeftPanel`): Checkout/worktree/compare omitted, copy/patch items hidden if multi.
- When exactly one branch is on the commit, Po (branch menu) replaces most of these groups, but the same commit actions are re-emitted inside it (section 2).

String keys (S): `ContextMenu-CheckoutCommit` "Checkout this commit"; `ContextMenu-CreateWorktreeFromCommit` "Create worktree from this commit"; `ContextMenu-CreateBranchHere`; `ContextMenu-CherrypickCommit`/`CherrypickCommits`; `ContextMenu-ResetBranchToThisCommit` "Reset {0} to this commit"; `ContextMenu-RevertCommit`; `ContextMenu-GenerateCommitRebaseSingle` "Recompose commit with AI (Preview)"; `ContextMenu-RebaseXChildrenOfShaInteractively` "Interactive Rebase {0} children of {1}"; `ContextMenu-AmendOrRewordCommitMessage` "Edit commit message"; `ContextMenu-DropCommit(s)`; `ContextMenu-MoveCommitUp/Down`, `MoveXCommitsUp/Down`; `ContextMenu-CopyCommitSha`; `ContextMenu-CopyDeepLinkForCommitOnRemote`; `Patch-CreateFromCommit`; `ContextMenu-CreateTagHere`; `ContextMenu-CreateAnnotatedTag`; `ContextMenu-CompareAgainstWorkingCopy`; `ContextMenu-GoToParentCommit` "Jump to commit in graph".

A second, tiny commit menu exists (R module 25165): `[Copy commit sha]` plus `Jump to commit in graph` when a flag is set (used for commit references outside the graph, **Inferred**).

## 2. Other context menus

### 2.1 Local branch / remote branch (sidebar and graph ref label)
Observed: `getRefGroupMenuItems` (R ~2628800-2632800) ends with
`return(0,an.buildSeparatedMenu)([Ga,ja,za,Ka,lo,go,uo,yo,vo,Co,Io,wo,Po],Ao)`. Same function serves graph ref labels (inLeftPanel false) and sidebar (inLeftPanel true); `isSubmenu` is used for the multi-ref submenu variant. Order:

1. **Ga**: Pull, Push, "Set Upstream" (`ContextMenu-SetUpstream`, opens `promptSetUpstreamForRef`). Only for a local ref (`at&&at.name`) and gated by `isEmpty(Vr)||...` (Vr not resolved; **Inferred** it is "the branch has/hasn't an upstream"). Remote-only refs skip this group.
2. **ja**: Gitflow "Finish {branch}" (`GitFlow-Finish-Branch`) when `branchInfo` exists.
3. **za**: merge/rebase against the checked-out branch. Condition: HEAD ref exists, ref list non-empty, `!ourRefIsSameCommit`, and `ka[0].fullName!==head.fullName`. Items from `getMergeItems`: FAST_FORWARD state gives "Fast-forward {0} to {1}" + "Merge {0} into {1}"; NORMAL gives "Merge {their} into {our}"; otherwise a FF in the other direction. Then `getInteractiveRebaseSteps`: "Rebase {0} onto {1}" and, if prospective steps exist, "Interactive Rebase {0} onto {1}". Merge preference flags: FASTFORWARD_ONLY / NO_FASTFORWARD (+ squash setting).
4. **Ka**: Checkout. `getCheckoutItemsWithSubmenu`; if more than one target, a "Checkout" submenu (branch(es) + "Checkout this commit") else "Checkout {branch}" (+ "Checkout this commit" outside left panel/submenu).
5. **lo**: "Create worktree from {branch}" (or submenu "Create worktree from" > branch / this commit), and "Open worktree from {0}" when one exists.
6. **go** (skipped when `isSubmenu`): Create branch here, Cherry pick commit (hidden if HEAD sha or multi-select), Cherry pick N, Reset >, Edit commit message (HEAD only), Revert commit.
   Note: in this menu Edit commit message precedes Revert; in the commit-only menu (1.1) it follows Revert.
7. **uo**: same AI / Interactive-rebase / Squash / Reword / Drop / Move block as 1.1 (Mo).
8. **yo**: Pull request items: "Review pull request ...", "View pull request ...", "Start pull request to X from Y" / "Push {0} and start a pull request" (`getAppropriateStartPullRequestOptions`), "Explain branch changes" (AI, not for parent refs).
9. **vo**: linked issue items ("View issue ...").
10. **Co**: (local only, not submenu) "Apply patch" if sha is HEAD, "Rename {branch}"; then Delete items (`getDeleteBranch`: "Delete {0}", plus "Delete {0} and {1}" when local+remote both present, "Delete N local branches" variants).
11. **Io**: Copy branch name, Copy commit sha, Copy link to branch: {remote}, Copy link to this commit..., Open Jira..., Create patch / Share Cloud Patch (hidden in left panel).
12. **wo**: Hide (left panel only, single ref) then Solo / "Toggle solo" (`ToggleSoloLabel` submenu with checkboxes when several refs).
13. **Po**: Compare commit against working directory (if WIP).
**Inferred**: the screenshot-style label list (Pull, Push, Set upstream, Fast-forward, Merge, Rebase, Interactive rebase, Checkout, Create worktree, Create branch here, Reset, Rename, Delete, Copy branch name, Hide, Solo, Start PR) is consistent with this order. "Fetch" is not in the branch menu; Pull's label comes from `getPull(...)`/`getPush(...)` builders (not read).

### 2.2 Remote (sidebar) - R module near 2588700
Observed: `buildSeparatedMenu([[Fetch {0}], [Edit {0}, Remove {0}], getServiceOptionItems(...), [getToggleRemoteHide(...), getToggleRemoteSolo(...)]])`, keys `ContextMenu-FetchRemote`, `ContextMenu-EditRemote`, `ContextMenu-RemoveRemote`; service group holds "Fork {0} ({1}) on {2}" (`ContextMenu-ForkRemoteOnService`), start-PR, deep link ("Copy link to remote: {0}").

### 2.3 Tag - R module 54044 (~2619000-2621500)
Observed order: `buildSeparatedMenu([pushItems, mergeAndRebaseItems, checkoutTag, checkoutCommit, worktreeCommit, [explain], [createBranch, cherrypick?, reset, revert], deleteItems, [copyTagName], [deepLinks], [hide?, solo], [annotateTag]])`.
- push: "Push {0} to {remote}" per remote, or submenu "Push tag to remote" with per-remote + "Push {0} to all remotes".
- merge/rebase only if merge states are known.
- `checkoutTag` ("Checkout the commit at {0}") only in left panel; graph shows "Checkout this commit" + worktree instead (`pr=Fn?[]:[getCheckoutCommit]`).
- Cherry pick omitted when tag sha is HEAD (`isSameSha`) or multi-select.
- delete: "Delete {0} locally", "Delete tag from remote" / "Delete {0} from {1}" / "Delete {0} from all remotes".
- Hide shown only in left panel (`Fn&&cr.push(getToggleRefHide)`), Solo always.
- last: "Annotate {0}" (`createAnnotatedTag`).

### 2.4 Stash - R module ~2612500-2613400
Observed: `buildSeparatedMenu([[Apply (ContextMenu-StashApply), Pop (ContextMenu-StashPop), Delete (ContextMenu-StashDelete)], [Edit stash message], cloudPatchItems("Share stash as Cloud Patch", only if drafts enabled), [Hide]])`.

### 2.5 Worktree - R module ~2625100-2626000
Observed:
```
buildSeparatedMenu([getWorktreeEditAndOpenAndRemoveItems, getWorktreeLockUnlockItems, getWorktreePruneItems])
```
- Open this worktree: hidden if `locked||prunable||currentWorkDir===wt.workdir`.
- Remove this worktree: hidden if `isMain` or current.
- Lock: not main and not locked; Unlock: when locked.
- Prune worktrees: only when `prunable` and a main worktree exists.

### 2.6 Tab - R module 68534 (~2616000)
Observed: `buildSeparatedMenu([[Close tab, Close other tabs (enabled: Ve.length>1), Close tabs to the right (enabled: idx<len-1), ...(renameLabel?[Rename tab]:[])], [Reopen Closed Tab (accelerator "CommandOrControl+Shift+T", enabled: canReopen)]])`. Tab operation enum: `BULK_CLOSE, BULK_CREATE, CLOSE, CREATE, LOAD_TABS, MOVE, REOPEN_LAST_CLOSED, SWITCH_TO, SWITCH_TO_INDEX, SWITCH_TO_NEXT...`. Rename tab = `promptSetAliasForTab`; string key `ContextMenu-RenameTab`, also `ContextMenu-AliasRepo`.

### 2.7 Misc small menus (Observed)
Left-panel header menu toggles sections ("Show/Hide all ...", "Maximize this section"); Teams: "Set activity status" > Active/Inactive; repo favorite toggle: "Favorite repository"/"Unfavorite repository"; text field menu has role "copy".

## 3. Graph rendering
- **Observed (tech)**: the graph is a shared npm package `node_modules/@source/source-components` v11.0.4 ("Source React components shared between the app and Source"), `main: dist/index.js` (362 KB minified), `dist/styles.css`, plus `.d.ts` for each component. Deps: `@source/react-virtualized 9.22.3-source.3`, `react 17.0.2`, `react-bootstrap`, `re-resizable`, `react-dragula`.
- **Observed**: rows are DOM, virtualized with react-virtualized `List` + `AutoSizer`: classNames `"graph-panel","react-virtualized-list","pad-for-horizontal-scrollbar"` and a separate list `"timeline-column"`. Zones (one virtualized column each) are in `dist/components/graph/rowRenderers/`: RefZoneRow, CommitZoneRow, CommitMessageZoneRow, CommitAuthorZoneRow, CommitShaZoneRow, CommitDateTimeZoneRow, ChangesZoneRow, TimelineMsgRow.
- **Observed (edges)**: lane lines/curves are SVG strings baked into a CSS background: `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g>...</g></svg>')` (index.js, cached per row key). Files `commitzone/Edges.d.ts, EdgeNodes.d.ts, CommitNode.d.ts, Gutter.d.ts, BackgroundStreak.d.ts, GraphAvatar.d.ts`.
- **Observed (canvas)**: canvas is used only for the scroll-marker minimap (`createElement("canvas",{className:"graph-scroll-markers"})`, `GRAPH_SCROLL_MARKER_LANES = 3`) and to convert avatars to dataURLs (`id="gk-graph-avatar-canvas"`). **Inferred**: not a canvas/WebGL graph; DOM + per-row inline SVG.
- **Observed constants** (`dist/domain/graph/GraphConstants.d.ts`): `GRAPH_ROW_HEIGHT = 28`, `GRAPH_ROW_INNER_HEIGHT = 22`, `GRAPH_HEADER_ROW_HEIGHT = 26` (`HEADER_ROW_HEIGHT = 22`), `COMMIT_ZONE_MARGIN_TOP/BOTTOM = 3`, `COMMIT_ZONE_EDGE_ARC_PADDING = 3`, `COMMIT_ZONE_DEFAULT_VIEWPORT_WIDTH_MIN = 56`, author avatar outer diameter 22, `REF_ZONE_TEXT_HEIGHT = 18`, `REF_ZONE_MAX_REFS_TO_RENDER = 100`, `COMMIT_NODE_MIN_ALPHA = 0.5`, `OPACITY_FACTOR_BY_THEME {dark, light}`, `DEFAULT_AVATAR_BACKGROUND_COLOR = "#199489"`. CSS var `--graph-row-height` exists in `DEFAULT_CSS_VARIABLES`.
- **Observed (palette, 10 lanes)** from R (two copies of the dark default variable map, offsets 6863525 and 6913195): `--graph-color-0..9` = `#15a0bf #0669f7 #8e00c2 #c517b6 #d90171 #cd0101 #f25d2e #f2ca33 #7bd938 #2ece9d` (also mirrored as `--column-N-color`, `--num-columns-supported: 10`). Derived tints per lane: `-f10`/`-f50` (rgba alpha 0.1/0.5 of the base), and opaque dark backgrounds `-bg50 / -bg45 / -bg25 / -bg15`, e.g. lane 0: `#195f71 / #195969 / #1a3f4a / #1b323a`; lane 1: `#11448d / #124082 / #173158 / #192943`.
- **Inferred**: lane index = column modulo 10; selected/hover rows use the `-bgNN` tints. Light theme uses a different alpha factor via `OPACITY_FACTOR_BY_THEME`.
- Graph exports (`dist/index.d.ts`): default `GraphContainer`; named `DndComponent`, `ScrollbarContainer`, everything from `components/graph/GraphContainer` and `types`. Package has ~992 files incl. its nested node_modules; dist file list is in section 3 of this doc's evidence (above).

## 4. Tabs / windows
- **Observed (main)**: one `BrowserWindow` class instance per app window: `be=new ae.BrowserWindow(ge);this.browserWindow=be` (M offset ~325559; `hideOnClose` option). A second `new BrowserWindow` is a hidden 100x100 "2.0.0 migration" helper (M ~472356). `BrowserView`: 0 hits. `WebContentsView`: 2 hits: (a) a hidden background renderer `new ae.WebContentsView({webPreferences:{contextIsolation:!1,nodeIntegration:!0,nodeIntegrationInWorker:!0}})` loading `src/render/static/entryPoints/requestHandler/index.html` (M ~373064); (b) a helper `getWindowFromWebContents` that searches `BaseWindow.getAllWindows()...contentView.children`.
- **Observed (renderer)**: tabs are Redux state, not separate webContents: reducer/saga with `$n.tabs`, `$n.selectedTabId`, `tabOperationTypes` (CLOSE, BULK_CLOSE, MOVE, REOPEN_LAST_CLOSED, SWITCH_TO...). Tab types: transient `NEW, REPO, RELEASE_NOTES, CLI`; permanent `FOCUS_VIEW, REPO_MANAGEMENT`; drag-reorder via `onSortEnd`/`TAB_TOOLTIP_HOVER_MS=600`.
- **Inferred**: one BrowserWindow = one renderer + one React/Redux store holding all repo tabs; repo switching swaps state (`getIsSafeToSwitchTabs` guard), plus a hidden node-enabled "request handler" renderer for background work. No per-tab BrowserView.

## 5. Git backend: hybrid
- **Observed**: bundled git CLI at asar-adjacent `git/bin/git` (and `git/libexec`, `git/share`): `GIT_EXEC_PATH=fromRoot(["libexec","git-core"])` (R, darwin), `getPackagedGitRootPath()`; Windows uses `mingw64/...`. Wrapper `runGitCmd({args:[...],options,bufferStdout,stdin})`.
- **Observed**: a `gkGit` facade object (R ~236 refs, M 22) forwards to a `git` CLI module (`un.git.<cmd>`), including: `revParse, config, forEachRef, branch, rebase, catFile, tag, revList, log, diffTree, writeTree, updateIndex, submodule*, remote, push, mergeBase, merge, lsTree, commitTree, apply, worktreeAdd/List/Lock/Unlock/Prune/Remove, updateRef, switch, status, stashPush/List/Drop/Apply, showRef, show`. Facade methods seen: `checkout, restore, resetToCommit, reflogDelete, stashPush/Apply/Drop, add, commit, cherryPick, fetch, push, createTag, status, getCommits, sortCommitsTopologically, aheadBehind, conflictCheck, mergeBase(IsAncestor), rebaseAbort, mergeAbort, maintenanceRun`.
  Evidence for log reading via CLI: `args:["rev-list","--format=tformat:%x00 %P%x00 %an%x00 %ae%x00 %at%x00 %cn%x00 %ce%x00 %ct%x00 %B%x00%x00",...,"--stdin"]` with `--topo-order`, `--max-count`, `--walk-reflogs`.
- **Observed**: nodegit is still used in the renderer (110 refs): fork `node_modules/@source/nodegit` version `0.28.0-alpha.36-s.1` (libgit2). Used for repo open/handles and `Merge`(19), `Diff`(15), `Checkout`(15), `Reference`(14), `Commit`(13), `Repository`(10), `Stash`(8), `Branch`(7), `Status`(6), `Index`(5), `Tag`, `Remote`; commit-graph walking: `createRevWalk`, `Revwalk.SORT.TIME|TOPOLOGICAL`, `fastWalk`, `fileHistoryWalk` (file history), `an.default.Revwalk.SORT.REVERSE|TOPOLOGICAL` with `push`/`hide` (range walks for rebase steps). `nodegit-flow` (gitflow) also in node_modules. About dialog credits libgit2 and nodegit.
- **Inferred split**: mutating/porcelain ops (rebase, cherry-pick, stash, push/fetch, reset, checkout restore, worktree, submodules, merge-base) = git CLI; read-heavy graph/history/diff/status = nodegit/libgit2 plus CLI `rev-list` bulk reads. A clone can use git CLI for everything (rev-list with the format above) and skip libgit2.

## 6. Left panel and commit detail panel
**Left panel (Observed, R ~680200)**: `ORDERED_LEFT_PANEL_HEADER_KEYS=[GITFLOW, LOCAL, REMOTE, WORKTREES, STASHES, CLOUD_PATCHES, PULL_REQUESTS, ISSUES, TEAM_VISIBILITY, TAGS, SUBMODULES, GITHUB_ACTIONS]` (variables `[ct,an,un,Rn,dn,it,ln,ht,gn,hn,mn,dt]` mapped via `HEADER_KEYS`). Default validity: `LOCAL, REMOTE, TAGS, SUBMODULES, WORKTREES` always true; `GITFLOW, CLOUD_PATCHES, ISSUES, PULL_REQUESTS, STASHES, TEAM_VISIBILITY, GITHUB_ACTIONS` conditional. Sizes: `REF_HEIGHT=24, HEADER_HEIGHT=30, SECTION_DEFAULT_HEIGHT=132, SECTION_MINIMUM_HEIGHT=108`. Section labels: "Local", "Remote", "Worktrees", "Stashes", "Cloud Patches", "Pull Requests", "Issues", "Teams", "Tags", "Submodules", "GitHub Actions", "Gitflow". Sections are collapsible, user-resizable, hideable per profile (`TOGGLE_CURRENT_PROFILE_HIDDEN_LEFT_PANEL_SECTION`). Local branches are organised into folders (`organizeRefsIntoFolders`, collapsed folders).
Header CSS var: `--left-panel-header-height: 60px`, `--toolbar-height: 48px`, `--info-bar-height: 26px`.

**Right commit detail panel (Observed, R module 4096 ~292000, and FileNodeListControls ~1402800)**:
- Commit info block `className:"commit-info-wrapper"` > `commit-info`: author avatar (size 40), author name (tooltip with email), authored date; if committer differs: second block `commit-info committed-by` with "committed" (`CommitterLabel`) + date (`formatDateTime`); optional "Co-authors:" row with 20px avatars.
- Parent line: `data-test-class="commit-detail-section-parent"`, label "parent:"/"Parents" with short-sha links separated by commas; click navigates (`onNavigateToParentCommit`), popup menu `onPopupCommitParentMenu`; copy sha menu `Jump to commit in graph` for parents not in the graph.
- Message summary + description (functions `getCommitMessageSummary/Description`; amend/reword edit in place via `RewordMode.DETAIL_PANEL`).
- File list controls (`FileNodeListControls`): toggle buttons "Path" (`FileNodeListControls-FullPath`, icon `far bars`, id `toggle-button-left`) and "Tree" (`...-TreeView`, icon `fas folder-tree`, id `toggle-button-right`); checkbox "View all files" (`RightPanel-ViewAllFiles`, shown only for a single selected sha; when ticked it shows a "Filter files" input and hides the Path button); sort toggle (sort-alpha up/down); header strings "{0} file changes on" (`RightPanel-NChangesOn`).
- Other states: multi-select "{0} commits selected"; WIP mode with tabs "Commit"/"Stash"/"Cloud Patch"/"Code Suggest" (`CommitDetailPanel-Tab-*`), "Working directory", diff between 2 commits / commit and WIP.
- **Inferred**: vertical order = commit sha/message header, author block (+committer, co-authors), parents, then file controls and the file list.

## 7. Dark theme colors (Observed)
Source: R default CSS-variable map (offset 6913195, duplicated at 6863525); only a dark set was found in the bundle. Light-theme JSON/celestialThemes files were NOT found in the asar (grep for "celestial" returned 0 hits in src/package.json); **Inferred** other themes are delivered elsewhere or generated by a theme system (`Theme-CircularReferenceAtKey` strings imply a key-evaluating theme engine in R).
- App background `--app__bg0: #1C1E23`; code bg `--code-bg: #1C1E23`; scroll thumb border `#1C1E23`.
- Toolbar: `--toolbar__bg0 rgb(42,45,52)`, `bg1 rgb(51,55,63)`, `bg2 rgb(65,70,80)`.
- Panels: `--panel__bg0 rgb(39,42,49)`, `bg1 rgb(50,54,63)`, `bg2 rgb(61,66,77)`; `--card__bg rgb(61,66,77)`; `--input__bg rgba(0,0,0,0.2)`.
- Borders: `--panel-border rgb(19,20,24)`, `--section-border rgba(255,255,255,0.08)`, `--subtle-border rgba(255,255,255,0.04)`; modal overlay `rgba(0,0,0,.5)`.
- Text: `--text-normal rgba(255,255,255,0.75)`, `--text-secondary 0.6`, `--text-disabled 0.4`, `--text-dimmed 0.2`, `--text-bright #FFFFFF`, `--text-accent #93A9EC`, `--text-inverse #222222`, `--link-color #40c5ec`.
- Accent / state: `--blue #4D88FF` (primary border, `--primary-bg rgba(77,136,255,0.2)`, `--form-control-focus #4D88FF`), `--green #5CB85C`, `--orange #DE9B43`, `--yellow #ECB91C`, `--red #D9413D`, `--ltblue #5bc0de`.
- Rows: `--hover-row rgba(77,136,255,0.1)`, `--selected-row rgba(77,136,255,0.2)`, `--wip-status rgba(77,136,255,0.4)`, `--checked-out rgba(92,184,92,0.3)`, `--soloed rgba(222,155,67,0.3)`, `--filter-match rgba(77,136,255,0.5)`, `--droppable rgba(236,185,28,0.3)`.
- Brand: `--axo-orange #e75225`, `--axo-ink #141422`, `--axo-cream #f9efc1`, `--axo-yellow #d8c13a`.
- Font: `--font-default: 'Open Sans', Arial, sans-serif`, mono `Monaco, Menlo, Ubuntu Mono, Consolas`, root `--font-size: 62.5%` (1rem = 10px; `--fs-3: 1.4rem`). Radii: button `.2rem`, input `3px`; scrollbar thickness 14px; handle width 7px.
- Terminal palette (xterm) also themed: bg `#000000`, fg `#FFFFFF`, selection `#304676`.

## 8. Caveats
- Minified single-line bundles; offsets are byte offsets and may differ by re-extraction. Variable names are mangled (e.g. `Ao`, `No`); group names in section 1.1 are mine.
- Several predicate selectors (`getIsDroppableBySha`, `getCanMoveUpForSha`, `getIsRewordableBySha`, branch `Pull/Push` builders, `Vr`) were not traced.
- Telemetry wrapper `wrapMenuItemWithTelemetry` adds `telemetryId` to every item (not user-visible).
