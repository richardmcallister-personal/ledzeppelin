#!/usr/bin/env python3
"""Album facts for /album/ pages, from Wikipedia (via the site's Worker) with MusicBrainz as fallback.

Usage: python3 tools/build_albums.py [--base https://ledzeppelin.app]

Reads tools/wiki_titles.json (slug -> English Wikipedia title, or null when there is no article) and
site/data/albums.json. Writes site/data/album/<slug>.json with:
  released, recorded, studios, venues, producers, label, length, genres   (infobox)
  personnel: [{group, name, role}]                                          (Personnel section)
  tracks:    [{side, n, title, writer, length, note}]                       (track listing templates)
  charts:    [{chart, peak, year}]                                          (Charts section)
  certs:     [{region, award}]                                              (Certifications)
  wiki: {title, url, revid}                                                 (source, CC BY-SA)
Only facts and titles are taken — never lyrics or article prose. Editorial text lives in data/album_notes.json.
"""
import argparse, json, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
import mwparserfromhell as mw

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="https://ledzeppelin.app")
ap.add_argument("--cache", default="/tmp/lzwiki")
args = ap.parse_args()

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "album"
OUT.mkdir(parents=True, exist_ok=True)
TITLES = json.load(open(ROOT / "tools" / "wiki_titles.json"))
ALBUMS = json.load(open(ROOT / "site" / "data" / "albums.json"))
UA = "ledzeppelin.app-builder/1.0 (+https://ledzeppelin.app)"
cache = Path(args.cache)
cache.mkdir(exist_ok=True)


def wiki(title):
    f = cache / (urllib.parse.quote(title, safe="") + ".json")
    if f.exists():
        return json.load(open(f))
    u = f"{args.base}/api/wiki?t={urllib.parse.quote(title)}"
    with urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": UA}), timeout=60) as r:
        d = json.load(r)
    f.write_text(json.dumps(d))
    time.sleep(0.4)
    return d


def plain(x):
    """Wikitext fragment -> plain text."""
    if x is None:
        return ""
    s = str(x)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    code = mw.parse(s)
    for t in code.filter_templates(recursive=False):
        n = str(t.name).strip().lower()
        try:
            if n in ("hlist", "flatlist", "plainlist", "ubl", "unbulleted list", "flat list"):
                items = []
                for p in t.params:
                    if p.showkey:
                        continue
                    raw = str(p.value)
                    parts = re.split(r"\n\s*\*", "\n" + raw) if "*" in raw else [raw]
                    items += [plain(x) for x in parts]
                code.replace(t, "; ".join(i for i in items if i))
            elif n in ("start date", "start-date", "release date", "start date and age", "end date"):
                v = [str(p.value).strip() for p in t.params if not p.showkey]
                MON = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
                if len(v) >= 3 and v[1].isdigit() and v[2].isdigit():
                    code.replace(t, f"{MON[int(v[1])]} {int(v[2])}, {v[0]}")
                elif len(v) >= 2 and v[1].isdigit():
                    code.replace(t, f"{MON[int(v[1])]} {v[0]}")
                else:
                    code.replace(t, v[0] if v else "")
            elif n == "duration":
                h = t.get("h").value.strip() if t.has("h") else ""
                m = t.get("m").value.strip() if t.has("m") else "0"
                sec = t.get("s").value.strip() if t.has("s") else "0"
                code.replace(t, (f"{h}:" if h else "") + f"{int(m or 0)}:{int(sec or 0):02d}")
            elif n in ("nowrap", "nobr", "small", "lang", "noitalic", "not a typo"):
                v = [p.value for p in t.params if not p.showkey]
                code.replace(t, plain(v[-1]) if v else "")
            elif n in ("'", "'s"):
                code.replace(t, "'")
            elif n in ("ndash", "snd", "spaced ndash"):
                code.replace(t, " – ")
            else:
                code.remove(t)
        except ValueError:
            pass
    s = code.strip_code(normalize=True, collapse=True)
    s = s.replace("&nbsp;", " ").replace(" ", " ")
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;")
    return s


SECTIONS = {}


