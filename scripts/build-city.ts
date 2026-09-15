/**
 * Build the street dataset for a city from OpenStreetMap (Overpass API).
 *
 *   pnpm build:city paris
 *
 * Output: public/data/<city>.json         (FeatureCollection of merged streets)
 *         public/data/<city>-districts.json (district boundaries, optional)
 *         public/data/cities.json          (index)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import * as turf from "@turf/turf";
import osmtogeojson from "osmtogeojson";
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";

type CityConfig = {
  id: string;
  name: string;
  relationId: number;
  /** admin_level of sub-districts (arrondissements) — optional */
  districtLevel?: number;
  /** turn "Paris 11e Arrondissement" into "11" */
  districtLabel?: (name: string) => string;
};

const CITIES: Record<string, CityConfig> = {
  paris: {
    id: "paris",
    name: "Paris",
    relationId: 7444,
    districtLevel: 9,
    districtLabel: (n) => n.replace(/^Paris\s+(\d+)(?:er|e)\s+Arrondissement$/i, "$1"),
  },
};

const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "streetlearner-build/0.1 (github.com/streetlearner)";

const EXCLUDED_HIGHWAY = new Set([
  "proposed", "construction", "platform", "bus_stop", "elevator", "corridor",
  "raceway", "services", "rest_area", "abandoned", "razed", "disused", "motorway_junction",
]);

/** Cluster threshold: ways with the same name whose bboxes (expanded by this) touch are one street */
const CLUSTER_METERS = 80;
/** Names that are not real streets (parking ramps, building entrances…) */
const EXCLUDED_NAME = /^(accès|acces|entrée|entree|sortie|parking|rampe|dépose|depose)\b/i;
/** highway classes ordered by importance (index 0 = most important) */
const HW_RANK = ["motorway","trunk","primary","secondary","tertiary","unclassified","residential","living_street","pedestrian","service","cycleway","footway","path","steps","track","busway"];
const SIMPLIFY_TOLERANCE = 0.00002; // ~2 m

type OsmWay = {
  type: "way";
  id: number;
  tags: Record<string, string>;
  geometry: { lat: number; lon: number }[];
};

