import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { get, set as idbSet } from "idb-keyval";
import type { AppState, Progress, TrainingSet } from "../lib/types";
import { applyAnswer, progressKey } from "../lib/leitner";
import { uid } from "../lib/text";

const KEY = "streetlearner:v1";

type Action =
  | { type: "load"; state: AppState }
  | { type: "createSet"; set: TrainingSet }
  | { type: "updateSet"; id: string; patch: Partial<Pick<TrainingSet, "name" | "streetIds">> }
  | { type: "deleteSet"; id: string }
  | { type: "answer"; cityId: string; streetId: string; ok: boolean }
  | { type: "resetProgress"; cityId: string; streetIds: string[] };

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case "load":
      return a.state;
    case "createSet":
      return { ...state, sets: [a.set, ...state.sets] };
    case "updateSet":
      return {
        ...state,
        sets: state.sets.map((s) => (s.id === a.id ? { ...s, ...a.patch, updatedAt: Date.now() } : s)),
      };
    case "deleteSet":
      return { ...state, sets: state.sets.filter((s) => s.id !== a.id) };
    case "answer": {
      const k = progressKey(a.cityId, a.streetId);
      return { ...state, progress: { ...state.progress, [k]: applyAnswer(state.progress[k], a.ok) } };
    }
    case "resetProgress": {
      const progress = { ...state.progress };
      for (const id of a.streetIds) delete progress[progressKey(a.cityId, id)];
      return { ...state, progress };
    }
  }
}

const EMPTY: AppState = { sets: [], progress: {} };

type Store = {
  state: AppState;
  ready: boolean;
  createSet: (cityId: string, name?: string, streetIds?: string[]) => TrainingSet;
  updateSet: (id: string, patch: Partial<Pick<TrainingSet, "name" | "streetIds">>) => void;
  deleteSet: (id: string) => void;
  answer: (cityId: string, streetId: string, ok: boolean) => void;
  resetProgress: (cityId: string, streetIds: string[]) => void;
  getProgress: (cityId: string, streetId: string) => Progress | undefined;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const [ready, setReady] = useReducer(() => true, false);
  const loaded = useRef(false);

  useEffect(() => {
    get<AppState>(KEY).then((s) => {
      if (s) dispatch({ type: "load", state: { ...EMPTY, ...s } });
      loaded.current = true;
      setReady();
    });
  }, []);

  // persist (debounced)
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => idbSet(KEY, state), 150);
    return () => clearTimeout(t);
  }, [state]);

  const store = useMemo<Store>(
    () => ({
      state,
      ready,
      createSet: (cityId, name = "Nouveau set", streetIds = []) => {
        const set: TrainingSet = { id: uid(), name, cityId, streetIds, createdAt: Date.now(), updatedAt: Date.now() };
        dispatch({ type: "createSet", set });
        return set;
      },
      updateSet: (id, patch) => dispatch({ type: "updateSet", id, patch }),
      deleteSet: (id) => dispatch({ type: "deleteSet", id }),
      answer: (cityId, streetId, ok) => dispatch({ type: "answer", cityId, streetId, ok }),
      resetProgress: (cityId, streetIds) => dispatch({ type: "resetProgress", cityId, streetIds }),
      getProgress: (cityId, streetId) => state.progress[progressKey(cityId, streetId)],
    }),
    [state, ready],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
