/** lowercase, strip accents & punctuation, collapse spaces */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TYPE_WORDS =
  /^(grande |petite )?(rue|avenue|boulevard|bd|av|place|pl|quai|pont|passage|villa|impasse|allee|cite|square|cours|chemin|route|sentier|sente|voie|promenade|esplanade|rond point|carrefour|parvis|port|galerie|hameau|ruelle|jardin|cour|terrasse|mail|escalier|porte|tunnel)\b\s*/;
const ARTICLES = /^(de la|de l|du|des|de|d|la|le|les|l)\b\s*/;

/** "Rue de la Paix" → "paix" : the distinctive part of a name */
export function core(s: string): string {
  let n = normalize(s);
  n = n.replace(TYPE_WORDS, "");
  n = n.replace(ARTICLES, "");
  return n.trim();
}

export function answerMatches(answer: string, name: string): boolean {
  const a = normalize(answer);
  if (!a) return false;
  if (a === normalize(name)) return true;
  const ca = core(answer);
  return ca.length >= 3 && ca === core(name);
}

/** Rank a street for a search query: 0 = no match, higher = better */
export function searchScore(query: string, name: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const n = normalize(name);
  const c = core(name);
  if (n === q) return 100;
  if (c.startsWith(q)) return 80 - Math.min(20, c.length - q.length);
  if (n.startsWith(q)) return 70;
  const words = q.split(" ");
  if (words.every((w) => n.includes(w))) return 40 - Math.min(20, n.length / 10);
  return 0;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
