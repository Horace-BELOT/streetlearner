import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./state/store";
import { useRoute, navigate } from "./lib/router";
import { loadCity, loadCityIndex } from "./lib/data";
import type { CityData, CityIndex } from "./lib/types";
import { decodeSet } from "./lib/share";
import { Spinner } from "./components/ui";
import Home from "./screens/Home";
import SetEditor from "./screens/SetEditor";
import Quiz from "./screens/Quiz";

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}

function useCity(id: string | null): CityData | null {
  const [city, setCity] = useState<CityData | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setCity(null);
    loadCity(id).then((c) => alive && setCity(c));
    return () => { alive = false; };
  }, [id]);
  return city;
}

function Router() {
  const route = useRoute();
  const store = useStore();
  const [cities, setCities] = useState<CityIndex[] | null>(null);
  useEffect(() => { loadCityIndex().then(setCities); }, []);

  const set = "setId" in route ? store.state.sets.find((s) => s.id === route.setId) : undefined;
  const cityId = set?.cityId ?? (route.name === "share" ? decodeSet(route.payload)?.cityId ?? null : null);
  const city = useCity(cityId);

  if (!store.ready || !cities) return <Spinner />;

  if (route.name === "share") {
    const payload = decodeSet(route.payload);
    if (!payload) return <ErrorBox msg="Lien de partage invalide." />;
    if (!city) return <Spinner label="Chargement de la ville…" />;
    const ids = payload.streetIds.filter((id) => city.byId.has(id));
    const created = store.createSet(payload.cityId, payload.name, ids);
    navigate(`/set/${created.id}`);
    return <Spinner />;
  }

  if (route.name === "home") return <Home cities={cities} />;

  if (!set) return <ErrorBox msg="Ce training set n'existe pas (ou plus)." />;
  if (!city) return <Spinner label={`Chargement des rues de ${cities.find((c) => c.id === set.cityId)?.name ?? set.cityId}…`} />;

  if (route.name === "edit") return <SetEditor key={set.id} set={set} city={city} />;
  return <Quiz key={`${set.id}-${route.mode}`} set={set} city={city} mode={route.mode} />;
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
      <p>{msg}</p>
      <a href="#/" className="text-indigo-600 underline">Retour à l'accueil</a>
    </div>
  );
}
