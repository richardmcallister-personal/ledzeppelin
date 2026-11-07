#!/usr/bin/env python3
"""Hand-kept catalogue data → site/data/albums.json, members.json, gallery.json.

Covers are made from kit/releases by tools/import_kit.py. Edit the lists here, then run this script.
Dates are first release dates (UK/US, whichever came first). Track titles only, never lyrics.
"""
import json, re, unicodedata, urllib.parse
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "site" / "data"


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"['’`]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "song"


# s, title, release date, categories, tracks (studio only), note, editions [(slug, title, year)]
ALBUMS = [
    ("led-zeppelin", "Led Zeppelin", "1969-01-12", ["studio"],
     ["Good Times Bad Times", "Babe, I'm Gonna Leave You", "You Shook Me", "Dazed and Confused", "Your Time Is Gonna Come",
      "Black Mountain Side", "Communication Breakdown", "I Can't Quit You Baby", "How Many More Times"],
     "Recorded in about 36 hours of studio time in October 1968, before the band had a record deal.",
     [("led-zeppelin-deluxe", "Deluxe Edition", 2014)]),
    ("led-zeppelin-ii", "Led Zeppelin II", "1969-10-22", ["studio"],
     ["Whole Lotta Love", "What Is and What Should Never Be", "The Lemon Song", "Thank You", "Heartbreaker",
      "Living Loving Maid (She's Just a Woman)", "Ramble On", "Moby Dick", "Bring It On Home"],
     "Made in studios across Britain and North America in gaps between tours during 1969.",
     [("led-zeppelin-ii-deluxe", "Deluxe Edition", 2014)]),
    ("led-zeppelin-iii", "Led Zeppelin III", "1970-10-05", ["studio"],
     ["Immigrant Song", "Friends", "Celebration Day", "Since I've Been Loving You", "Out on the Tiles", "Gallows Pole",
      "Tangerine", "That's the Way", "Bron-Y-Aur Stomp", "Hats Off to (Roy) Harper"],
     "Much of it written at Bron-Yr-Aur, a cottage in Wales, and heavier on acoustic guitars than the first two.",
     [("led-zeppelin-iii-deluxe", "Deluxe Edition", 2014)]),
    ("led-zeppelin-iv", "Led Zeppelin IV", "1971-11-08", ["studio"],
     ["Black Dog", "Rock and Roll", "The Battle of Evermore", "Stairway to Heaven", "Misty Mountain Hop", "Four Sticks",
      "Going to California", "When the Levee Breaks"],
     "Released with no title and no band name on the sleeve, only four symbols, one for each member.",
     [("led-zeppelin-iv-deluxe", "Deluxe Edition", 2014)]),
    ("houses-of-the-holy", "Houses of the Holy", "1973-03-28", ["studio"],
     ["The Song Remains the Same", "The Rain Song", "Over the Hills and Far Away", "The Crunge", "Dancing Days",
      "D'yer Mak'er", "No Quarter", "The Ocean"],
     "The first album with a title. The title song itself was left off and turned up on Physical Graffiti.",
     [("houses-of-the-holy-deluxe", "Deluxe Edition", 2014)]),
    ("physical-graffiti", "Physical Graffiti", "1975-02-24", ["studio"],
     ["Custard Pie", "The Rover", "In My Time of Dying", "Houses of the Holy", "Trampled Under Foot", "Kashmir",
      "In the Light", "Bron-Yr-Aur", "Down by the Seaside", "Ten Years Gone", "Night Flight", "The Wanton Song",
      "Boogie with Stu", "Black Country Woman", "Sick Again"],
     "A double album: eight new recordings plus seven earlier ones held back from previous records. The first release on Swan Song.",
     [("physical-graffiti-deluxe", "Deluxe Edition", 2015)]),
    ("presence", "Presence", "1976-03-31", ["studio"],
     ["Achilles Last Stand", "For Your Life", "Royal Orleans", "Nobody's Fault but Mine", "Candy Store Rock",
      "Hots On for Nowhere", "Tea for One"],
     "Recorded in under three weeks in Munich, with Robert Plant singing from a wheelchair after his 1975 car crash.",
     [("presence-deluxe", "Deluxe Edition", 2015)]),
    ("in-through-the-out-door", "In Through the Out Door", "1979-08-15", ["studio"],
     ["In the Evening", "South Bound Saurez", "Fool in the Rain", "Hot Dog", "Carouselambra", "All My Love",
      "I'm Gonna Crawl"],
     "Recorded at ABBA's Polar Studios in Stockholm, with John Paul Jones's keyboards to the fore. The last album made while John Bonham was alive.",
     [("in-through-the-out-door-deluxe", "Deluxe Edition", 2015)]),
    ("coda", "Coda", "1982-11-19", ["studio"],
     ["We're Gonna Groove", "Poor Tom", "I Can't Quit You Baby", "Walter's Walk", "Ozone Baby", "Darlene",
      "Bonzo's Montreux", "Wearing and Tearing"],
     "Unreleased recordings from 1970 to 1978, put out two years after the band split.",
     [("coda-deluxe", "Deluxe Edition", 2015)]),
    ("the-song-remains-the-same", "The Song Remains the Same", "1976-09-28", ["live", "film"], [],
     "Soundtrack to the concert film, recorded at Madison Square Garden in July 1973.",
     [("the-song-remains-the-same-film", "The film", 1976), ("the-song-remains-the-same-2018", "2018 remaster", 2018)]),
    ("bbc-sessions", "BBC Sessions", "1997-11-11", ["live"], [],
     "Radio sessions and concerts recorded for the BBC in 1969 and 1971.",
     [("the-complete-bbc-sessions", "The Complete BBC Sessions", 2016)]),
    ("how-the-west-was-won", "How the West Was Won", "2003-05-27", ["live"], [],
     "Two California shows from June 1972, at the LA Forum and Long Beach Arena.",
     [("how-the-west-was-won-2018", "2018 remaster", 2018)]),
    ("led-zeppelin-dvd", "Led Zeppelin (DVD)", "2003-05-26", ["film"], [],
     "Concert footage from 1970 to 1979, including the Royal Albert Hall, Madison Square Garden, Earls Court and Knebworth.", []),
    ("mothership", "Mothership", "2007-11-12", ["comp"], [],
     "A two-disc collection of 24 tracks chosen by the band, from all eight studio albums released while they were together.", []),
    ("celebration-day", "Celebration Day", "2012-11-19", ["live", "film"], [],
     "The reunion show at London's O2 Arena on 10 December 2007, with Jason Bonham on drums.", []),
    ("live-ep", "Live E.P.", "2025-09-12", ["live"], [],
     "Performances from 1975 and 1979, released on audio for the first time.", []),
]

# Album track → setlist.fm song name, where the stage title differs.
LIVE_AS = {"Black Mountain Side": "White Summer/Black Mountain Side"}

CAT_NOTE = {"studio": "Studio", "live": "Live", "comp": "Compilation", "film": "Film"}

albums = []
for s, t, d, c, tracks, note, eds in ALBUMS:
    q = urllib.parse.quote(f"Led Zeppelin {t.replace(' (DVD)', '')}")
    albums.append({
        "s": s, "t": t, "d": d, "y": int(d[:4]), "c": c, "note": note,
        "tr": [{"n": n, "s": slug(LIVE_AS.get(n, n))} for n in tracks],
        "ed": [{"s": es, "t": et, "y": ey} for es, et, ey in eds],
        "ss": f"https://open.spotify.com/search/{q}",
    })
(root / "albums.json").write_text(json.dumps(albums, ensure_ascii=False, indent=1))
print(len(albums), "albums")
