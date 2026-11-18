# Glossary

Each term has one name in TypeScript and one name in Rust. Use these names in every unit.

| Term | Meaning | TypeScript | Rust |
| --- | --- | --- | --- |
| Repo data | All data that one refresh loads for a repository | `RepoData` in `src/repo.ts` | `RepoData` |
| Commit | One commit row in the graph | `Commit` in `src/repo.ts` | `Commit` |
| Ref | A local branch, a remote branch or a tag | `Ref` in `src/repo.ts` | `Ref` |
| Stash | One entry of `git stash list` | `Stash` in `src/repo.ts` | `Stash` |
| Worktree | One entry of `git worktree list` | `Worktree` in `src/repo.ts` | `Worktree` |
| Operation | A merge, rebase, cherry-pick or revert in progress | `Operation` in `src/repo.ts` | `Operation` (enum) |
| Status entry | One line of `git status --porcelain=v1 -z` | `StatusEntry` in `src/repo.ts` | `StatusEntry` |
| Git result | Exit code, stdout and stderr of one `git` run | `GitResult` in `test/reference/api.ts` | `git::GitResult` |
| Menu spec | One context menu item from the UI | `MenuSpec` in `src/api.ts` | `menu::MenuSpec` |
| Open repository | A folder with an active watcher. File commands work only inside it. | `insideOpenRepo` in `electron/main.ts` | `paths::inside` with `watch::Watchers` |
| Graph row | The lane, color and line segments of one commit row | `GraphRow` in `src/repo.ts` | `graph::port::GraphRow` |
| Diff source | The two sides of a diff: a commit, the index or the working tree | `DiffSource` in `src/repo.ts` | `loaders::DiffSource` (enum) |
| Parsed diff | The file header and the hunks of one file diff | `ParsedDiff` in `src/diff.ts` | `diff::port::ParsedDiff` |
