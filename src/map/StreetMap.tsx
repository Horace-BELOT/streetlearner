import { useEffect, useRef } from "react";
import { Map as MLMap, NavigationControl, setWorkerUrl, type MapMouseEvent, type LayerSpecification, type ExpressionSpecification } from "maplibre-gl";
// MapLibre resolves its worker relative to its own module URL, which breaks once bundled:
// let Vite bundle the worker (and its shared chunk) and hand MapLibre the resulting URL.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
setWorkerUrl(maplibreWorkerUrl);
import turfBbox from "@turf/bbox";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { LineString, MultiLineString } from "geojson";
import type { CityData } from "../lib/types";

export type StreetState = "selected" | "candidate" | "target" | "correct" | "wrong";

export type StreetMapProps = {
  city: CityData;
  /** map of streetId → visual state */
  states: Record<string, StreetState>;
  /** hide street names & neighbourhood labels of the base map (quiz mode) */
  hideLabels?: boolean;
  /** draw the streets that have no state as faint lines */
  showAll?: boolean;
  /** allow hover/click on streets */
  interactive?: boolean;
  /** externally-controlled hover (e.g. from a list) */
  hoverId?: string | null;
  onClick?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** fit the map to these street ids; change `nonce` to re-trigger */
  fit?: { ids: string[]; nonce: number; padding?: number } | null;
  className?: string;
};

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const SRC = "streets";
const DISTRICTS = "districts";

const COLORS: Record<StreetState, string> = {
  selected: "#7c3aed",
  candidate: "#0ea5e9",
  target: "#2563eb",
  correct: "#16a34a",
  wrong: "#dc2626",
};

const stateColor = (fallback: string): ExpressionSpecification => {
  const expr: unknown[] = ["case", ["boolean", ["feature-state", "hover"], false], "#f59e0b"];
  for (const [k, v] of Object.entries(COLORS)) expr.push(["==", ["feature-state", "s"], k], v);
  expr.push(fallback);
  return expr as ExpressionSpecification;
};

const hasState: ExpressionSpecification = ["to-boolean", ["feature-state", "s"]];
const isHover: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

function layers(showAll: boolean): LayerSpecification[] {
  const baseOpacity = showAll ? 0.45 : 0;
  return [
    {
      id: "districts-line",
      type: "line",
      source: DISTRICTS,
      paint: { "line-color": "#94a3b8", "line-width": 1, "line-dasharray": [3, 3], "line-opacity": 0.7 },
    },
    {
      id: "streets-fill",
      type: "fill",
      source: SRC,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": stateColor("#64748b"),
        "fill-opacity": ["case", hasState, 0.45, isHover, 0.4, showAll ? 0.15 : 0],
      },
    },
    {
      id: "streets-line",
      type: "line",
      source: SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": stateColor("#64748b"),
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["case", hasState, 3, isHover, 2.5, 0.8], 16, ["case", hasState, 8, isHover, 6, 2]],
        "line-opacity": ["case", hasState, 1, isHover, 1, baseOpacity],
      },
    },
    {
      id: "streets-hit",
      type: "line",
      source: SRC,
      filter: ["!=", ["geometry-type"], "Polygon"],
      paint: { "line-width": 16, "line-opacity": 0 },
    },
  ];
}

