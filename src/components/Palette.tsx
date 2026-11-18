import { useEffect, useMemo, useRef, useState } from "react";
import { available, Command, DOMAIN_LABELS, Domain, Frecency, Item, matchPositions, PLACEHOLDERS, rank, record } from "../palette";
import { AppApi, buildCommands, domainItems, getRepoApi, situation } from "../paletteCommands";

interface Props {
  start: Domain;
  app: AppApi;
  frecency: Frecency;
  setFrecency(next: Frecency): void;
  onClose(): void;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? matchPositions(text, query) : null;
  if (!at) {
    return <>{text}</>;
  }
  const set = new Set(at);
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch))}
    </>
  );
}

export function Palette({ start, app, frecency, setFrecency, onClose }: Props) {
  const [domain, setDomain] = useState<Domain>(start);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const repo = getRepoApi();

  useEffect(() => {
    if (domain === "top") {
      setLoaded([]);
      return;
    }
    let live = true;
    setLoading(true);
    domainItems(domain, app, repo).then(
      (items) => live && (setLoaded(items), setLoading(false)),
      () => live && (setLoaded([]), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [domain]);

  const top = useMemo<Command[]>(() => {
    const s = situation(repo);
    return buildCommands(app, repo).filter((c) => available(c, s));
  }, [app, repo]);

  const matches = useMemo(() => rank(domain === "top" ? top : loaded, domain, query, frecency, Date.now()), [domain, top, loaded, query, frecency]);

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index, matches]);

  const choose = (item: Item | undefined) => {
    if (!item) {
      return;
    }
    if (item.domain) {
      setDomain(item.domain);
      setQuery("");
      setIndex(0);
      return;
    }
    setFrecency(record(frecency, domain, item.id, query, Date.now()));
    onClose();
    void item.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(index + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(index - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      choose(matches[index]);
    } else if (e.key === "Backspace" && !query && domain !== "top") {
      e.preventDefault();
      setDomain("top");
      setIndex(0);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" data-testid="command-palette-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-control">
          {domain !== "top" && <span className="palette-chip">{DOMAIN_LABELS[domain]}</span>}
          <input
            autoFocus
            value={query}
            placeholder={query ? "" : PLACEHOLDERS[domain]}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          {loading && <span className="palette-loading">…</span>}
        </div>
        <div className="palette-list" ref={listRef}>
          {matches.map((item, i) => (
            <div key={item.id} className={`palette-item${i === index ? " selected" : ""}`} title={item.label} onMouseMove={() => setIndex(i)} onClick={() => choose(item)}>
              {item.prefix && <span className="palette-prefix">{item.prefix}</span>}
              <span className="palette-label">
                <Highlight text={item.label} query={query} />
              </span>
              {item.alias && item.alias !== item.label && (
                <span className="palette-alias">
                  <Highlight text={item.alias} query={query} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
