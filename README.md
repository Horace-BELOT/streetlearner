# StreetLearner

Apprendre le nom des rues d'une ville en jouant. Static web app, zéro serveur : les données sont précalculées
depuis OpenStreetMap, les training sets et la progression vivent dans IndexedDB.

## Stack

- Vite + React 19 + TypeScript + Tailwind v4
- [MapLibre GL JS](https://maplibre.org/) avec le fond de carte [OpenFreeMap](https://openfreemap.org/) (positron, sans clé)
- Données : OpenStreetMap via Overpass, fusionnées par nom (`scripts/build-city.ts`)
- Stockage : `idb-keyval` · Répétition espacée : Leitner (6 boîtes, 0 → 10 min → 1 j → 3 j → 7 j → 30 j)
- Hébergement : GitHub Pages (workflow `.github/workflows/deploy.yml`)

## Dev

```sh
pnpm install
pnpm dev
```

## Regénérer / ajouter une ville

```sh
pnpm build:city paris
```

Le script interroge Overpass (résultat mis en cache dans `.cache/`), fusionne les ways OSM d'une même voie,
sépare les homonymes éloignés de plus de 80 m, classe par type (Rue, Avenue, Place…), rattache aux arrondissements
(admin_level 9) et écrit `public/data/<ville>.json` + `public/data/cities.json`.

Pour ajouter une ville : une entrée dans `CITIES` (`scripts/build-city.ts`) avec l'ID de relation OSM
(`relationId`), éventuellement le `districtLevel` et un `districtLabel`.

## Modes de quiz

- **Nom → placer** : on te donne un nom, tu cliques la voie sur la carte (toutes les voies de la ville sont cliquables).
- **Lieu → nommer** : une voie est surlignée, tu tapes son nom (autocomplétion, accents et articles tolérés).

Les noms de rues et de quartiers du fond de carte sont masqués pendant le quiz.

## Données

© contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
