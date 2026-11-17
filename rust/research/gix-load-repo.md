# Moving loadRepo reads from the git CLI to gix

Scope: `loadRepo`, `stashTimes` and `detectOperation` in `src/repo.ts` (lines 108 to 230).
Goal: same output as the CLI, no process spawns (each spawn is slow on Windows).
Versions: gix 0.90.0 (latest on crates.io on 2026-11-17), gix-status 0.37.0, gix-traverse 0.64.0, git 2.50.1 (Apple Git) as the oracle.
Citations like `gix:src/x.rs:12` are inside `~/.cargo/registry/src/*/gix-0.90.0/`. Other crates are named in full.
The prototype is `rust/research/gix-load-repo-probe.rs` (a `main.rs` for a throwaway crate). `gix-load-repo-dag-gen.py` builds random DAGs with many equal commit times.

## 1. What the code runs today

All commands run with `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0` (`electron/main.ts:84`). FS is `\x1f`, RS is `\x1e`.

| # | Command | Used for |
|---|---|---|
| 1 | `for-each-ref --format=%(refname)FS%(objectname)FS%(*objectname)FS%(upstream:short)FS%(upstream:track,nobracket)FS%(HEAD)FS%(worktreepath) refs/heads refs/remotes refs/tags` | refs, tips, ahead/behind, current, worktree |
| 2 | `rev-parse --verify -q HEAD` | head sha |
| 3 | `symbolic-ref -q --short HEAD` | branch name |
| 4 | `stash list --format=%HFS%gdFS%PFS%gs` | stashes |
| 5 | `worktree list --porcelain` | worktrees |
| 6 | `remote -v` | remotes (first url per name) |
| 7 | `status --porcelain=v1 -z --untracked-files=all` | status |
| 8 | `config -f .gitmodules --get-regexp path` | submodule paths |
| 9 | `log --date-order -n<limit> --format=%HFS%PFS%anFS%aeFS%atFS%sRS [--branches --remotes --tags] --stdin --` with ref names plus `HEAD` on stdin | commit list |
| 10 | `show -s --format=<same as 9> <stash shas>` (stashTimes) | stash commit details |
| 11 | `rev-parse -q --verify REBASE_HEAD / MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD` (4 spawns) | operation |
| 12 | `status --no-ahead-behind`, regex on the text | rebase without REBASE_HEAD |

That is up to 15 spawns per load (8 in parallel, then log, show, 4 in parallel, then status).

## 2. Per command

### 1. for-each-ref (verdict: gix with caveats, equal output after three fixes)

API: `repo.references()?.prefixed("refs/heads/")` (and remotes, tags). Iteration order matches the CLI order here because the three prefixes sort the same way as refnames.
Features: none beyond the default set.

Traps and findings:
- Peeled tags. The doc for `%(*objectname)` reads like one level. Measured on a tag of a tag: git prints the final commit (all levels peeled). Use `Reference::peel_to_id()` (`gix:src/reference/mod.rs:107`), which peels fully. Taking `Tag::target_id()` one level gives the inner tag and does NOT match. Tags to trees or blobs give that object in both.
- Symbolic refs (`refs/remotes/origin/HEAD`) make `Reference::id()` panic (`gix:src/reference/mod.rs:33`). Use `try_id()` then `follow()`, or skip them as `parseRefs` already does.
- `%(upstream:short)`. `Repository::branch_remote_tracking_ref_name(name, Direction::Fetch)` (`gix:src/repository/config/branch.rs:113`) maps via the remote's fetch refspec. Then `.shorten()`. Equal on all tests. Two gaps:
  - `branch.X.remote = .` (upstream is a local branch): gix returns `None`, git returns the local branch. Fixed in the prototype by reading `branch.X.remote` and `branch.X.merge` from config. Tested: git gave `main`, 2 ahead 1 behind; plain gix gave nothing.
  - `shorten()` is not git's `shorten_unambiguous_ref`. If a local branch is also named `origin/main`, git prints `remotes/origin/main`. Rare. Not handled.
