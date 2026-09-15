import type { TrainingSet } from "./types";

type Payload = { n: string; c: string; s: string[] };

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4))));
}

export function encodeSet(set: TrainingSet): string {
  const p: Payload = { n: set.name, c: set.cityId, s: set.streetIds };
  return b64url(JSON.stringify(p));
}

export function decodeSet(s: string): { name: string; cityId: string; streetIds: string[] } | null {
  try {
    const p = JSON.parse(unb64url(s)) as Payload;
    if (!p.c || !Array.isArray(p.s)) return null;
    return { name: p.n || "Set partagé", cityId: p.c, streetIds: p.s.filter((x) => typeof x === "string") };
  } catch {
    return null;
  }
}

export function shareUrl(set: TrainingSet): string {
  const u = new URL(location.href);
  u.hash = `#/share/${encodeSet(set)}`;
  return u.toString();
}
