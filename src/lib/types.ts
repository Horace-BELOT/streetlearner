import type { Feature, FeatureCollection, Geometry } from "geojson";

export type StreetProps = {
  id: string;
  name: string;
  type: string;
  /** district labels (arrondissement numbers for Paris) */
  arr: string[];
  /** length in meters */
  len: number;
  /** most important OSM highway class */
  hw: string;
  /** centroid [lon, lat] */
  c: [number, number];
};

export type StreetFeature = Feature<Geometry, StreetProps>;

export type CityIndex = {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  count: number;
  districts: string[];
  types: string[];
  builtAt: string;
};

export type CityData = {
  index: CityIndex;
  fc: FeatureCollection<Geometry, StreetProps>;
  districts: FeatureCollection | null;
  streets: StreetProps[];
  byId: Map<string, StreetProps>;
};

export type TrainingSet = {
  id: string;
  name: string;
  cityId: string;
  streetIds: string[];
  createdAt: number;
  updatedAt: number;
};

/** Leitner progress for one street (keyed by `${cityId}:${streetId}`) */
export type Progress = {
  box: number;
  /** timestamp when the item becomes due again */
  due: number;
  seen: number;
  correct: number;
  lastAt: number;
};

export type QuizMode = "place" | "name";

export type AppState = {
  sets: TrainingSet[];
  progress: Record<string, Progress>;
};
