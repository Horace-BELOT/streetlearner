import type { FeatureCollection } from "geojson";
import type { CityData, CityIndex, StreetProps } from "./types";

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<CityData>>();
let indexPromise: Promise<CityIndex[]> | null = null;

export function loadCityIndex(): Promise<CityIndex[]> {
  indexPromise ??= fetch(`${base}data/cities.json`).then((r) => r.json());
  return indexPromise;
}

export function loadCity(id: string): Promise<CityData> {
  if (!cache.has(id)) {
    cache.set(
      id,
      (async () => {
        const [index, fc, districts] = await Promise.all([
          loadCityIndex().then((all) => all.find((c) => c.id === id)!),
          fetch(`${base}data/${id}.json`).then((r) => r.json()) as Promise<CityData["fc"]>,
          fetch(`${base}data/${id}-districts.json`).then((r) => (r.ok ? (r.json() as Promise<FeatureCollection>) : null)).catch(() => null),
        ]);
        const streets = fc.features.map((f) => f.properties);
        const byId = new Map<string, StreetProps>(streets.map((s) => [s.id, s]));
        return { index, fc, districts, streets, byId };
      })(),
    );
  }
  return cache.get(id)!;
}
