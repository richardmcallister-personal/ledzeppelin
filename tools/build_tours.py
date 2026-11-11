#!/usr/bin/env python3
"""Tours for the /tour/ page, from the built show data (site/data/years/*.json).

Writes site/data/tours.json (the tours switched on, in PILOT) and site/data/tour/<slug>.json (each night: date, venue,
city, coordinates, setlist, and any picture tied to that date: Richard's tour photos, dated archive photos, poster art).
Run after tools/build_setlists.py and tools/import_kit.py. Add a tour name to PILOT to switch it on.
"""
import json, re, unicodedata
from pathlib import Path

S = Path(__file__).resolve().parent.parent / "site" / "data"
PILOT = ["North American Tour 1973"]
NOTES = {
    "North American Tour 1973": "Thirty-odd dates across the United States from May to July 1973, in stadiums and arenas, "
    "with Houses of the Holy just released. It opened in Atlanta and Tampa, where the crowd was reported as the biggest "
    "for a single act at one show in the US at the time, and closed with three nights at Madison Square Garden, filmed "
    "for The Song Remains the Same.",
}


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"['’`]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


shows = [s for f in sorted((S / "years").glob("*.json")) for s in json.loads(f.read_text())]
tour_photos = json.loads((S / "tour-photos.json").read_text())
gallery = json.loads((S / "gallery.json").read_text())
art = json.loads((S / "art.json").read_text())

index = []
(S / "tour").mkdir(exist_ok=True)
for name in PILOT:
    stops = sorted((s for s in shows if s.get("t") == name and s.get("ll")), key=lambda s: (s["d"], s["id"]))
    nights = []
    for s in stops:
        pics = [{"src": f"/img/tour/{p['s']}", "t": p["t"].rstrip("."), "link": p["src"]} for p in tour_photos if p["d"] == s["d"]]
        pics += [{"src": f"/img/{g['s']}", "t": g["t"]} for g in gallery if g.get("d") == s["d"]]
        if s["id"] in art.get("concerts", {}):
            a = art["concerts"][s["id"]]
            pics.append({"src": f"/img/{a}", "t": "Poster artwork for these shows" if "poster" in a else "Artwork"})
        nights.append({"id": s["id"], "d": s["d"], "v": s["v"], "c": s["c"], "st": s["st"], "cc": s["cc"],
                       "ll": s["ll"], "u": s["u"], "sets": s["sets"], "pics": pics})
    k = slug(name)
    (S / "tour" / f"{k}.json").write_text(json.dumps({"name": name, "note": NOTES.get(name, ""), "nights": nights}, ensure_ascii=False))
    index.append({"s": k, "name": name, "from": nights[0]["d"], "to": nights[-1]["d"], "n": len(nights),
                  "withSetlist": sum(1 for x in nights if any(st["s"] for st in x["sets"])),
                  "withPics": sum(1 for x in nights if x["pics"])})
(S / "tours.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
print(json.dumps(index, indent=1))