def sections_of(wikitext):
    """Split wikitext on heading lines (robust to unbalanced templates that confuse a full parse)."""
    out, cur, buf = [], ("", 1), []
    for line in wikitext.split("\n"):
        m = re.match(r"^(={2,4})\s*(.+?)\s*\1\s*$", line)
        if m:
            out.append((cur[0], cur[1], "\n".join(buf)))
            cur, buf = (plain(m.group(2)), len(m.group(1))), []
        else:
            buf.append(line)
    out.append((cur[0], cur[1], "\n".join(buf)))
    return out


def section(code, name_re, stop_sub=None):
    """Text of the first section whose heading matches, including its subsections (minus any matching stop_sub)."""
    secs = SECTIONS["cur"]
    for i, (h, lvl, body) in enumerate(secs):
        if h and re.search(name_re, h, re.I):
            parts = [body]
            for h2, l2, b2 in secs[i + 1:]:
                if l2 <= lvl:
                    break
                if stop_sub and re.search(stop_sub, h2, re.I):
                    continue
                parts.append(f"=== {h2} ===\n" + b2)
            return "\n".join(parts)
    return None


def infobox(code):
    for t in code.filter_templates():
        if str(t.name).strip().lower().startswith("infobox album"):
            return t
    return None


def ib(t, *names):
    for n in names:
        if t is not None and t.has(n):
            raw = str(t.get(n).value).strip()
            m = re.match(r"^\{\{\s*(?:flatlist|plainlist|flat list)\s*\|(.*)\}\}$", raw, re.S | re.I)
            if m:
                raw = m.group(1)
            if re.search(r"(^|\n)\s*\*", raw):
                v = "; ".join(x for x in (plain(b) for b in re.split(r"(?:^|\n)\s*\*", raw)) if x)
            else:
                v = plain(raw)
            if v:
                return v
    return ""


def split_list(s):
    return [x.strip(" *") for x in re.split(r";|\s\*|^\*", s) if x.strip(" *")]


def personnel(code):
    sec = section(code, r"^personnel|^credits")
    if not sec:
        return []
    out, group = [], ""
    for line in sec.split("\n"):
        L = line.strip()
        if not L:
            continue
        m = re.match(r"^=+\s*(.+?)\s*=+$", L) or re.match(r"^'''(.+?)'''\s*:?$", L) or re.match(r"^;\s*(.+)$", L)
        if m:
            group = plain(m.group(1)).rstrip(":")
            continue
        if L.startswith("*"):
            t = plain(L.lstrip("*").strip())
            if not t:
                continue
            parts = re.split(r"\s+[–—-]\s+|\s*:\s+", t, maxsplit=1)
            name, role = (parts[0], parts[1]) if len(parts) == 2 else (t, "")
            if len(name) > 80:
                continue
            out.append({"group": group, "name": name.strip(), "role": role.strip()})
    return out[:120]


def tracks(code):
    out = []
    for t in code.filter_templates():
        if str(t.name).strip().lower().replace("_", "").replace(" ", "") not in ("tracklisting", "tracklist"):
            continue
        side = plain(t.get("headline").value) if t.has("headline") else ""
        if re.search(r"track ?listing", side, re.I):
            side = ""
        allw = plain(t.get("all_writing").value) if t.has("all_writing") else ""
        allw = re.sub(r",?\s*except where (otherwise )?noted.*$", "", allw, flags=re.I)
        allw = re.split(r"\.\s", allw)[0].strip(" .")
        extra_col = plain(t.get("extra_column").value) if t.has("extra_column") else ""
        i = 1
        while t.has(f"title{i}"):
            title = plain(t.get(f"title{i}").value)
            w = plain(t.get(f"writer{i}").value) if t.has(f"writer{i}") else ""
            note = plain(t.get(f"note{i}").value) if t.has(f"note{i}") else ""
            ln = plain(t.get(f"length{i}").value) if t.has(f"length{i}") else ""
            extra = plain(t.get(f"extra{i}").value) if t.has(f"extra{i}") else ""
            row = {"side": side, "n": i, "title": title.strip('"'), "writer": w or allw, "length": ln}
            if note:
                row["note"] = note
            if extra and re.search(r"record", extra_col, re.I):
                row["rec"] = extra
            out.append(row)
            i += 1
    return out[:400]


