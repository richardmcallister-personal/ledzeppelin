#!/usr/bin/env python3
"""Build the concert and song data from setlist.fm, through the site's own Worker.

Usage: python3 tools/build_setlists.py [--base https://ledzeppelin.richardmcallister.workers.dev] [--max-pages N]

The Worker holds the setlist.fm key and caches pages in KV; this script never sees the key.
setlist.fm allows about 2 requests a second, so pages are fetched ~0.7 s apart.

Writes (all under site/data/):
  index.json            totals, shows per year, upcoming shows, build time
  years/<yyyy>.json     every show that year, with setlists
  songs.json            every song: plays, first/last, plays per year, cover artist
  song/<slug>.json      every performance of one song
  otd.json              shows by month-day, for "On this day"
"""
import argparse, collections, datetime, json, re, sys, time, unicodedata, urllib.request
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="https://ledzeppelin.app")
ap.add_argument("--max-pages", type=int, default=0)
args = ap.parse_args()

root = Path(__file__).resolve().parent.parent / "site" / "data"
UA = "ledzeppelin-fansite-builder/1.0"


def get(page):
    for attempt in range(6):
        try:
            req = urllib.request.Request(f"{args.base}/api/setlists?p={page}", headers={"user-agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # 429 / 5xx: back off
            wait = 3 * (attempt + 1)
            print(f"  page {page}: {e}; retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"page {page} failed")


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"['’`]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "song"


first = get(1)
total, per = first["total"], first["per"] or 20
pages = -(-total // per)
if args.max_pages:
    pages = min(pages, args.max_pages)
print(f"{total} setlists, {pages} pages")

shows = {s["id"]: s for s in first["shows"]}
for p in range(2, pages + 1):
    time.sleep(0.7)
    for s in get(p)["shows"]:
        shows[s["id"]] = s
    if p % 20 == 0:
        print(f"  {p}/{pages} pages, {len(shows)} shows", flush=True)

# Shows before the name change. setlist.fm files these under The Yardbirds, so the artist query above
# misses them. Same four musicians; billed as the New Yardbirds (Scandinavia) or the Yardbirds (England).
# 15 Oct 1968 University of Surrey (43e9a33f) is left out: it looks like a duplicate of 25 Oct 1968.
PRE_NAME = {
    "Scandinavian tour 1968, as the New Yardbirds": [
        "23de5463", "33de5461", "2bde546a", "b90e106", "3bde546c", "33de5475",
        "2bde5476", "23de5477", "73de8219", "53e9a345", "53e9a339", "5be9a338"],
    "English dates 1968, as the Yardbirds": ["3bde547c", "43e9a337", "33de547d", "2bde547e"],
}
for tour, ids in PRE_NAME.items():
    for sid in ids:
        time.sleep(0.7)
        for attempt in range(4):
            try:
                req = urllib.request.Request(f"{args.base}/api/setlist?id={sid}", headers={"user-agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    s = json.load(r)
                break
            except Exception as e:
                print(f"  {sid}: {e}", file=sys.stderr); time.sleep(3 * (attempt + 1))
        else:
            raise SystemExit(f"setlist {sid} failed")
        s["t"] = tour
        shows[s["id"]] = s
print(f"{sum(len(v) for v in PRE_NAME.values())} pre-name shows added")

today = datetime.date.today().isoformat()
all_shows = sorted(shows.values(), key=lambda s: (s["d"], s["id"]))
past = [s for s in all_shows if s["d"] < today or any(x["s"] for x in s["sets"])]
upcoming = [s for s in all_shows if s not in past]

# Years
(root / "years").mkdir(parents=True, exist_ok=True)
by_year = collections.defaultdict(list)
for s in past:
    by_year[s["d"][:4]].append(s)
for y, lst in by_year.items():
    (root / "years" / f"{y}.json").write_text(json.dumps(lst, ensure_ascii=False, separators=(",", ":")))

# Songs
songs = {}
perf = collections.defaultdict(list)
for s in past:
    seen = set()
    for st in s["sets"]:
        for x in st["s"]:
            k = slug(x["n"])
            if k in seen:          # same song twice in one show counts once
                continue
            seen.add(k)
            o = songs.setdefault(k, {"n": x["n"], "s": k, "k": 0, "f": None, "l": None, "c": None, "y": collections.Counter(), "names": collections.Counter()})
            o["k"] += 1
            o["names"][x["n"]] += 1
            if x.get("c"):
                o["c"] = x["c"]
            o["y"][s["d"][:4]] += 1
            ref = [s["d"], s["id"]]
            if not o["f"]:
                o["f"] = ref
            o["l"] = ref
            perf[k].append([s["d"], s["id"], s["v"], s["c"], s["cc"]])

out = []
for k, o in songs.items():
    o["n"] = o["names"].most_common(1)[0][0]
    out.append({"n": o["n"], "s": k, "k": o["k"], "f": o["f"], "l": o["l"], "c": o["c"], "y": dict(sorted(o["y"].items()))})
out.sort(key=lambda o: (-o["k"], o["n"]))
(root / "songs.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

(root / "song").mkdir(exist_ok=True)
for old in (root / "song").glob("*.json"):
    old.unlink()
for k, lst in perf.items():
    (root / "song" / f"{k}.json").write_text(json.dumps({"n": songs[k]["n"], "p": lst}, ensure_ascii=False, separators=(",", ":")))

# On this day
otd = collections.defaultdict(list)
for s in past:
    otd[s["d"][5:]].append([int(s["d"][:4]), s["id"], s["v"], s["c"], s["cc"]])
(root / "otd.json").write_text(json.dumps(otd, ensure_ascii=False, separators=(",", ":")))

with_songs = [s for s in past if any(x["s"] for x in s["sets"])]
index = {
    "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    "total": len(past),
    "withSetlist": len(with_songs),
    "songs": len(out),
    "years": {y: len(v) for y, v in sorted(by_year.items())},
    "countries": len({s["cc"] for s in past if s["cc"]}),
    "upcoming": [{k: s[k] for k in ("id", "d", "v", "c", "st", "cc", "cn", "t", "u")} for s in upcoming],
    "last": {k: with_songs[-1][k] for k in ("id", "d", "v", "c", "cc")} if with_songs else None,
}
(root / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
print(f"{len(past)} past shows ({len(with_songs)} with setlists), {len(upcoming)} upcoming, {len(out)} songs")
