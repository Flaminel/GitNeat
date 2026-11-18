import { useEffect, useState } from "react";
import { gitneat } from "../api";
import { showMenu } from "../ui";
import { repoLabel } from "./Tabs";

interface Props {
  recent: string[];
  favorites: string[];
  aliases: Record<string, string>;
  onOpen(path: string): void;
  onOpenDialog(): void;
  onClone(): void;
  onInit(): void;
  onFavorite(path: string): void;
  onAlias(path: string): void;
  onRemoveRecent(path: string): void;
  onRemoveAllRecent(): void;
}

const FAVORITE_LIMIT = 8;

export function NewTab(props: Props) {
  const { recent, favorites, aliases, onOpen } = props;
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const all = [...favorites, ...recent.filter((p) => !favorites.includes(p))];
  const key = all.join("\n");
  useEffect(() => {
    let live = true;
    void gitneat()
      .missingPaths(key ? key.split("\n") : [])
      .then((m) => live && setMissing(m));
    return () => {
      live = false;
    };
  }, [key]);
  const q = query.trim().toLowerCase();
  const match = (p: string) => !q || repoLabel(p, aliases).toLowerCase().includes(q) || p.toLowerCase().includes(q);
  const row = (p: string, removable: boolean) => (
    <a
      key={p}
      title={p}
      className={missing.includes(p) ? "missing" : undefined}
      onClick={() => onOpen(p)}
      onContextMenu={() =>
        showMenu([
          { label: favorites.includes(p) ? "Remove from favorites" : "Add to favorites", run: () => props.onFavorite(p) },
          { label: "Rename", run: () => props.onAlias(p) },
          removable && { label: "Remove from recent", run: () => props.onRemoveRecent(p) },
        ])
      }
    >
      <b>{repoLabel(p, aliases)}</b> <span>{p}</span>
      {missing.includes(p) && <em>Repo is unreachable and may have been deleted</em>}
      {removable && (
        <button
          className="recent-remove"
          title="Remove from recent"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemoveRecent(p);
          }}
        >
          ×
        </button>
      )}
    </a>
  );
  const shownFavorites = favorites.slice(0, FAVORITE_LIMIT).filter(match);
  const shownRecent = recent.filter(match);
  return (
    <div className="new-tab">
      <h2>Repositories</h2>
      <div className="new-tab-actions">
        <button className="primary" onClick={props.onOpenDialog}>
          Open a repository
        </button>
        <button onClick={props.onClone}>Clone a repository</button>
        <button onClick={props.onInit}>Start a local repository</button>
      </div>
      {favorites.length + recent.length > 10 && (
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
      {shownFavorites.length > 0 && (
        <div className="recent">
          <h4>Favorite</h4>
          {shownFavorites.map((p) => row(p, false))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="recent">
          <h4>
            Recent
            <button className="recent-clear" onClick={props.onRemoveAllRecent}>
              Remove all
            </button>
          </h4>
          {shownRecent.map((p) => row(p, true))}
        </div>
      )}
    </div>
  );
}
