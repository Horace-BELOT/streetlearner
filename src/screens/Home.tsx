import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { navigate } from "../lib/router";
import type { CityIndex, TrainingSet } from "../lib/types";
import { summarize } from "../lib/leitner";
import { shareUrl } from "../lib/share";
import { Button, TopBar } from "../components/ui";

export default function Home({ cities }: { cities: CityIndex[] }) {
  const store = useStore();
  const [cityId, setCityId] = useState(cities[0]?.id ?? "paris");
  const fileRef = useRef<HTMLInputElement>(null);
  const sets = store.state.sets.filter((s) => s.cityId === cityId);

  const create = () => {
    const s = store.createSet(cityId);
    navigate(`/set/${s.id}`);
  };

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Partial<TrainingSet> | Partial<TrainingSet>[];
      const list = Array.isArray(data) ? data : [data];
      for (const d of list) {
        if (!d.cityId || !Array.isArray(d.streetIds)) continue;
        store.createSet(d.cityId, d.name || f.name.replace(/\.json$/, ""), d.streetIds);
      }
    } catch {
      alert("Fichier invalide");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title={<span>🗺️ StreetLearner</span>}
        right={
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.count} voies</option>)}
          </select>
        }
      />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Mes training sets</h1>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            <Button onClick={() => fileRef.current?.click()}>Importer</Button>
            <Button variant="primary" onClick={create}>+ Nouveau set</Button>
          </div>
        </div>

        {sets.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Aucun set pour l'instant. Crée-en un et choisis les rues sur la carte.
          </div>
        )}

        <ul className="space-y-3">
          {sets.map((s) => <SetCard key={s.id} set={s} />)}
        </ul>

        <p className="mt-8 text-xs text-slate-400">
          Données © contributeurs OpenStreetMap (ODbL). Fond de carte OpenFreeMap. Tout est stocké localement dans ton navigateur.
        </p>
      </main>
    </div>
  );
}

function SetCard({ set }: { set: TrainingSet }) {
  const store = useStore();
  const stats = summarize(set.streetIds, (id) => store.getProgress(set.cityId, id));
  const [copied, setCopied] = useState(false);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ name: set.name, cityId: set.cityId, streetIds: set.streetIds }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${set.name.replace(/[^\w-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const share = async () => {
    await navigator.clipboard.writeText(shareUrl(set));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const del = () => { if (confirm(`Supprimer « ${set.name} » ?`)) store.deleteSet(set.id); };
  const dup = () => store.createSet(set.cityId, `${set.name} (copie)`, set.streetIds);

  const pct = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{set.name}</h2>
          <p className="text-xs text-slate-500">
            {stats.total} voies · {stats.due} à réviser · {stats.unseen} jamais vues · {stats.mastered} maîtrisées
          </p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Button variant="primary" size="sm" disabled={!stats.total} onClick={() => navigate(`/quiz/${set.id}?mode=place`)}>Nom → placer</Button>
          <Button variant="primary" size="sm" disabled={!stats.total} onClick={() => navigate(`/quiz/${set.id}?mode=name`)}>Lieu → nommer</Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/set/${set.id}`)}>Éditer</Button>
        <Button variant="ghost" size="sm" onClick={dup}>Dupliquer</Button>
        <Button variant="ghost" size="sm" onClick={exportJson}>Exporter</Button>
        <Button variant="ghost" size="sm" onClick={share}>{copied ? "Lien copié ✓" : "Partager"}</Button>
        <Button variant="ghost" size="sm" disabled={!stats.total || stats.unseen === stats.total} onClick={() => confirm("Réinitialiser la progression de ce set ?") && store.resetProgress(set.cityId, set.streetIds)}>Reset progression</Button>
        <Button variant="danger" size="sm" onClick={del}>Supprimer</Button>
      </div>
    </li>
  );
}
