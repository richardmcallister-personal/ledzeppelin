# Led Zeppelin fan site — handover (7 Nov 2026)

Start a new chat with `richardmcallister-personal/ledzeppelin` attached. Read `CLAUDE.md` first.

## State (v1, live on ledzeppelin.richardmcallister.workers.dev)

- Worker `ledzeppelin`: `/health` setlist.fm OK, Anthropic OK, KV bound, Spotify not configured.
- Data built 7 Nov 2026 from setlist.fm: 520 shows (477 with setlists), 1968–2007, 19 countries, 103 songs.
- **Home:** hero with counts and cover strip; the last show (O2, 10 Dec 2007, setlist live); shows-per-year bars;
  Dazed and Confused feature; On this day; top 10 most played; journeys; the four members with their symbols;
  gallery feature.
- **Albums:** 21 releases (9 studio incl. Coda, live, films, 6 compilations incl. the 1990 box set, Remasters,
  Early Days / Latter Days / The Very Best of, Mothership; Live E.P. 2025). Compilation dates before 2007 are
  month- or year-level (`D.date` handles YYYY-MM and YYYY); dialog with note, track
  list with live counts, later editions (deluxe / 2018 remasters / Complete BBC Sessions / film) as small covers.
- **Songs:** setlist songs plus the 23 studio tracks never played live on record; filters own / covers / never.
- **Song, Shows, Setlist:** as on bobdylan.app, without tour dates.
- **Journeys** (6), **Band** (members + Peter Grant, Jason Bonham), **Timeline** (milestones + releases + shows),
  **Gallery** (13 supplied photos with tap-to-enlarge).
- **Influences** (8 Nov): "Credits and the courts" (5 hand-checked notes in data/influences.json: Babe I'm Gonna
  Leave You, Dazed and Confused, Whole Lotta Love, The Lemon Song, Stairway) and every artist covered on stage,
  built live from songs.json, grouped by style (groups hand-kept in influences.json — add any new setlist.fm
  artist there). Song pages link the cover artist and show the credit note. In archive nav, footer and search.

## Known gaps / next

1. Custom domain: none yet — add routes to wrangler.jsonc when Richard picks one (www redirect is already generic).
2. Compilation covers added 7 Nov (box set, Remasters, Early Days, Latter Days, The Very Best of). Exact day of
   release not filled for those; add if a reliable source turns up.
3. Gallery captions for kit/photos/* are generic (no dates/places known) — ask Richard if he has them.
4. setlist.fm data is user-entered: some songs are missing from some setlists (e.g. very few In Through the Out
   Door songs). Corrections go to setlist.fm, then re-run the builder.
5. Ask the archive (Anthropic key is on the Worker), as on manutd.wiki, never quoting lyrics.
6. Spotify keys → song players. Weekly refresh is not needed (no new shows); re-run only after setlist.fm edits.

## How to refresh the data

```
python3 tools/build_setlists.py      # ~30 s, 26 pages through the Worker
python3 tools/catalogue.py           # after editing album data
python3 tools/import_kit.py          # after adding files to kit/
```