- `%(upstream:track,nobracket)`. gix has no ahead/behind API (grep for ahead/behind in gix returns only unrelated doc text). Compute it: ahead = count of `rev_walk([local]).with_hidden([up]).all()`, behind = the reverse (`gix:src/revision/walk.rs:251`). The TS only reads the two numbers, so "gone" (upstream configured, ref missing) maps to 0 and 0 and the prototype matches that. Cost: each count walks until the merge base; fine on the test repos.
- `%(HEAD)` prints `*` for the current branch and a space for others (not empty). The TS tests `=== "*"`, so equal. Compare `repo.head_name()` to the ref name.
- `%(worktreepath)`. Measured: git fills it for the MAIN worktree too and for linked ones, only for `refs/heads`. Build a map from `head_name()` of the main repo plus each `repo.worktrees()` proxy (`into_repo_with_possibly_inaccessible_worktree()`). Equal on tests including a prunable (missing) worktree whose branch git still reports.
- Windows: git prints `C:/x/y`. gix returns `PathBuf` with backslashes. Normalise to `/` (the prototype's `norm`). Not testable here.

### 2 and 3. HEAD sha and branch name (verdict: gix, high confidence)

`repo.head_id()` (error on unborn becomes `None`) and `repo.head_name()` then `shorten()`. Detached gives `None` in both. Equal on all repos including a detached linked worktree.

### 4. stash list (verdict: gix, high confidence)

gix has no stash API. Read the reflog of `refs/stash`: `repo.try_find_reference("refs/stash")?.log_iter().rev()` (`gix:src/reference/log.rs:13`, `gix-ref-0.69.1/src/store/file/log/iter.rs:51`). Entry `i` newest first is `stash@{i}`, `new_oid` is `%H`, `message` is `%gs`, parent 0 of that commit is `base`. Equal with two stashes, one with a custom message ("On main: my stash msg") and one default ("WIP on main: ...").
Trap: the reflog lives in `.git/logs/refs/stash`; `%gd` here is the plain index form because no `--date` is passed.

### 5. worktree list --porcelain (verdict: gix, high confidence)

API: `repo.main_repo()?` for the main entry, `repo.worktrees()` for linked ones (`gix:src/repository/worktree.rs:59`, sorted by git dir name, same as git). `Proxy::is_locked()` and `is_prunable()` (`gix:src/worktree/proxy.rs:60,68`) mirror git: locked means a `locked` file; prunable means not locked and the `gitdir` target is missing. `Proxy::base()` (`proxy.rs:43`) is the path. HEAD and branch come from `into_repo_with_possibly_inaccessible_worktree()` (needed when the checkout was deleted).
Tested: main, linked, detached, locked with reason, and a deleted checkout (prunable). All equal.
Trap: git only reports prunable after its own checks (missing gitdir file or target). gix uses the same two conditions. Git also has an expiry grace for `worktree prune`, not for the list. Bare main repo: `main` flag logic in the TS assumes the first block is main; keep that.
Windows: normalise slashes.

### 6. remote -v (verdict: gix, high confidence)

API: `repo.remote_names()` then `find_remote(name)?.url(Direction::Fetch)` then `to_bstring()` (`gix:src/remote/access.rs:133`). `find_remote` applies `url.<base>.insteadOf` rewrites on construction (`gix:src/repository/remote.rs:10,68`), which is what `git remote -v` prints. Tested with an insteadOf remote, an scp-style url and a relative path: all equal to the CLI string.
Gaps: remotes defined only in legacy `.git/remotes/*` or `.git/branches/*` files are not seen by gix. A remote with only `pushurl` has no fetch url, same as `remote -v` showing only the push line, but the TS takes the first line, so it would show the push url. Ultra rare.

### 8. config -f .gitmodules --get-regexp path (verdict: gix, and gix is more correct)

API: `repo.submodules()?` then `Submodule::path()` (`gix:src/repository/submodule.rs:100`).
Finding: the CLI regex `path` matches any KEY containing "path", not just `.path`. A submodule named `path-utils` makes `submodule.path-utils.url` match, and `repo.ts` then reports the url as a submodule path. Reproduced: CLI printed `libs/foo`, `tools/pu`, `../sub1`; gix printed the first two. The TS must not keep this bug, so the output is intentionally not byte equal in that case.
Also: `-f .gitmodules` is relative to cwd, so from a subdirectory the CLI returns nothing. gix reads from the worktree root.

### 9 and 10. log --date-order -n (verdict: gix for object access, but NOT gix's own topo walker; use a ~40 line port of git's algorithm)

What gix offers:
- `gix::traverse::commit::topo::Builder` with `Sorting::DateOrder` (`gix-traverse-0.64.0/src/commit/topo/mod.rs:26-51`, "equivalent to `git rev-list --date-order`"). The simple walker `Sorting::ByCommitTime` is NOT topological (`gix:src/revision/walk.rs:20-55`).
- Measured on 7 random 500-commit DAGs with 1 to 1000 distinct commit times, 25 branches, 30% merges: the set of commits is identical but the ORDER differed from git in 7 of 7. On real repos (glasshouse, Whisparr, qui, Maintainerr-fork) it matched, because ties are rare there.
- Cause: git breaks date ties by insertion order (first in, first out). gix uses `std::collections::BinaryHeap` (`gix-revwalk-0.38.0/src/lib.rs:49`, `queue.rs:71`), which has no tie-break. Also git first runs `limit_list` (a date-ordered pre-walk that fixes the initial list order) and then Kahn's algorithm. The gix comment at `gix-traverse-0.64.0/src/commit/topo/iter.rs:21-25` says as much about Git's queue.
- Tie cases are common in practice: rebases, `cherry-pick`, scripted commits and imports produce many commits in the same second.

What works (in the prototype, `git_date_order`): read commits with gix (`find_commit`, committer seconds, parent ids), then
1. Put tips (in git's order: branches, remotes, tags, each sorted by name, then HEAD; hidden or solo mode uses the filtered refs in `for-each-ref` order, then HEAD) in a queue keyed by (date descending, insertion counter). Pop, append to a list, insert unseen parents with the next counter. This is `limit_list`.
2. indegree = 1 for all in the list, +1 per child edge inside the list. Push indegree-1 commits in list order into a max-heap keyed by (date, reverse counter). Pop, decrement parents, push when a parent reaches 1. This is `sort_in_topological_order`.
3. Stop after `limit` commits (git also walks everything first when `--date-order` is set, so the cost is the same).
Result: 40 of 40 random DAGs (seeds 10 to 49, 1 to 7 distinct times, `-n150`) plus seeds 1 to 7 (`-n120` and `-n5000`) equal; all real repos equal; scenario repo with skewed clocks (a 2030 commit with a 2019 child) and a 2-parent octopus merge equal.

Other traps:
- Tips: peel annotated tags to commits and skip non-commits (a tag of a tree). The prototype does `peel_to_id` then checks kind. `refs/remotes/origin/HEAD` is included by `--remotes` in git, so include it too (same commit, deduped).
- Subject. `message().summary()` trims leading whitespace and does not match `%s` (found on Whisparr and Cleanuparr: a message with a leading space after the blank line). Git's `%s` skips leading blank lines, joins lines of the first paragraph with a space, trims trailing whitespace, KEEPS leading spaces. The prototype's `git_subject` does this. Use `message_raw_sloppy()`.
- `%an` and `%ae` are raw (no mailmap). Use `author().name/email` without the mailmap feature.
- Not handled: commit encoding headers (git re-encodes to UTF-8 for output, gix does not), shallow files and grafts or `refs/replace` (git applies them in `log`; not tested for gix). If the app supports shallow clones, keep the CLI for those.
- Speed. gix without an object cache was 3 times slower than git on a 3000-commit log (171 ms against 64 ms). With `repo.object_cache_size_if_unset(32 * 1024 * 1024)` it is on par (49 to 55 ms against 60 to 64 ms). On repos under 2000 commits it is faster than git. No repo here has a commit-graph file; with one, gix would be faster still.
- stashTimes (`show -s`): `find_commit(sha)` with the same format code. Trivial.

### 7. status --porcelain=v1 -z --untracked-files=all (verdict: gix with caveats; equal on all tested scenarios)

API: `repo.status(gix::progress::Discard)?.untracked_files(UntrackedFiles::Files).into_iter(None)` (`gix:src/status/mod.rs:89`, `iter/mod.rs:42`). It yields two kinds of items: `TreeIndex` (HEAD against index, the X column) and `IndexWorktree` (index against worktree, the Y column, plus untracked). Features: `status` (pulls dirwalk, index, blob-diff, attributes). You must merge both streams by path into one `XY` entry and sort by path bytes, then append untracked sorted. The prototype does this in about 50 lines.

Mapping used and verified:
- Tree-index: Addition `A`, Deletion `D`, Modification `M` (or `T` if the file type bits differ), Rewrite `R` with `source_location` as `orig` (copy `C`).
- Index-worktree: Removed `D`, Type `T`, Modification and submodule change `M`, IntentToAdd `A` (git shows ` A`), Conflict by summary: BothDeleted `DD`, AddedByUs `AU`, DeletedByThem `UD`, AddedByThem `UA`, DeletedByUs `DU`, BothAdded `AA`, BothModified `UU`. Verified `DU`, `UD`, `UU`, `AA` in real merge, cherry-pick, revert and rebase conflicts. `DD`, `AU`, `UA` are mapped from the enum names, not exercised.
- Untracked: `DirectoryContents` with status Untracked. `Files` mode lists every file (like `=all`). Nested repositories have kind `Repository` and git prints them as `nested/`; append `/` in that case. Ignored entries are skipped.

Tested equal to the CLI (same order): rename in index (`R  a -> b`), `MM`, ` M` from exec-bit change, ` D`, ` T` (file to symlink), intent-to-add, nested repo, untracked dirs expanded, ignored file, names with spaces and non-ASCII, submodule with new commits (` M`) and with dirty or untracked content (` m`), CRLF files with `core.autocrlf=true` and `.gitattributes text=auto` plus an `-text` file, `core.fileMode=false`, a same-size edit right after an index write (racy), and conflicts during merge, cherry-pick, revert, rebase.
Mechanics behind that (source): content compare runs the same to-git filter pipeline with attributes (`gix:src/status/index_worktree.rs:111`, `Mode::ToGit`); filemode and symlink handling come from `filesystem_options()` (`index_worktree.rs:102`, includes `core.ignoreCase`, `core.fileMode`, `core.symlinks`); rename tracking in the index follows `status.renames` or `diff.renames` through `TrackRenames::AsConfigured` (`gix:src/status/tree_index.rs`; rename detection was only exercised on one small rename, so thresholds are unverified).

Index refresh: gix never writes the index in `status`. Writing needs an explicit `Outcome::write_changes()` (`gix:src/status/iter/types.rs:88`), which we do not call. This equals `GIT_OPTIONAL_LOCKS=0`. Side effect is the same as the CLI with that env: stat-dirty files are re-hashed on every load.
Windows traps (not testable on this Mac): gix defaults `core.fscache` to on for Windows (`index_worktree.rs:104`); `core.symlinks=false`, `core.ignoreCase`, long paths and files being written during the read are the likely sources of differences. Run the same probe on a Windows box before switching. A cheap guard: keep the CLI as a fallback behind a setting.
Other caveats: rename detection limits and ties can differ on huge changes (git `diff.renameLimit`); worktree-side renames are not shown by porcelain v1 and are off here too (`index_worktree_rewrites(None)` default). Submodule `ignore` settings in `.gitmodules` or config are honoured by gix (`Submodule::AsConfigured`), matched in the test. Sparse checkout and `skip-worktree` were not tested.
Speed: Whisparr (large worktree, 13k commits) 44 ms in gix against 151 to 175 ms CLI, because gix hashes in parallel.

### 11 and 12. Operation detection (verdict: gix open, but write the check by hand, high confidence)

`Repository::state()` (`gix:src/repository/state.rs:8-40`) exists but returns different answers than `detectOperation`: it checks rebase dirs first, then `CHERRY_PICK_HEAD`, `MERGE_HEAD`, `BISECT_LOG`, `REVERT_HEAD`, and has `ApplyMailbox` and `Bisect` states. The TS gives `REBASE_HEAD` first, then `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, and treats a `git am` session and bisect as "no operation". The ordering matters when a merge starts during an interactive rebase edit stop.
Do it by hand with `repo.path()` (the git dir; for a linked worktree it is the per-worktree dir, as for the CLI):
- `REBASE_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` as files, in the TS order. (The CLI `rev-parse --verify REBASE_HEAD` also resolves to a valid commit; a stale empty file is the only difference.)
- else `rebase-merge/` is a directory, or `rebase-apply/` is a directory without `rebase-apply/applying`. This is what `git status` prints "rebase in progress" for, so it replaces the text regex, which also needed `LC_ALL=C`.
Tested equal in merge, cherry-pick, revert, rebase stopped on conflict (`REBASE_HEAD` present) and interactive rebase stopped at `edit` (only `rebase-merge/` present).
Cost: 5 stats instead of 5 spawns.

## 3. Verdict table

| Command | Verdict | Confidence |
|---|---|---|
| for-each-ref | gix with caveats (full peel, local upstream `.`, manual ahead/behind, worktree map, slashes) | high after fixes |
| HEAD, branch | gix | high |
| stash list, show | gix (reflog) | high |
| worktree list | gix | high |
| remote -v | gix | high |
| .gitmodules paths | gix (fixes a CLI bug) | high |
| log date-order | gix objects plus own port of git's algorithm. Do NOT use gix-traverse Topo | high (47 random DAGs plus 6 real repos equal) |
| status | gix with caveats (merge two streams, Windows untested) | medium to high on macOS, unknown on Windows |
| operation | hand-written file checks (not `Repository::state()`) | high |

Nothing needs to stay on the CLI on current evidence, except shallow or grafted repos for the log (untested) and anything run on Windows until the probe is repeated there.

## 4. Timing (release build, macOS arm64, git 2.50.1, spawn about 6 ms here)

Cold is the first call in a fresh process. Warm is the median of 10 runs (5 for log), each with a fresh `gix::open` and a 32 MB object cache. CLI times are single spawns, not parallel. File cache is warm in both columns (no root to purge). Milliseconds.

glasshouse (1564 commits, `-n2000`):

| command | equal | cli cold | cli warm | gix cold | gix warm |
|---|---|---|---|---|---|
| for-each-ref | yes | 18.4 | 9.4 | 2.0 | 1.6 |
| head and branch | yes | 13.7 | 12.5 | 0.4 | 0.3 |
| stash list | yes | 6.2 | 6.4 | 0.2 | 0.1 |
| worktree list | yes | 6.2 | 6.5 | 0.4 | 0.3 |
| remote -v | yes | 7.2 | 6.3 | 0.3 | 0.1 |
| .gitmodules | yes | 7.1 | 6.3 | 1.7 | 0.4 |
| status | yes | 11.6 | 9.0 | 2.8 | 1.5 |
| operation (5 spawns in CLI) | yes | 36.5 | 40.3 | 0.3 | 0.1 |
| log -n2000 | yes | 18.3 | 19.0 | 11.1 | 12.0 |

rea-source (39 commits): for-each-ref 11.3 / 7.4 against 1.1 / 0.3; status 7.9 / 8.0 against 4.7 / 1.1; log 13.2 / 8.0 against 1.2 / 1.1; all other rows 6 to 13 ms against 0.1 to 0.3 ms. All equal.

Whole `loadRepo` wall time (CLI as the TS runs it: parallel batches; gix sequential on one open):

| repo | commits | cli first | cli warm | gix first | gix warm |
|---|---|---|---|---|---|
| rea-source | 39 | 38.8 | 38.2 | 2.9 | 2.5 |
| glasshouse | 1564 | 50.8 | 53.1 | 13.6 | 13.0 |
| Maintainerr-fork | 3000 of 4505 | 104.5 | 103.4 | 44.5 | 43.5 |
| Whisparr (large worktree) | 3000 of 13749 | 447.0 | 401.3 | 96.6 | 93.4 |

Equality across all rows: every row `true` on rea-source, glasshouse, Whisparr, Maintainerr-fork, qui, Cleanuparr and the scenario repos once the fixes above were in. Before the fixes: for-each-ref differed on tag of tag, upstream `.`, and a `%(HEAD)` space; log differed on subject leading space and, for gix Topo, on tie order; `.gitmodules` differed on the `path-utils` key.

Windows: not measured. If a spawn costs 50 to 100 ms there (typical with antivirus), the 15 spawns cost 100 to 300 ms of wall time even in parallel batches, against the 3 to 45 ms of in-process work above. Repeat the probe on Windows before trusting the status row.

## 5. Recommended version and features

```toml
gix = { version = "0.90.0", default-features = false, features = ["status", "revision", "parallel", "sha1", "max-performance"] }
```
This compiled and produced all results above (the tests used the larger set `status, blob-diff, revision, mailmap, dirwalk, index, parallel, worktree-mutation` first, then this smaller one). Do not enable `mailmap` (the TS wants raw `%an`/`%ae`) or `worktree-mutation`. `status` already brings `dirwalk`, `index`, `blob-diff` and `attributes` (needed for autocrlf and `.gitattributes`). `revision` brings `rev_walk` for ahead/behind. The prototype also lists `gix-status = "0.37.0"` only for the `EntryStatus` and `Conflict` enum names; the port can import them from there too, since gix does not re-export them. The pinned `0.90.0` should be bumped with a rerun of the equality probe, because gix changes status and worktree details between minors.
Set `object_cache_size_if_unset(32 MB)` for the log. Keep one `Repository` per load; open cost is 0.2 to 1 ms.

## 6. Next steps if this is adopted

1. Port the probe functions into `rust/repo/src/port.rs` behind the existing napi surface; keep the CLI path as a fallback switch.
2. Add the equality probe as a test run against a few fixture repos (the scenario scripts are small), and run it on Windows.
3. Decide on shallow and grafted repos (keep CLI for log) and on the rare `origin/main` ambiguity in upstream names.

Note: while this research ran, `git status` in `rea-source` showed modified `rust/` files that this work did not touch (the research only wrote under `rust/research/`).
