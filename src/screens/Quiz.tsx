import { useEffect, useMemo, useRef, useState } from "react";
import turfDistance from "@turf/distance";
import StreetMap, { type StreetState, type StreetMapProps } from "../map/StreetMap";
import { useStore } from "../state/store";
import type { CityData, QuizMode, StreetProps, TrainingSet } from "../lib/types";
import { pickSession, summarize } from "../lib/leitner";
import { answerMatches, fmtDistance, searchScore, shuffle } from "../lib/text";
import { Button, TopBar } from "../components/ui";

type Phase = "start" | "ask" | "answered" | "done";
type Answer = { id: string; ok: boolean; pickedId?: string; typed?: string; retry: boolean };

export default function Quiz({ set, city, mode }: { set: TrainingSet; city: CityData; mode: QuizMode }) {
  const store = useStore();
  const [phase, setPhase] = useState<Phase>("start");
  const [size, setSize] = useState(Math.min(15, set.streetIds.length));
  const [queue, setQueue] = useState<{ id: string; retry: boolean }[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [fit, setFit] = useState<StreetMapProps["fit"]>(null);
  const [typed, setTyped] = useState("");

  const stats = summarize(set.streetIds, (id) => store.getProgress(set.cityId, id));
  const current = queue[idx];
  const target = current ? city.byId.get(current.id) : undefined;
  const last = answers[answers.length - 1];

  const start = () => {
    const ids = pickSession(set.streetIds, (id) => store.getProgress(set.cityId, id), size);
    setQueue(shuffle(ids).map((id) => ({ id, retry: false })));
    setIdx(0);
    setAnswers([]);
    setPhase("ask");
  };

  // camera: frame the whole set once at session start (place mode), and only move
  // when the street to show is out of view (name mode) — no gratuitous pans between questions
  useEffect(() => {
    if (phase !== "ask" || !target) return;
    if (mode === "name") setFit({ ids: [target.id], nonce: Date.now(), padding: 140, ifNeeded: true, minZoom: 13 });
    else if (idx === 0) setFit({ ids: set.streetIds, nonce: Date.now(), padding: 40 });
    setTyped("");
  }, [phase, idx, mode, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // correct answer → move on by itself after a short confirmation
  useEffect(() => {
    if (phase !== "answered" || !last?.ok) return;
    const t = setTimeout(next, 700);
    return () => clearTimeout(t);
  }, [phase, last]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (ok: boolean, extra: Partial<Answer> = {}) => {
    if (!current || phase !== "ask") return;
    store.answer(set.cityId, current.id, ok);
    setAnswers((a) => [...a, { id: current.id, ok, retry: current.retry, ...extra }]);
    setPhase("answered");
    if (!ok && mode === "place" && extra.pickedId) setFit({ ids: [current.id, extra.pickedId], nonce: Date.now(), padding: 100, ifNeeded: true });
  };

  const next = () => {
    if (phase !== "answered") return;
    let q = queue;
    // at the end of the first pass, re-ask the failed ones once
    if (idx === queue.length - 1) {
      const failed = answers.filter((a) => !a.ok && !a.retry).map((a) => a.id);
      if (failed.length && !queue.some((x) => x.retry)) {
        q = [...queue, ...shuffle(failed).map((id) => ({ id, retry: true }))];
        setQueue(q);
      }
    }
    if (idx + 1 < q.length) { setIdx(idx + 1); setPhase("ask"); }
    else setPhase("done");
  };

  // keyboard: Enter / Space to go next
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (phase === "answered" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  });

  const states = useMemo<Record<string, StreetState>>(() => {
    if (!target) return {};
    if (phase === "ask") return mode === "name" ? { [target.id]: "target" } : {};
    if (phase === "answered" && last) {
      const s: Record<string, StreetState> = { [target.id]: "correct" };
      if (!last.ok && last.pickedId) s[last.pickedId] = "wrong";
      return s;
    }
    return {};
  }, [phase, target, mode, last]);

  const onMapClick = (id: string) => {
    if (mode !== "place" || phase !== "ask" || !target) return;
    answer(id === target.id, { pickedId: id });
  };

  const total = queue.length;
  const score = answers.filter((a) => a.ok && !a.retry).length;
  const firstPass = answers.filter((a) => !a.retry).length;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={<a href="#/" className="text-sm text-slate-500 hover:text-slate-800">← Sets</a>}
        title={<span>{set.name} <span className="font-normal text-slate-400">· {mode === "place" ? "Nom → placer" : "Lieu → nommer"}</span></span>}
        right={phase !== "start" && phase !== "done" ? <span className="text-sm text-slate-500">{idx + 1} / {total} · {score} ✓</span> : null}
      />
      <div className="relative min-h-0 flex-1">
        <StreetMap
          city={city}
          states={states}
          showAll={mode === "place"}
          interactive={mode === "place" && phase === "ask"}
          hideLabels
          onClick={onMapClick}
          fit={fit}
        />

        {phase === "start" && (
          <Overlay>
            <h2 className="text-lg font-semibold">{mode === "place" ? "Nom → placer" : "Lieu → nommer"}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {mode === "place" ? "On te donne un nom, tu cliques la voie sur la carte." : "On te montre une voie, tu tapes son nom."}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              {stats.total} voies · {stats.due} à réviser · {stats.unseen} jamais vues · {stats.mastered} maîtrisées
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              Questions :
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1">
                {[5, 10, 15, 25, 50].filter((n) => n < set.streetIds.length).map((n) => <option key={n} value={n}>{n}</option>)}
                <option value={set.streetIds.length}>Toutes ({set.streetIds.length})</option>
              </select>
            </label>
            <Button variant="primary" className="mt-4 w-full" onClick={start}>Commencer</Button>
          </Overlay>
        )}

        {(phase === "ask" || phase === "answered") && target && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <div className="pointer-events-auto w-full max-w-xl rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              {mode === "place" ? (
                <PlacePrompt target={target} phase={phase} last={last} city={city} onNext={next} />
              ) : (
                <NamePrompt target={target} phase={phase} last={last} city={city} typed={typed} setTyped={setTyped} onSubmit={(t) => answer(answerMatches(t, target.name), { typed: t })} onSkip={() => answer(false, { typed: "" })} onNext={next} />
              )}
            </div>
          </div>
        )}

        {phase === "done" && (
          <Overlay>
            <h2 className="text-lg font-semibold">Session terminée</h2>
            <p className="mt-1 text-3xl font-bold text-indigo-600">{score} / {firstPass}</p>
            {answers.some((a) => !a.ok && !a.retry) && (
              <div className="mt-3 text-sm">
                <div className="mb-1 font-medium text-slate-600">À revoir :</div>
                <ul className="max-h-48 overflow-auto text-slate-700">
                  {answers.filter((a) => !a.ok && !a.retry).map((a) => (
                    <li key={a.id} className="flex justify-between gap-2 border-b border-slate-100 py-0.5">
                      <span>{city.byId.get(a.id)?.name}</span>
                      <span className="text-xs text-slate-400">{answers.find((r) => r.retry && r.id === a.id)?.ok ? "✓ au 2e essai" : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="primary" className="flex-1" onClick={start}>Nouvelle session</Button>
              <Button className="flex-1" onClick={() => (location.hash = "/")}>Retour</Button>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">{children}</div>
    </div>
  );
}

function PlacePrompt({ target, phase, last, city, onNext }: { target: StreetProps; phase: Phase; last?: Answer; city: CityData; onNext: () => void }) {
  const picked = last?.pickedId ? city.byId.get(last.pickedId) : undefined;
  const dist = picked && !last?.ok ? turfDistance(target.c, picked.c, { units: "meters" }) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-slate-400">Où se trouve</div>
        <div className="truncate text-lg font-semibold">{target.name}</div>
        {phase === "answered" && last && (
          <div className={`mt-1 text-sm ${last.ok ? "text-green-600" : "text-red-600"}`}>
            {last.ok ? "Exact !" : <>Raté : c'était <b>{picked?.name}</b> ({fmtDistance(dist)} à côté)</>}
          </div>
        )}
      </div>
      {phase === "answered" && !last?.ok && <Button variant="primary" onClick={onNext}>Suivant ↵</Button>}
    </div>
  );
}

function NamePrompt(p: { target: StreetProps; phase: Phase; last?: Answer; city: CityData; typed: string; setTyped: (s: string) => void; onSubmit: (t: string) => void; onSkip: () => void; onNext: () => void }) {
  const { target, phase, last, city, typed, setTyped } = p;
  const input = useRef<HTMLInputElement>(null);
  const [hl, setHl] = useState(0);
  useEffect(() => { if (phase === "ask") input.current?.focus(); }, [phase, target.id]);

  const suggestions = useMemo(() => {
    if (typed.trim().length < 2) return [];
    return city.streets
      .map((s) => ({ s, sc: searchScore(typed, s.name) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || a.s.len - b.s.len)
      .slice(0, 7)
      .map((x) => x.s.name);
  }, [typed, city.streets]);
  const uniq = [...new Set(suggestions)];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(uniq.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // keep the global "next" shortcut from firing on the same keystroke
      const pick = uniq[hl];
      if (pick && pick !== typed && uniq.length > 1 && !answerMatches(typed, target.name)) { setTyped(pick); setHl(0); }
      else p.onSubmit(pick && uniq.length === 1 ? pick : typed);
    } else if (e.key === "Escape") setTyped("");
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">Comment s'appelle la voie en bleu ?</div>
      {phase === "ask" ? (
        <div className="relative mt-1">
          <div className="flex gap-2">
            <input
              ref={input}
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setHl(0); }}
              onKeyDown={onKey}
              placeholder="Rue de…"
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            />
            <Button variant="ghost" onClick={p.onSkip}>Je sais pas</Button>
          </div>
          {uniq.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {uniq.map((n, i) => (
                <li key={n} onMouseDown={() => p.onSubmit(n)} onMouseEnter={() => setHl(i)} className={`cursor-pointer px-3 py-1.5 text-sm ${i === hl ? "bg-indigo-50 text-indigo-700" : ""}`}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{target.name}</div>
            <div className={`text-sm ${last?.ok ? "text-green-600" : "text-red-600"}`}>
              {last?.ok ? "Exact !" : last?.typed ? <>Raté, tu as répondu « {last.typed} »</> : "Passée"}
            </div>
          </div>
          {!last?.ok && <Button variant="primary" onClick={p.onNext}>Suivant ↵</Button>}
        </div>
      )}
    </div>
  );
}