CHART_NAMES = {
    "billboard200": "US Billboard 200", "uk2": "UK Albums Chart", "ukalbum": "UK Albums Chart", "australia": "Australia",
    "austria": "Austria", "flanders": "Belgium (Flanders)", "wallonia": "Belgium (Wallonia)", "canada": "Canada",
    "denmark": "Denmark", "netherlands": "Netherlands", "finland": "Finland", "france": "France", "germany4": "Germany",
    "germany": "Germany", "hungary": "Hungary", "ireland": "Ireland", "italy": "Italy", "japan": "Japan (Oricon)",
    "oricon": "Japan (Oricon)", "newzealand": "New Zealand", "norway": "Norway", "portugal": "Portugal", "spain": "Spain",
    "sweden": "Sweden", "switzerland": "Switzerland", "scotland": "Scotland", "czech": "Czech Republic", "greece": "Greece",
    "poland": "Poland", "croatia": "Croatia", "lithuania": "Lithuania", "billboardcanada": "Canada", "rpm": "Canada (RPM)",
    "billboardtopcatalog": "US Top Catalog Albums", "billboardrockalbums": "US Top Rock Albums",
    "billboardfolkalbums": "US Americana/Folk Albums", "billboardvinylalbums": "US Vinyl Albums",
    "billboardtopalbumsales": "US Top Album Sales", "ukrock": "UK Rock & Metal Albums", "ukindependent": "UK Independent Albums",
    "irishindependent": "Irish Independent Albums", "billboardindependent": "US Independent Albums",
    "billboardtastemaker": "US Tastemaker Albums", "billboardchristmas": "US Holiday Albums",
}


def table_rows(text):
    """Yield rows (list of plain cell strings) from wikitables, applying rowspans."""
    for tbl in re.findall(r"\{\|.*?\n\|\}", text, re.S):
        span = {}  # col -> (value, remaining)
        for raw in re.split(r"\n\|-[^\n]*", tbl)[1:]:
            cells = []
            for line in raw.strip("\n").split("\n"):
                line = line.strip()
                if not line or line.startswith("|}") or line.startswith("{|"):
                    continue
                if line[0] in "!|":
                    sep = "!!" if line[0] == "!" else "||"
                    for c in line[1:].split(sep):
                        cells.append(c)
                elif cells:
                    cells[-1] += " " + line
            row, col = [], 0
            for c in cells:
                while col in span and span[col][1] > 0:
                    v, n = span[col]; row.append(v); span[col] = (v, n - 1); col += 1
                rs = re.search(r'rowspan\s*=\s*"?(\d+)', c)
                val = c.split("|", 1)[1] if re.match(r'^\s*[a-z-]+\s*=\s*"?[^|]*"?\s*\|', c) else c
                val = plain(val)
                if rs:
                    span[col] = (val, int(rs.group(1)) - 1)
                row.append(val); col += 1
            while col in span and span[col][1] > 0:
                v, n = span[col]; row.append(v); span[col] = (v, n - 1); col += 1
            yield row


def charts(code):
    sec = section(code, r"^charts?$|chart positions|^weekly charts|^chart performance|^charts and certifications|^chart history", stop_sub=r"single|year-end|year end|decade|certif")
    if not sec:
        return []
    out = []
    for t in mw.parse(sec).filter_templates():
        if str(t.name).strip().lower() == "album chart":
            ps = [str(p.value).strip() for p in t.params if not p.showkey]
            if len(ps) >= 2:
                out.append({"chart": CHART_NAMES.get(ps[0].lower(), ps[0]), "peak": re.sub(r"[^0-9]", "", ps[1]) or ps[1], "year": ""})
    for row in table_rows(sec):
        nums = [i for i, c in enumerate(row) if re.fullmatch(r"\d{1,3}", c)]
        names = [i for i, c in enumerate(row) if re.search(r"[A-Za-z]{3}", c) and not re.fullmatch(r"(chart|peak|position|year).*", c, re.I)]
        if not nums or not names:
            continue
        name = row[names[0]]
        if re.search(r"^\(?\d{4}", name) or len(name) > 70:
            continue
        year = next((re.match(r"\d{4}", c).group(0) for c in row if re.fullmatch(r"\d{4}", c)), "")
        out.append({"chart": name, "peak": row[nums[-1]], "year": year})
    seen, res = set(), []
    for c in out:
        k = (c["chart"].lower(), c["peak"])
        if k in seen:
            continue
        seen.add(k); res.append(c)
    return res[:60]