async function overpass(query: string, cachePath: string): Promise<any> {
  if (existsSync(cachePath)) {
    console.log(`  (cache) ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  mkdirSync(".cache", { recursive: true });
  writeFileSync(cachePath, JSON.stringify(json));
  return json;
}

// ---------- type classification ----------

const TYPE_PREFIXES: [RegExp, string][] = [
  [/^(grande |petite )?rue\b/i, "Rue"],
  [/^avenue\b/i, "Avenue"],
  [/^boulevard\b/i, "Boulevard"],
  [/^(rond-point|rondpoint)\b/i, "Place"],
  [/^place\b/i, "Place"],
  [/^quai\b/i, "Quai"],
  [/^pont\b/i, "Pont"],
  [/^passage\b/i, "Passage"],
  [/^villa\b/i, "Villa"],
  [/^impasse\b/i, "Impasse"],
  [/^allée\b/i, "Allée"],
  [/^cité\b/i, "Cité"],
  [/^square\b/i, "Square"],
  [/^cours\b/i, "Cours"],
  [/^chemin\b/i, "Chemin"],
  [/^route\b/i, "Route"],
  [/^sentier\b/i, "Sentier"],
  [/^voie\b/i, "Voie"],
  [/^promenade\b/i, "Promenade"],
  [/^esplanade\b/i, "Esplanade"],
  [/^carrefour\b/i, "Place"],
  [/^parvis\b/i, "Place"],
  [/^port\b/i, "Port"],
  [/^galerie\b/i, "Galerie"],
  [/^hameau\b/i, "Hameau"],
  [/^ruelle\b/i, "Ruelle"],
  [/^jardin\b/i, "Jardin"],
  [/^cour\b/i, "Cour"],
  [/^terrasse\b/i, "Terrasse"],
  [/^mail\b/i, "Mail"],
  [/^sente\b/i, "Sentier"],
  [/^escalier\b/i, "Escalier"],
  [/^porte\b/i, "Porte"],
  [/^tunnel\b/i, "Tunnel"],
  [/^(boulevard )?périphérique\b/i, "Périphérique"],
  [/^autoroute\b/i, "Autoroute"],
  [/^bretelle\b/i, "Bretelle"],
];

function classify(name: string): string {
  for (const [re, t] of TYPE_PREFIXES) if (re.test(name)) return t;
  return "Autre";
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------- geometry helpers ----------

const round = (p: Position): Position => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

function wayCoords(w: OsmWay): Position[] {
  return w.geometry.map((g) => [g.lon, g.lat]);
}

function isAreaWay(w: OsmWay): boolean {
  const t = w.tags;
  const closed = w.geometry.length > 3 &&
    w.geometry[0].lat === w.geometry.at(-1)!.lat && w.geometry[0].lon === w.geometry.at(-1)!.lon;
  if (t.area === "yes" && closed) return true;
  if (t.place === "square" && closed) return true;
  return false;
}

function expandedBbox(coords: Position[], meters: number): [number, number, number, number] {
  const b = turf.bbox(turf.lineString(coords.length > 1 ? coords : [coords[0], coords[0]]));
  const lat = (b[1] + b[3]) / 2;
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

function bboxIntersect(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function clusterWays(ways: OsmWay[]): OsmWay[][] {
  const boxes = ways.map((w) => expandedBbox(wayCoords(w), CLUSTER_METERS));
  const parent = ways.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ways.length; i++)
    for (let j = i + 1; j < ways.length; j++)
      if (bboxIntersect(boxes[i], boxes[j])) parent[find(i)] = find(j);
  const groups = new Map<number, OsmWay[]>();
  ways.forEach((w, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(w);
  });
  return [...groups.values()];
}

// ---------- main ----------

async function build(cfg: CityConfig) {
  const areaId = 3_600_000_000 + cfg.relationId;
  console.log(`Building ${cfg.name} (relation ${cfg.relationId})`);

  console.log("Fetching streets…");
  const streetsRaw = await overpass(
    `[out:json][timeout:300];area(${areaId})->.a;
     (
       way["highway"]["name"](area.a);
       way["place"="square"]["name"](area.a);
     );
     out geom;`,
    `.cache/${cfg.id}-ways.json`,
  );

  let districts: Feature<Polygon | MultiPolygon, { name: string; label: string }>[] = [];
  if (cfg.districtLevel) {
    console.log("Fetching districts…");
    const raw = await overpass(
      `[out:json][timeout:120];area(${areaId})->.a;
       relation["boundary"="administrative"]["admin_level"="${cfg.districtLevel}"](area.a);
       out geom;`,
      `.cache/${cfg.id}-districts.json`,
    );
    const fc = osmtogeojson(raw) as FeatureCollection;
    districts = fc.features
      .filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      .map((f) => {
        const name = (f.properties as any)?.name ?? "";
        return {
          type: "Feature",
          geometry: f.geometry as Polygon | MultiPolygon,
          properties: { name, label: cfg.districtLabel ? cfg.districtLabel(name) : name },
        };
      });
    console.log(`  ${districts.length} districts`);
  }

  const ways: OsmWay[] = (streetsRaw.elements as OsmWay[]).filter(
    (e) =>
      e.type === "way" &&
      e.geometry?.length >= 2 &&
      e.tags?.name &&
      !EXCLUDED_HIGHWAY.has(e.tags.highway ?? "") &&
      !e.tags.name.match(/^\s*$/) &&
      !EXCLUDED_NAME.test(e.tags.name),
  );
  console.log(`  ${ways.length} named ways`);

  // group by exact name
  const byName = new Map<string, OsmWay[]>();
  for (const w of ways) {
    const n = w.tags.name.trim();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n)!.push(w);
  }
  console.log(`  ${byName.size} distinct names`);

  const features: Feature[] = [];
  const idCounts = new Map<string, number>();

  for (const [name, group] of byName) {
    const clusters = clusterWays(group);
    for (const cluster of clusters) {
      const areaWays = cluster.filter(isAreaWay);
      const lineWays = cluster.filter((w) => !isAreaWay(w));

      let geometry: LineString | MultiLineString | Polygon | MultiPolygon;
      if (areaWays.length && !lineWays.length) {
        const polys = areaWays.map((w) => turf.polygon([wayCoords(w)]));
        geometry = polys.length === 1
          ? polys[0].geometry
          : turf.multiPolygon(polys.map((p) => p.geometry.coordinates)).geometry;
      } else {
        // area ways mixed with lines → treat area rings as lines
        const lines = cluster.map(wayCoords);
        geometry = lines.length === 1 ? turf.lineString(lines[0]).geometry : turf.multiLineString(lines).geometry;
      }

      let feat: Feature = turf.feature(geometry);
      try {
        feat = turf.simplify(feat, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });
      } catch {
        /* keep unsimplified */
      }
      feat.geometry = turf.truncate(feat, { precision: 5, mutate: true }).geometry;

      const lengthM = Math.round(turf.length(feat, { units: "kilometers" }) * 1000);

      // districts: sample vertices
      const arr = new Set<string>();
      if (districts.length) {
        const pts = turf.coordAll(feat);
        const step = Math.max(1, Math.floor(pts.length / 12));
        for (let i = 0; i < pts.length; i += step) {
          const pt = turf.point(pts[i]);
          for (const d of districts) if (turf.booleanPointInPolygon(pt, d)) { arr.add(d.properties.label); break; }
        }
      }

      const base = slug(name);
      const n = (idCounts.get(base) ?? 0) + 1;
      idCounts.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;

      const hw = cluster.map((w) => w.tags.highway ?? "").filter(Boolean)
        .sort((a, b) => (HW_RANK.indexOf(a) + 1 || 99) - (HW_RANK.indexOf(b) + 1 || 99));
      const centroid = turf.centerOfMass(feat).geometry.coordinates.map((v) => Math.round(v * 1e5) / 1e5);

      features.push({
        type: "Feature",
        id,
        geometry: feat.geometry,
        properties: {
          id,
          name,
          type: classify(name),
          arr: [...arr].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
          len: lengthM,
          hw: hw[0] ?? "",
          c: centroid,
        },
      });
    }
  }

  // Deterministic order: by name then id
  features.sort((a, b) =>
    (a.properties!.name as string).localeCompare(b.properties!.name, "fr") ||
    (a.properties!.id as string).localeCompare(b.properties!.id),
  );

  // ids collide if a name had multiple clusters processed later: re-check uniqueness
  const seen = new Set<string>();
  for (const f of features) {
    if (seen.has(f.id as string)) throw new Error(`duplicate id ${f.id}`);
    seen.add(f.id as string);
  }

  const fc: FeatureCollection = { type: "FeatureCollection", features };
  const out = `public/data/${cfg.id}.json`;
  writeFileSync(out, JSON.stringify(fc));
  console.log(`  → ${features.length} streets written to ${out} (${(JSON.stringify(fc).length / 1e6).toFixed(1)} MB)`);

  if (districts.length) {
    const dfc: FeatureCollection = {
      type: "FeatureCollection",
      features: districts.map((d) => turf.truncate(turf.simplify(d, { tolerance: 0.00005 }), { precision: 5 })),
    };
    writeFileSync(`public/data/${cfg.id}-districts.json`, JSON.stringify(dfc));
  }

  // index
  const bbox = turf.bbox(fc);
  const indexPath = "public/data/cities.json";
  const index: any[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
  const entry = {
    id: cfg.id,
    name: cfg.name,
    bbox: bbox.map((v) => Math.round(v * 1e4) / 1e4),
    count: features.length,
    districts: districts.map((d) => d.properties.label).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
    types: [...new Set(features.map((f) => f.properties!.type as string))].sort((a, b) => a.localeCompare(b, "fr")),
    builtAt: new Date().toISOString().slice(0, 10),
  };
  const i = index.findIndex((c) => c.id === cfg.id);
  if (i >= 0) index[i] = entry; else index.push(entry);
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  // stats
  const byType = new Map<string, number>();
  for (const f of features) byType.set(f.properties!.type, (byType.get(f.properties!.type) ?? 0) + 1);
  console.log("  types:", Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])));
}

const cityId = process.argv[2] ?? "paris";
const cfg = CITIES[cityId];
if (!cfg) { console.error(`Unknown city ${cityId}. Known: ${Object.keys(CITIES).join(", ")}`); process.exit(1); }
build(cfg).catch((e) => { console.error(e); process.exit(1); });
