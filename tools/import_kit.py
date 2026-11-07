#!/usr/bin/env python3
"""kit/ (Richard's supplied assets) → site/covers, site/img, site/assets. Re-run after adding files to kit/.

Covers: square 400 px webp, named by album slug (see COVERS; slugs match tools/catalogue.py).
Photos: 1200 px and 480 px (-s) webp, named as in site/data/gallery.json.
"""
from pathlib import Path
from PIL import Image

R = Path(__file__).resolve().parent.parent
K, S = R / "kit", R / "site"
COVERS = {
    "led-zeppelin": "lz1", "led-zeppelin-ii": "lz2", "led-zeppelin-iii": "lz3", "led-zeppelin-iv": "lz4",
    "houses-of-the-holy": "hoth", "physical-graffiti": "pg", "presence": "pres", "in-through-the-out-door": "ittod",
    "coda": "coda", "the-song-remains-the-same": "tsrts", "bbc-sessions": "Led_Zeppelin_BBC_Sessions",
    "how-the-west-was-won": "htwww", "celebration-day": "cd", "live-ep": "2025_LIVE_EP", "mothership": "ms",
    "led-zeppelin-dvd": "dvd", "led-zeppelin-deluxe": "lz1_deluxe", "led-zeppelin-ii-deluxe": "lz2_deluxe",
    "led-zeppelin-iii-deluxe": "lz3_deluxe", "led-zeppelin-iv-deluxe": "lz1v_deluxe",
    "houses-of-the-holy-deluxe": "hoth_deluxe", "physical-graffiti-deluxe": "pg_deluxe",
    "presence-deluxe": "presence_deluxe", "in-through-the-out-door-deluxe": "ittod_deluxe", "coda-deluxe": "coda_deluxe",
    "the-song-remains-the-same-2018": "tsrts_2018", "the-song-remains-the-same-film": "tsrts-film",
    "the-complete-bbc-sessions": "bbc_complete", "how-the-west-was-won-2018": "htwww_deluxe",
}
PHOTOS = {
    "1969-paris-poster": "archive/1969-12-06---paris---piston70---poster_c3qtgng8", "1969-jones-promo": "archive/1969-jpj-promo",
    "1971-san-antonio": "archive/1971-sananton_3_zchs9jiy", "1975-dallas": "archive/1975-03-04-dallas_cd_1911f_d0ptyuxu",
    "1977-jones": "archive/1977-jpj-s9_bjlhz6vi", "1969-kitchener": "archive/69-913_0061_vqtcg10k",
    "1973-los-angeles": "archive/73.5.31.pk1_pyyl0ln7", "1980-bonham": "archive/80-bonham-013_hwhl3wz6",
    "hall-of-fame-exhibit": "archive/r-r-hall-of-fame-exhibit", "bonham-drums": "photos/3555264805",
    "jones-bass": "photos/3774658001", "plant-page-acoustic": "photos/4406363128", "plant-live": "photos/465006384",
}
for s, f in COVERS.items():
    im = Image.open(K / "releases" / f"{f}.jpg").convert("RGB")
    w, h = im.size; m = min(w, h)
    im = im.crop(((w - m) // 2, (h - m) // 2, (w - m) // 2 + m, (h - m) // 2 + m))
    im.resize((400, 400), Image.LANCZOS).save(S / "covers" / f"{s}.webp", quality=80, method=6)
for s, f in PHOTOS.items():
    im = Image.open(K / f"{f}.jpg").convert("RGB")
    for px, suf in ((1200, ""), (480, "-s")):
        c = im.copy(); c.thumbnail((px, px), Image.LANCZOS); c.save(S / "img" / f"{s}{suf}.webp", quality=78, method=6)
lg = Image.open(K / "marks/LZ_logo_silver-1000x302.png"); lg.thumbnail((640, 640)); lg.save(S / "assets/lz-logo.png", optimize=True)
sym = Image.open(K / "marks/zep_symbols.png").convert("LA")
for (a, b), n in zip([(22, 269), (288, 442), (470, 659), (689, 850)], ["page", "jones", "bonham", "plant"]):
    c = sym.crop((a, 0, b, sym.height)); c = c.crop(c.getchannel("A").getbbox())
    out = Image.new("RGBA", c.size, (0, 0, 0, 0)); out.putalpha(c.getchannel("A")); out.save(S / f"assets/sym-{n}.png", optimize=True)
print(len(COVERS), "covers,", len(PHOTOS), "photos")