def certs(code):
    out = []
    for t in code.filter_templates():
        if str(t.name).strip().lower() == "certification table entry":
            region = plain(t.get("region").value) if t.has("region") else ""
            award = plain(t.get("award").value) if t.has("award") else ""
            num = plain(t.get("number").value) if t.has("number") else ""
            if region and award:
                out.append({"region": region, "award": (f"{num}× " if num and num not in ("1",) else "") + award})
    return out


def mb_tracks(title):
    """MusicBrainz fallback: the release group's earliest official release track list."""
    q = urllib.parse.quote(f'releasegroup:({title}) AND artist:"Led Zeppelin"')
    hdr = {"user-agent": UA, "accept": "application/json"}
    def get(u):
        for attempt in range(5):
            time.sleep(1.5 + attempt * 3)
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers=hdr), timeout=60) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code not in (429, 503):
                    raise
        raise RuntimeError("musicbrainz unavailable")
    rg = get(f"https://musicbrainz.org/ws/2/release-group/?query={q}&fmt=json&limit=3")
    if not rg.get("release-groups"):
        return [], None
    g = rg["release-groups"][0]
    rels = get(f"https://musicbrainz.org/ws/2/release?release-group={g['id']}&status=official&fmt=json&limit=5")
    if not rels.get("releases"):
        return [], None
    rel = sorted(rels["releases"], key=lambda r: r.get("date") or "9999")[0]
    full = get(f"https://musicbrainz.org/ws/2/release/{rel['id']}?inc=recordings&fmt=json")
    out = []
    for i, m in enumerate(full.get("media", []), 1):
        side = m.get("title") or (f"Disc {i}" if len(full["media"]) > 1 else "")
        for tr in m.get("tracks", []):
            ms = tr.get("length")
            out.append({"side": side, "n": int(tr.get("position") or 0), "title": tr["title"], "writer": "",
                        "length": f"{ms // 60000}:{(ms // 1000) % 60:02d}" if ms else ""})
    return out, {"release": rel["id"], "url": f"https://musicbrainz.org/release/{rel['id']}", "released": rel.get("date", "")}


# MusicBrainz release-group titles where the official catalogue title differs.
MB_TITLE = {"live-ep": "Live EP"}

n_ok = 0
for a in ALBUMS:
    slug = a["s"]
    title = TITLES.get(slug)
    rec = {"s": slug, "t": a["t"], "y": a["y"]}
    if title:
        try:
            d = wiki(title)
        except Exception as e:
            print("  wikipedia failed", slug, title, e, file=sys.stderr); d = None
    if title and d:
        code = mw.parse(d["wikitext"])
        SECTIONS["cur"] = sections_of(d["wikitext"])
        box = infobox(code)
        rec.update({
            "released": ib(box, "released", "release_date"),
            "recorded": ib(box, "recorded"),
            "studios": split_list(ib(box, "studio")),
            "venues": split_list(ib(box, "venue")),
            "producers": split_list(ib(box, "producer")),
            "label": ib(box, "label"),
            "length": ib(box, "length"),
            "genres": split_list(ib(box, "genre")),
            "personnel": personnel(code),
            "tracks": tracks(code),
            "charts": charts(code),
            "certs": certs(code),
            "wiki": {"title": d["title"], "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(d["title"].replace(" ", "_")), "revid": d.get("revid")},
        })
    if not rec.get("tracks"):
        try:
            tr, mb = mb_tracks(MB_TITLE.get(slug) or a["t"].split(" – ")[0].replace("’", "'"))
            if tr:
                rec["tracks"] = tr
                rec["mb"] = mb
        except Exception as e:
            print("  musicbrainz failed", slug, e, file=sys.stderr)
    (OUT / f"{slug}.json").write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
    n_ok += 1
    print(f"{slug}: {len(rec.get('tracks', []))} tracks, {len(rec.get('personnel', []))} people, {len(rec.get('charts', []))} charts")
print(n_ok, "albums written")
