import { useMemo, useState } from "react";
import StreetMap, { type StreetState } from "../map/StreetMap";
import { useStore } from "../state/store";
import type { CityData, StreetProps, TrainingSet } from "../lib/types";
import { searchScore } from "../lib/text";
import { Button, Chip, TopBar } from "../components/ui";

const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

export default function SetEditor({ set, city }: { set: TrainingSet; city: CityData }) {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [districts, setDistricts] = useState<Set<string>>(new Set());
  const [majorOnly, setMajorOnly] = useState(false);
  const [minLen, setMinLen] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [fit, setFit] = useState<{ ids: string[]; nonce: number } | null>(null);
  const [tab, setTab] = useState<"search" | "list">("search");

  const selected = useMemo(() => new Set(set.streetIds), [set.streetIds]);
  const filterActive = types.size > 0 || districts.size > 0 || majorOnly || minLen > 0;

  const filtered = useMemo(() => {
    let list = city.streets;
    if (types.size) list = list.filter((s) => types.has(s.type));
    if (districts.size) list = list.filter((s) => s.arr.some((a) => districts.has(a)));
    if (majorOnly) list = list.filter((s) => MAJOR.has(s.hw));
    if (minLen) list = list.filter((s) => s.len >= minLen);
    if (query.trim()) {
      list = list
        .map((s) => ({ s, sc: searchScore(query, s.name) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc || a.s.name.localeCompare(b.s.name, "fr"))
        .map((x) => x.s);
    }
    return list;
  }, [city.streets, types, districts, majorOnly, minLen, query]);

  const shown = query.trim() ? filtered.slice(0, 60) : filterActive ? filtered.slice(0, 200) : [];

  const states = useMemo(() => {
    const st: Record<string, StreetState> = {};
    if (filterActive || query.trim()) for (const s of filtered) st[s.id] = "candidate";
    for (const id of set.streetIds) st[id] = "selected";
    return st;
  }, [filtered, filterActive, query, set.streetIds]);

  const toggle = (id: string) => {
    const ids = selected.has(id) ? set.streetIds.filter((x) => x !== id) : [...set.streetIds, id];
    store.updateSet(set.id, { streetIds: ids });
  };
  const addAll = () => {
    const ids = new Set(set.streetIds);
    for (const s of filtered) ids.add(s.id);
    store.updateSet(set.id, { streetIds: [...ids] });
  };
  const removeAll = () => {
    const rm = new Set(filtered.map((s) => s.id));
    store.updateSet(set.id, { streetIds: set.streetIds.filter((id) => !rm.has(id)) });
  };
  const flyTo = (id: string) => setFit({ ids: [id], nonce: Date.now() });

  const selectedList = useMemo(
    () => set.streetIds.map((id) => city.byId.get(id)).filter((s): s is StreetProps => !!s).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [set.streetIds, city.byId],
  );
  const toggleIn = (setter: (f: (s: Set<string>) => Set<string>) => void, v: string) =>
    setter((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={<a href="#/" className="text-sm text-slate-500 hover:text-slate-800">← Sets</a>}
        title={
          <input
            value={set.name}
            onChange={(e) => store.updateSet(set.id, { name: e.target.value })}
            className="w-full max-w-md rounded border border-transparent px-1 font-semibold hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
          />
        }
        right={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">{set.streetIds.length} voies</span>
            <Button variant="primary" size="sm" disabled={!set.streetIds.length} onClick={() => (location.hash = `/quiz/${set.id}?mode=place`)}>Nom → placer</Button>
            <Button variant="primary" size="sm" disabled={!set.streetIds.length} onClick={() => (location.hash = `/quiz/${set.id}?mode=name`)}>Lieu → nommer</Button>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-96 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex border-b border-slate-200 text-sm">
            <button className={`flex-1 px-3 py-2 ${tab === "search" ? "border-b-2 border-indigo-600 font-medium" : "text-slate-500"}`} onClick={() => setTab("search")}>Ajouter</button>
            <button className={`flex-1 px-3 py-2 ${tab === "list" ? "border-b-2 border-indigo-600 font-medium" : "text-slate-500"}`} onClick={() => setTab("list")}>Sélection ({set.streetIds.length})</button>
          </div>

          {tab === "search" && (
            <>
              <div className="space-y-2 border-b border-slate-200 p-3">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher une voie…"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <details open className="text-xs">
                  <summary className="cursor-pointer text-slate-500">Filtres {filterActive && <span className="text-indigo-600">(actifs)</span>}</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <div className="mb-1 text-slate-400">Arrondissement</div>
                      <div className="flex flex-wrap gap-1">
                        {city.index.districts.map((d) => <Chip key={d} active={districts.has(d)} onClick={() => toggleIn(setDistricts, d)}>{d}</Chip>)}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-slate-400">Type</div>
                      <div className="flex flex-wrap gap-1">
                        {city.index.types.map((t) => <Chip key={t} active={types.has(t)} onClick={() => toggleIn(setTypes, t)}>{t}</Chip>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={majorOnly} onChange={(e) => setMajorOnly(e.target.checked)} /> Axes majeurs</label>
                      <label className="flex items-center gap-1">
                        Longueur ≥
                        <select value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} className="rounded border border-slate-300 px-1">
                          <option value={0}>—</option><option value={200}>200 m</option><option value={500}>500 m</option><option value={1000}>1 km</option><option value={2000}>2 km</option>
                        </select>
                      </label>
                      {filterActive && <button className="text-indigo-600 underline" onClick={() => { setTypes(new Set()); setDistricts(new Set()); setMajorOnly(false); setMinLen(0); }}>Effacer</button>}
                    </div>
                  </div>
                </details>
                {(filterActive || query.trim()) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">{filtered.length} résultat{filtered.length > 1 ? "s" : ""}</span>
                    <Button size="sm" onClick={addAll} disabled={!filtered.length}>Tout ajouter</Button>
                    <Button size="sm" onClick={removeAll} disabled={!filtered.some((s) => selected.has(s.id))}>Tout retirer</Button>
                  </div>
                )}
              </div>
              <ul className="min-h-0 flex-1 overflow-auto text-sm">
                {!shown.length && (
                  <li className="p-4 text-center text-xs text-slate-400">
                    Tape un nom, active un filtre, ou clique directement sur les rues de la carte.
                  </li>
                )}
                {shown.map((s) => (
                  <StreetRow key={s.id} s={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} onHover={setHoverId} onFly={() => flyTo(s.id)} />
                ))}
                {(filterActive || query.trim()) && filtered.length > shown.length && <li className="p-2 text-center text-xs text-slate-400">… et {filtered.length - shown.length} autres</li>}
              </ul>
            </>
          )}

          {tab === "list" && (
            <ul className="min-h-0 flex-1 overflow-auto text-sm">
              {!selectedList.length && <li className="p-4 text-center text-xs text-slate-400">Aucune voie sélectionnée.</li>}
              {selectedList.map((s) => (
                <StreetRow key={s.id} s={s} selected onToggle={() => toggle(s.id)} onHover={setHoverId} onFly={() => flyTo(s.id)} />
              ))}
            </ul>
          )}
        </aside>
        <div className="relative min-w-0 flex-1">
          <StreetMap city={city} states={states} showAll interactive hoverId={hoverId} onClick={toggle} fit={fit} />
          <div className="pointer-events-none absolute bottom-6 left-2 rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow">
            Clic sur une voie pour l'ajouter / la retirer · <span className="text-violet-600">■</span> sélection · <span className="text-sky-500">■</span> résultats du filtre
          </div>
        </div>
      </div>
    </div>
  );
}

function StreetRow({ s, selected, onToggle, onHover, onFly }: { s: StreetProps; selected: boolean; onToggle: () => void; onHover: (id: string | null) => void; onFly: () => void }) {
  return (
    <li
      className={`flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 hover:bg-slate-50 ${selected ? "bg-violet-50" : ""}`}
      onMouseEnter={() => onHover(s.id)}
      onMouseLeave={() => onHover(null)}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} className="accent-violet-600" />
      <button className="min-w-0 flex-1 truncate text-left" onClick={onFly} title="Centrer la carte">
        {s.name}
      </button>
      <span className="shrink-0 text-xs text-slate-400">{s.arr.join(",")}{s.arr.length ? "e" : ""} · {s.len >= 1000 ? `${(s.len / 1000).toFixed(1)} km` : `${s.len} m`}</span>
    </li>
  );
}