export default function StreetMap(p: StreetMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const appliedStates = useRef<Record<string, StreetState>>({});
  const hoveredRef = useRef<string | null>(null);
  const propsRef = useRef(p);
  propsRef.current = p;

  const setHover = (map: MLMap, id: string | null) => {
    if (hoveredRef.current === id) return;
    if (hoveredRef.current) map.setFeatureState({ source: SRC, id: hoveredRef.current }, { hover: false });
    if (id) map.setFeatureState({ source: SRC, id }, { hover: true });
    hoveredRef.current = id;
  };

  // --- init
  useEffect(() => {
    if (!el.current) return;
    const b = p.city.index.bbox;
    const map = new MLMap({
      container: el.current,
      style: STYLE,
      bounds: [[b[0], b[1]], [b[2], b[3]]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map;

    map.on("load", () => {
      map.addSource(SRC, { type: "geojson", data: p.city.fc, promoteId: "id" });
      map.addSource(DISTRICTS, { type: "geojson", data: p.city.districts ?? { type: "FeatureCollection", features: [] } });
      const firstSymbol = map.getStyle().layers.find((l: LayerSpecification) => l.type === "symbol")?.id;
      for (const l of layers(!!propsRef.current.showAll)) map.addLayer(l, l.id === "streets-hit" ? undefined : firstSymbol);
      readyRef.current = true;
      applyLabels(map, !!propsRef.current.hideLabels);
      applyStates(map);
      applyFit(map);
    });

    const hitLayers = ["streets-hit", "streets-fill"];
    /** Several streets overlap under the cursor at low zoom: prefer polygons, then the nearest line. */
    const pick = (e: MapMouseEvent): string | null => {
      const hits = map.queryRenderedFeatures(e.point, { layers: hitLayers });
      if (!hits.length) return null;
      const poly = hits.find((f) => f.layer.id === "streets-fill");
      if (poly) return poly.id as string;
      const pt = [e.lngLat.lng, e.lngLat.lat];
      let best: { id: string; d: number } | null = null;
      for (const f of hits) {
        const g = f.geometry as LineString | MultiLineString;
        if (g.type !== "LineString" && g.type !== "MultiLineString") continue;
        const d = nearestPointOnLine(g, pt).properties.dist ?? Infinity;
        if (!best || d < best.d) best = { id: f.id as string, d };
      }
      return best?.id ?? (hits[0].id as string);
    };
    const onMove = (e: MapMouseEvent) => {
      if (!propsRef.current.interactive) return;
      const id = pick(e);
      map.getCanvas().style.cursor = id ? "pointer" : "";
      if (id !== hoveredRef.current) {
        setHover(map, id);
        propsRef.current.onHover?.(id);
      }
    };
    const onLeave = () => {
      if (hoveredRef.current) {
        setHover(map, null);
        propsRef.current.onHover?.(null);
      }
    };
    const onClick = (e: MapMouseEvent) => {
      if (!propsRef.current.interactive) return;
      const id = pick(e);
      if (id) propsRef.current.onClick?.(id);
    };
    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);
    map.on("click", onClick);

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.city]);

  const applyLabels = (map: MLMap, hide: boolean) => {
    for (const l of map.getStyle().layers) {
      if (l.type !== "symbol") continue;
      const sl = (l as { "source-layer"?: string })["source-layer"];
      if (sl === "transportation_name" || l.id === "label_other" || sl === "poi") {
        map.setLayoutProperty(l.id, "visibility", hide ? "none" : "visible");
      }
    }
  };

  const applyStates = (map: MLMap) => {
    const next = propsRef.current.states;
    const prev = appliedStates.current;
    for (const id of Object.keys(prev)) if (!(id in next)) map.removeFeatureState({ source: SRC, id }, "s");
    for (const [id, s] of Object.entries(next)) if (prev[id] !== s) map.setFeatureState({ source: SRC, id }, { s });
    appliedStates.current = { ...next };
  };

  const applyFit = (map: MLMap) => {
    const fit = propsRef.current.fit;
    if (!fit || !fit.ids.length) return;
    const feats = fit.ids.map((id) => propsRef.current.city.fc.features.find((f) => f.properties.id === id)).filter(Boolean);
    if (!feats.length) return;
    const b = turfBbox({ type: "FeatureCollection", features: feats as never[] });
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fit.padding ?? 80, maxZoom: 16, duration: 700 });
  };

  useEffect(() => { if (readyRef.current && mapRef.current) applyStates(mapRef.current); }, [p.states]);
  useEffect(() => { if (readyRef.current && mapRef.current) applyLabels(mapRef.current, !!p.hideLabels); }, [p.hideLabels]);
  useEffect(() => { if (readyRef.current && mapRef.current) applyFit(mapRef.current); }, [p.fit?.nonce]);
  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map) return;
    const base = p.showAll ? 0.45 : 0;
    map.setPaintProperty("streets-line", "line-opacity", ["case", hasState, 1, isHover, 1, base]);
    map.setPaintProperty("streets-fill", "fill-opacity", ["case", hasState, 0.45, isHover, 0.4, p.showAll ? 0.15 : 0]);
  }, [p.showAll]);
  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || p.hoverId === undefined) return;
    setHover(map, p.hoverId);
  }, [p.hoverId]);

  return <div ref={el} className={p.className ?? "h-full w-full"} />;
}
