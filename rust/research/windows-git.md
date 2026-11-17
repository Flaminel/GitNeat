# Running git fast on Windows from the Rust backend

Date: 2026-11-17. Scope: `rust/app/src/git.rs` (tokio `Command`, `git` looked up on PATH, `CREATE_NO_WINDOW` already set).

Honesty note. I found no primary source that gives millisecond numbers for process start on Windows versus Unix. Every claim below is either quoted from a source or marked as inference. Section 1 ends with a benchmark you can run on the slow laptop to settle it.

Sources are given as repo paths on GitHub. Names: `git/git` is upstream Git. `git-for-windows/git` is the Windows fork. `git-for-windows/MINGW-packages` holds the wrapper source. `git-for-windows/build-extra` holds the installer script.

## 1. Cost of a git process start on Windows, and the cmd\git.exe shim

### Answer

Windows has no fork. Every `git` call is a `CreateProcess`, which builds a new address space, loads the exe and its DLLs, and starts a fresh runtime. Unix forks a copy of the parent and execs. This is why git scripts and GUIs feel slower on Windows. This is general OS knowledge, not a quote from a source I fetched, so treat the size of the gap as unmeasured.

The `git.exe` that Git for Windows puts on PATH is a shim. The installer script runs `AppDir+'\cmd\git.exe'` as the user-facing git (`git-for-windows/build-extra`, `installer/install.iss`, lines 618, 654, 1076, 2799). The shim source is `git-for-windows/MINGW-packages`, `mingw-w64-git/git-wrapper.c`. Its header says "git-wrapper - replace cmd\git.cmd with an executable". What it does, from that file:

- It finds its own real path, then builds the target path as top level plus `mingw64\bin` (`msystem_bin`, built around line 669) plus the file name.
- It extends PATH and sets MSYSTEM, HOME, PLINK_PROTOCOL in `setup_environment` (lines 124 to 205).
- It then calls `CreateProcess` (line 880 area) and, when `wait` is set, `WaitForSingleObject(pi.hProcess, INFINITE)`, then `GetExitCodeProcess`, then `ExitProcess(r)` (lines 880 to 912). It does not exec in place. Windows cannot do that.

So `cmd\git.exe` costs two process starts per call: the small shim, then the real `mingw64\bin\git.exe`. The shim is small and statically light, so the extra cost is one extra `CreateProcess`, one PATH rewrite, and one more pass of whatever Defender does on process creation. Inference: that is probably single-digit to low tens of milliseconds on a slow laptop with real-time scanning. I could not confirm a number.

The real `mingw64\bin\git.exe` is a native MinGW build, not an MSYS2 program. The MSYS2 runtime (`msys-2.0.dll`) is only loaded by tools under `usr\bin` such as `sh.exe`, `ssh.exe`, `bash.exe`. Plain read commands (`status`, `log`, `diff`, `show`, `rev-parse`) do not start `sh`. Hooks, `git-pull`-style scripts, aliases starting with `!`, and ssh transports do. I did not fetch a primary page that states this split in words. I infer it from `git-for-windows/git` `compat/mingw.c`, which implements the Windows port directly over Win32, and from the wrapper naming `usr\bin` separately.

`core.fscache` is a Git for Windows only setting. The docs (`git-for-windows/git`, `Documentation/config/core.adoc`, line 732): "Enable additional caching of file system data for some operations. Git for Windows uses this to bulk-read and cache lstat data of entire directories (instead of doing lstat file by file)." The code is `compat/win32/fscache.c`. Each process builds the cache anew, so it only helps within one command.

Defender: I fetched no Microsoft page on this. It is standard that real-time scanning checks each exe and DLL load and file write. Treat it as a likely multiplier on both process starts and on the many small file reads git does. Advice below (exclusions) is a recommendation to the user, not a measured fact.

Is direct `mingw64\bin\git.exe` faster? Skipping the shim removes one `CreateProcess` and the wrapper's PATH work, so it should be faster per call. Caveats from the wrapper source:

- The shim sets MSYSTEM, HOME (from HOMEDRIVE+HOMEPATH or USERPROFILE), PLINK_PROTOCOL and prepends `mingw64\bin`, `usr\bin` to PATH. If you launch the real exe directly, a GUI started from Explorer may lack some of that. Git itself also fixes up some of it at startup (`git-for-windows/git` `compat/mingw.c` has `ENSURE_MSYSTEM_IS_SET` handling near line 4065, which sets MSYSTEM when empty). Hooks and ssh may then not find `sh` or `ssh`.
- Safe approach: use the real exe for read-only, non-network commands (status, log, diff, show, rev-parse, cat-file, branch, for-each-ref, blame). Keep PATH-resolved `git` for fetch, pull, push, commit (hooks run), and anything that might run a hook or ssh. Or, when you use the direct path for everything, copy the PATH and MSYSTEM setup the shim does. Test with a repo that has a pre-commit hook.

