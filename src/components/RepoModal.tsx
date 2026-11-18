import { FormEvent, useEffect, useState } from "react";
import { gitneat, RepoTemplates, ShallowOptions } from "../api";
import {
  cloneName,
  DEFAULT_BRANCH,
  DEFAULT_DEPTH,
  isAbsolutePath,
  joinPath,
  pathSeparator,
  trimSeparators,
  validBranchName,
  validDepth,
  validFolderName,
  validSince,
} from "../repoSetup";
import { useStored, useUi } from "../ui";

export type RepoModalTab = "clone" | "init";

interface Props {
  start: RepoModalTab;
  defaultBranch: string;
  onClose(): void;
  onOpen(path: string): void;
}

const NO_SHALLOW: ShallowOptions = { branch: "", depth: "", since: "", flags: "" };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RepoModal({ start, defaultBranch, onClose, onOpen }: Props) {
  const ui = useUi();
  const [tab, setTab] = useState<RepoModalTab>(start);
  const [templates, setTemplates] = useState<RepoTemplates | null>(null);
  const [cloneDir, setCloneDir] = useStored<string>("clone.path", "");
  const [initDir, setInitDir] = useStored<string>("init.path", "");
  const [url, setUrl] = useState("");
  const [cloneAs, setCloneAs] = useState("");
  const [shallow, setShallow] = useState(false);
  const [options, setOptions] = useState<ShallowOptions>(NO_SHALLOW);
  const [initName, setInitName] = useState("");
  const [branch, setBranch] = useState("");
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [lfs, setLfs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let live = true;
    void gitneat()
      .repoTemplates()
      .then((found) => {
        if (live) {
          setTemplates(found);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!templates?.home) {
      return;
    }
    if (!cloneDir) {
      setCloneDir(templates.home, false);
    }
    if (!initDir) {
      setInitDir(templates.home, false);
    }
  }, [templates]);

  useEffect(() => gitneat().onCloneProgress((progress) => setPercent(progress.percent)), []);

  const placeholderName = cloneName(url);
  const name = cloneAs.trim() || placeholderName;
  const shallowOk = !shallow || (validSince(options.since) && validDepth(options.depth));
  const canClone = !busy && isAbsolutePath(cloneDir) && url.trim() !== "" && validFolderName(name) && shallowOk;
  const placeholderBranch = defaultBranch || DEFAULT_BRANCH;
  const branchOk = validBranchName(branch);
  const canInit = !busy && isAbsolutePath(initDir) && validFolderName(initName) && branchOk;

  const browse = async (set: (value: string) => void) => {
    const picked = await gitneat().pickDirectory();
    if (picked) {
      set(picked);
    }
  };

  const clone = async () => {
    const target = joinPath(cloneDir, name);
    setBusy(true);
    setPercent(0);
    try {
      await gitneat().cloneRepo(trimSeparators(cloneDir), url.trim(), target, shallow ? options : null);
      ui.toast(`Successfully cloned repo '${name}'`);
      onOpen(target);
      onClose();
    } catch (error) {
      ui.toast(errorText(error), "error", "Clone Failed");
      setBusy(false);
    }
  };

  const init = async () => {
    setBusy(true);
    try {
      const path = await gitneat().initRepo(trimSeparators(initDir), initName.trim(), branch.trim() || placeholderBranch, gitignore, license, lfs && !!templates?.lfs);
      onOpen(path);
      onClose();
    } catch (error) {
      ui.toast(errorText(error), "error", "Init Failed");
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tab === "clone" && canClone) {
      void clone();
    } else if (tab === "init" && canInit) {
      void init();
    }
  };

  const shallowField = (key: keyof ShallowOptions, label: string, help: string, placeholder = "") => (
    <label className="field">
      <span>{label}</span>
      <input
        value={options[key]}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setOptions({ ...options, [key]: e.target.value })}
      />
      <small className="field-help">{help}</small>
    </label>
  );

  const pathField = (id: string, label: string, value: string, set: (value: string) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="path-row">
        <input id={id} value={value} spellCheck={false} onChange={(e) => set(e.target.value)} />
        <button type="button" disabled={busy} onClick={() => void browse(set)}>
          Browse
        </button>
      </div>
    </div>
  );

  const close = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form
        className="modal repo-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            close();
          }
        }}
      >
        <div className="segmented">
          <button type="button" className={tab === "clone" ? "on" : ""} disabled={busy} onClick={() => setTab("clone")}>
            Clone
          </button>
          <button type="button" className={tab === "init" ? "on" : ""} disabled={busy} onClick={() => setTab("init")}>
            Init
          </button>
        </div>
        {tab === "clone" ? (
          <>
            <h3>Clone a Repository</h3>
            {pathField("clone-path", "Where to clone to", cloneDir, setCloneDir)}
            <label className="field">
              <span>URL</span>
              <input autoFocus value={url} placeholder="https://github.com/owner/repo.git" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
            </label>
            {url.trim() && (
              <div className="field">
                <label htmlFor="clone-name">Full path</label>
                <div className="full-path">
                  <span className="full-path-parent" title={trimSeparators(cloneDir)}>
                    {trimSeparators(cloneDir)}
                  </span>
                  <span>{pathSeparator(cloneDir)}</span>
                  <input id="clone-name" value={cloneAs} placeholder={placeholderName} spellCheck={false} onChange={(e) => setCloneAs(e.target.value)} />
                </div>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={shallow} onChange={(e) => setShallow(e.target.checked)} />
              Shallow Clone
            </label>
            {shallow && (
              <div className="shallow">
                {shallowField("branch", "Branch to clone", `The default branch is usually main or master, but you can specify a different one.`, "default branch")}
                {shallowField("depth", "Depth", "How many commits to clone from the target branch.", String(DEFAULT_DEPTH))}
                {shallowField("since", "Since date", "If set, commits within the depth setting will be filtered if they are too old.")}
                {!validSince(options.since) && <p className="modal-error">Enter a valid date (e.g. YYYY-MM-DD)</p>}
                {!validDepth(options.depth) && <p className="modal-error">Depth must be a positive number.</p>}
                {shallowField("flags", "Custom flags", "Here you can pass any additional flags you may need to git clone. Enter them exactly as you would on the command line.")}
              </div>
            )}
          </>
        ) : (
          <>
            <h3>Initialize a Repository</h3>
            {pathField("init-path", "Initialize in", initDir, setInitDir)}
            <label className="field">
              <span>Name</span>
              <input autoFocus value={initName} spellCheck={false} onChange={(e) => setInitName(e.target.value)} />
            </label>
            <label className="field">
              <span>Default branch name</span>
              <input value={branch} placeholder={placeholderBranch} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
            </label>
            {!branchOk && <p className="modal-error">Invalid branch name.</p>}
            <label className="field">
              <span>.gitignore Template (optional)</span>
              <select value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
                <option value="">None</option>
                {templates?.gitignore.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>License (optional)</span>
              <select value={license} onChange={(e) => setLicense(e.target.value)}>
                <option value="">None</option>
                {templates?.licenses.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {templates?.lfs && (
              <label className="check">
                <input type="checkbox" checked={lfs} onChange={(e) => setLfs(e.target.checked)} />
                Initialize with LFS
              </label>
            )}
          </>
        )}
        <div className="modal-buttons">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          {tab === "clone" ? (
            <button type="submit" className="primary" disabled={!canClone}>
              {busy ? `Cloning... ${percent}%` : "Clone the repo!"}
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!canInit}>
              {busy ? "Creating..." : "Create Repository"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
