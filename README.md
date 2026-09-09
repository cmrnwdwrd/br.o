# BottleRag Player v28 — Refactor-only release

This release intentionally does not add or remove player features.

## Runtime structure

- `index.html` — page markup only
- `assets/styles.css` — all player styling, kept in the same cascade order as v27.1
- `js/01-core.js` — base metadata/API/rendering logic
- `js/02-player-ui.js` — audio transport, settings, category UI
- `js/03-history-storage.js` — IndexedDB, session/listening history, import/export
- `js/04-favorites-observed.js` — Spotify helpers, liked songs, observed-history ranking UI
- `js/05-shared-analytics.js` — GitHub shared history and Active Streams analytics
- `js/06-final-ui.js` — backup controls, simplified iPhone mode, search/filter/milestones, PWA registration
- `scripts/collect_bottlerag.py` — GitHub Actions data collector
- `.github/workflows/collect-bottlerag.yml` — scheduled collector workflow
- `data/` — shared generated history data


Enjoy!