### Finding it reliably

`git --exec-path` prints the exec dir. The docs for the option (`git/git`, `Documentation/git.adoc`): "Path to wherever your core Git programs are installed. This can also be controlled by setting the GIT_EXEC_PATH environment variable. If no path is given, 'git' will print the current setting and then exit." On Git for Windows this is `<install>/mingw64/libexec/git-core`. The wrapper source confirms the layout: it uses `libexec\git-core` (line 730) and `mingw64\bin`. So `<install>/mingw64/bin/git.exe` is two directories up from the exec path, then `bin\git.exe`: `exec_path/../../bin/git.exe`. Note `git-core` itself also contains a `git.exe`. That one works too, but use `bin`.

Run `--exec-path` once through the shim at startup, cache the answer, and fall back to PATH `git` if the derived file does not exist (MinGit, portable Git, ARM64 builds `clangarm64`, and 32-bit builds `mingw32` have other folder names). Note the app currently blocks `--exec-path` from the UI (`BLOCKED` in `git.rs`). That block is for UI input, so a separate internal call that does not pass through `blocked()` is fine.

Alternative with no extra process: scan PATH for `cmd\git.exe`, then take `..\mingw64\bin\git.exe`. This needs no spawn, but depends on the layout.

### Recommendation for git.rs

1. Add a `OnceLock<String>` for the git program. On Windows resolve it once with one `git --exec-path` spawn, derive `<exec>/../../bin/git.exe`, check it exists, else use `"git"`. On other OS return `"git"`.
2. Use it in `command("git")` for the read-only allowlist only at first. Measure before widening.
3. Benchmark on the laptop before committing to this. In PowerShell: `Measure-Command { 1..100 | % { & "C:\Program Files\Git\cmd\git.exe" rev-parse HEAD } }` against the same with `...\mingw64\bin\git.exe`. Run it in a repo, and again after adding a Defender process exclusion for git.exe to see the scan share.
4. Give the user a tip: Defender exclusions for the Git install folder and for the repo folders (Microsoft Defender exclusion settings). I did not verify it against a Microsoft page here.

## 2. Config that speeds up reads, and per-call env vars

### What each setting does (from upstream docs)

- `core.fscache`: Git for Windows only. Bulk-reads and caches lstat data for entire directories, see section 1. Per `git-for-windows/git` `Documentation/config/core.adoc`. I did not check its current default. It is on by default in recent Git for Windows installers, but I did not verify it, so set it explicitly in the env call if you want to be sure.
- `core.preloadIndex`: `git/git` `Documentation/config/core.adoc`: "Enable parallel index preload for operations like 'git diff'". "Defaults to true." Already on. No action.
- `core.untrackedCache`: "Determines what to do about the untracked cache feature of the index. It will automatically be added if set to `true`. And it will automatically be removed, if set to `false`." Caches untracked directory scans between status runs. It writes into the index, so setting it per call can modify the index file. Do not force it for a read-only GUI unless you accept an index rewrite. `feature.manyFiles` sets it too, see below.
- `core.fsmonitor`: "If set to true, enable the built-in file system monitor daemon for this working directory." "Like hook-based file system monitors, the built-in file system monitor can speed up Git commands that need to refresh the Git index (e.g. `git status`) in a working directory with many files." Platforms: "Currently, this includes Windows and MacOS." The daemon doc (`Documentation/git-fsmonitor--daemon.adoc`) says commands "will ask the daemon for changes and automatically start it (if necessary)", that it watches "a single working directory", and that it does not run by default on network-mounted repos (`fsmonitor.allowRemote` overrides, experimental).
  Side effects: one long-lived daemon process per repo. The Git for Windows installer even has code to stop daemons (`install.iss` line 654 runs `fsmonitor--daemon stop`) because a running daemon holds the folder. A GUI that turns this on per call would spawn daemons the user did not ask for, and they would linger after the app closes. For a repo with many files it is the biggest single win for `status`, but it is a decision to put behind a setting, not a silent default.
