import { useState } from "react";

interface Props {
  recent: string[];
  onOpen(path: string): void;
  onOpenDialog(): void;
  onClone(): void;
  onInit(): void;
}

const repoName = (path: string) => path.split(/[\\/]/).pop() || path;

export function NewTab({ recent, onOpen, onOpenDialog, onClone, onInit }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? recent.filter((p) => repoName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q)) : recent;
  return (
    <div className="new-tab">
      <h2>Repositories</h2>
      <div className="new-tab-actions">
        <button className="primary" onClick={onOpenDialog}>
          Open a repository
        </button>
        <button onClick={onClone}>Clone a repository</button>
        <button onClick={onInit}>Start a local repository</button>
      </div>
      {recent.length > 10 && (
        <input
          className="new-tab-search"
          autoFocus
          placeholder="Search repositories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
            }
          }}
        />
      )}
      {recent.length > 0 && (
        <div className="recent">
          <h4>Recent</h4>
          {shown.map((p) => (
            <a key={p} title={p} onClick={() => onOpen(p)}>
              <b>{repoName(p)}</b> <span>{p}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
