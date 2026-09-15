import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "edit"; setId: string }
  | { name: "quiz"; setId: string; mode: "place" | "name" }
  | { name: "share"; payload: string };

export function parseHash(h = location.hash): Route {
  const [path, query = ""] = h.replace(/^#/, "").split("?");
  const seg = path.split("/").filter(Boolean);
  const q = new URLSearchParams(query);
  if (seg[0] === "set" && seg[1]) return { name: "edit", setId: seg[1] };
  if (seg[0] === "quiz" && seg[1]) return { name: "quiz", setId: seg[1], mode: q.get("mode") === "name" ? "name" : "place" };
  if (seg[0] === "share" && seg[1]) return { name: "share", payload: seg[1] };
  return { name: "home" };
}

export function navigate(to: string) {
  location.hash = to;
}

export function useRoute(): Route {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const f = () => setR(parseHash());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return r;
}