- `feature.manyFiles`: `git/git` `Documentation/config/feature.adoc`: "Enable config options that optimize for repos with many files in the working directory." It sets `index.skipHash=true` (faster index writes), `index.version=4` (path prefix compression), `core.untrackedCache=true`. Most of this affects index writes, so it matters less for a read GUI.
- `index.threads`: `git/git` `Documentation/config/index.adoc`: "Specifies the number of threads to spawn when loading the index." 0 or true means auto-detect CPUs. 1 or false disables threading. Default is true. Already on. On a slow dual-core laptop, thread startup may cost more than it saves on small repos. Inference, not measured.

### Per-call env without touching user config

Upstream `git/git` `Documentation/git-config.adoc`: "If GIT_CONFIG_COUNT is set to a positive number, all environment pairs GIT_CONFIG_KEY_<n> and GIT_CONFIG_VALUE_<n> up to that number will be added to the process's runtime configuration. The config pairs are zero-indexed. Any missing key or value is treated as an error. ... These environment variables will override values in configuration files, but will be overridden by any explicit options passed via `git -c`." "This is useful for cases where you want to spawn multiple git commands with a common configuration but cannot depend on a configuration file."

So every setting above is settable this way, since they are ordinary config keys. They only apply to that child process. The user's `.gitconfig` is never written. Two cautions:

- A missing key or value is an error, so write them in a loop that keeps the count right.
- Env pairs outrank config files, so they would override a user who deliberately turned something off, for example `core.fsmonitor=false` or `core.untrackedCache=false`. Only set keys the user has not set, or accept the override.
- Children of git (hooks, submodule helpers) inherit the env. That is usually fine for these keys.

Also relevant and already in git.rs: `GIT_OPTIONAL_LOCKS=0` is documented in `git/git` `Documentation/git.adoc`: "If this Boolean environment variable is set to false, Git will complete any requested operation without performing any optional sub-operations that require taking a lock." Keep it. It stops `git status` from rewriting the index in the background, which is the right behavior for a GUI that polls.

### Recommendation for git.rs

Add a small helper that appends env pairs and call it from `run_git`. Start with a safe set only, applied on Windows:

```rust
// ponytail: fixed list, make user-configurable if someone needs to opt out
const WIN_CFG: [(&str, &str); 2] = [("core.fscache", "true"), ("core.preloadindex", "true")];
fn win_config(cmd: &mut Command) {
    cmd.env("GIT_CONFIG_COUNT", WIN_CFG.len().to_string());
    for (i, (k, v)) in WIN_CFG.iter().enumerate() {
        cmd.env(format!("GIT_CONFIG_KEY_{i}"), k).env(format!("GIT_CONFIG_VALUE_{i}"), v);
    }
}
```

Call it before `.envs(env.unwrap_or_default())` so a caller-supplied env still wins. Do not add `core.fsmonitor` or `core.untrackedCache` by default. Offer `core.fsmonitor=true` as an opt-in setting for large repos, with a note about the daemon. Measure `git status` with and without on the real repo first (`GIT_TRACE2_PERF=1` can show where time goes, but I did not fetch that page to cite it).

Caveat: if the caller already sets `GIT_CONFIG_COUNT` through `env`, your pairs collide. Merge by index, or error out.

## 3. `git diff --no-index -- /dev/null <file>` on Git for Windows

### Answer

Yes, it works. Git handles `/dev/null` as a literal string in three places, so it does not depend on the OS having that path.

1. `git/git` `diff-no-index.c`, `get_mode()`:

   ```c
   if (!path || !strcmp(path, "/dev/null")) {
       *mode = 0;
   #ifdef GIT_WINDOWS_NATIVE
   } else if (!strcasecmp(path, "nul")) {
       *mode = 0;
   #endif
   } else if (path == file_from_standard_input) {
   ```

   So on a native Windows build both `/dev/null` and `nul` mean "empty side", mode 0, without any stat call. The `nul` branch is only for Windows.
2. `git/git` `compat/mingw.c`: the Windows `open`, `fopen` and `freopen` replacements do `if (filename && !strcmp(filename, "/dev/null")) wcscpy(wfilename, L"nul");` (lines 863, 952, 981 upstream). The Git for Windows fork has the same code at lines 1196, 1290, 1319 of `git-for-windows/git` `compat/mingw.c`. So even where git opens the path, `/dev/null` becomes the Windows `NUL` device.
3. The stat replacement in the same file returns success early for these names: `if (!strcmp("nul", filename) || !strcmp("/dev/null", filename)) return 0;` (upstream line 1056). The fork uses `strcasecmp` for `nul` (line 1417).

`noindex_filespec()` in `diff-no-index.c` also substitutes the string `/dev/null` for a missing name, with no Windows check.

### Real risk: the shell, not git

Your args go through `Command` directly, with no shell. So no MSYS path conversion happens. That is good. If you ever route this through `sh -c` or a Git Bash terminal, MSYS may rewrite `/dev/null`. It does not here.

Exit code: `--no-index` returns 1 when files differ, which is the normal "has a diff" case for an untracked file. The existing TS code reads stdout without checking the code, and the Rust side already returns `code` in `GitResult`. Make sure the Rust caller does not treat code 1 as failure for this command.

### Recommendation for git.rs

No change needed to git.rs for this. Keep `/dev/null`. Add one Windows CI test that runs `diff --no-index -- /dev/null file` and asserts the output starts with `diff --git` and the exit code is 1. If you want zero doubt, `nul` also works on Windows but is not portable, so do not switch.

## 4. CREATE_NO_WINDOW with tokio::process::Command

### Answer

Microsoft docs (`learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags`): "CREATE_NO_WINDOW 0x08000000: The process is a console application that is being run without a console window. Therefore, the console handle for the application is not set. This flag is ignored if the application is not a console application, or if it is used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS."

What that means for you:

- Piping: it does not touch stdin, stdout, stderr pipes. Handles come from `STARTUPINFO` and Rust's std sets them when you ask for `Stdio::piped()` or `Stdio::null()`. The Rust docs for `std::os::windows::process::CommandExt::creation_flags` say only "Sets the process creation flags to be passed to CreateProcess. These will always be ORed with CREATE_UNICODE_ENVIRONMENT." The Rust docs do not say CREATE_NO_WINDOW affects stdio. Tokio's `Command::creation_flags` has the same text. The Git for Windows wrapper itself uses this exact flag together with explicit std handles (`si.dwFlags = STARTF_USESTDHANDLES` then `creation_flags |= CREATE_NO_WINDOW`, `git-wrapper.c` lines 856 to 869), which shows the combination is the normal pattern.
- Speed: no source claims a speed effect. Without the flag, a GUI process (no console) spawning a console app makes Windows allocate a new console window for each child, which flashes on screen. Creating and tearing down a console host (`conhost.exe`) for every call is real work, so the flag should save time as well as stop the flash. This second part is inference. It is not measured and I have no citation.
- It is a no-op for GUI subsystem children and when combined with `DETACHED_PROCESS`. Do not combine the two.
- `git.exe` in `cmd\` and `mingw64\bin` is a console application, so the flag applies. The shim passes the same flag down to its child when it has no console of its own (`git-wrapper.c` line 869), so the double hop does not reopen a window.
- Tokio: on Windows `tokio::process::Command::creation_flags` is an inherent method, so the current `command()` in `git.rs` compiles without importing `CommandExt`. The code is correct as written. One issue: it is only on `Command`. If you build a `std::process::Command` and convert it, import `std::os::windows::process::CommandExt` first.
- `kill_on_drop`: tokio docs say it defaults to false, and that dropping a `Child` does not stop the process. If the UI cancels a long `git log`, the git process keeps running. Consider `kill_on_drop(true)` on read commands. This is outside the four questions, noted because it hits slow laptops hardest.

### Recommendation for git.rs

Keep `creation_flags(0x0800_0000)`. Replace the magic number with a named const (`const CREATE_NO_WINDOW: u32 = 0x0800_0000;`) for readability. Do not add `DETACHED_PROCESS`. Add `kill_on_drop(true)` for read commands. When you add the resolved git path from section 1, the same `command()` function is the one place to change.

## Summary of recommended changes to rust/app/src/git.rs

1. Resolve and cache `mingw64/bin/git.exe` via `git --exec-path` for read-only commands. Benchmark first.
2. Add `GIT_CONFIG_COUNT` env pairs (fscache, preloadindex) on Windows. Make fsmonitor opt-in.
3. Leave `/dev/null` diff alone and add a Windows test.
4. Keep `CREATE_NO_WINDOW`, name the constant, consider `kill_on_drop(true)`.
5. Tell the user to add Defender exclusions for the Git folder and repo folders, and measure with the PowerShell loop above.

## Gaps

- No primary source with timing numbers for Windows versus Unix process start, and none for Defender cost.
- I did not verify the core.fscache default in the current installer, nor read Microsoft's Defender exclusion page.
- Tauri docs were not consulted. They are not needed for these four questions, since the git spawn is plain tokio.
