// Led Zeppelin Worker: serves ./site and proxies setlist.fm with a KV cache.
// Secrets (Worker settings, never in the repo): SETLISTFM_KEY, ANTHROPIC_API_KEY.
// KV: LZ_CACHE.

const MBID = "678d88b2-87b0-403b-b63d-5da7465aecc3"; // Led Zeppelin on MusicBrainz / setlist.fm
// Wikipedia articles the album builder may read (tools/build_albums.py). Allow-listed so this is not an open proxy.
import WIKI_TITLES from "./tools/wiki_titles.json";
const WIKI_OK = new Set(Object.values(WIKI_TITLES).filter(Boolean));
// Discogs master + main release per album. Data is fetched by Richard's Mac (tools/discogs-mac/), because
// Discogs throttles Cloudflare's shared egress IPs, and pushed to /api/discogs-ingest.
import DISCOGS_IDS from "./tools/discogs_ids.json";
const DG_TTL = 19800; // 5.5 hours: Discogs API Terms forbid showing data more than 6 hours old
const SFM = "https://api.setlist.fm/rest/1.0";
const UA = "ledzeppelin-fansite/1.0 (+https://github.com/richardmcallister-personal/ledzeppelin)";

const json = (data, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

// One setlist.fm GET, cached in KV for `ttl` seconds. Returns parsed JSON or throws {status}.
async function sfm(env, path, ttl) {
  const key = "sfm:v1:" + path;
  if (env.LZ_CACHE) {
    const hit = await env.LZ_CACHE.get(key, "json");
    if (hit) return hit;
  }
  if (!env.SETLISTFM_KEY) throw { status: 503, msg: "SETLISTFM_KEY not set" };
  const r = await fetch(SFM + path, {
    headers: { "x-api-key": env.SETLISTFM_KEY, accept: "application/json", "accept-language": "en", "user-agent": UA },
  });
  if (r.status === 404) {
    const empty = { setlist: [], total: 0, page: 0, itemsPerPage: 20 };
    return empty;
  }
  if (!r.ok) throw { status: r.status, msg: "setlist.fm " + r.status };
  const data = await r.json();
  if (env.LZ_CACHE) await env.LZ_CACHE.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, ttl) });
  return data;
}

// Compact form of a setlist.fm setlist: what the pages need, nothing more.
function slim(s) {
  const [dd, mm, yyyy] = (s.eventDate || "").split("-");
  const v = s.venue || {};
  const city = v.city || {};
  const sets = ((s.sets || {}).set || []).map((set) => ({
    e: set.encore || 0,
    n: set.name || "",
    s: (set.song || [])
      .filter((x) => x.name && !x.tape)
      .map((x) => {
        const o = { n: x.name };
        if (x.cover && x.cover.name) o.c = x.cover.name;
        if (x.info) o.i = x.info;
        if (x.with && x.with.name) o.w = x.with.name;
        return o;
      }),
  }));
  return {
    id: s.id,
    d: `${yyyy}-${mm}-${dd}`,
    v: v.name || "",
    c: city.name || "",
    st: city.stateCode || "",
    cc: (city.country || {}).code || "",
    cn: (city.country || {}).name || "",
    t: (s.tour || {}).name || "",
    u: s.url || "",
    ll: city.coords && city.coords.lat ? [+city.coords.lat.toFixed(3), +city.coords.long.toFixed(3)] : undefined,
    sets,
  };
}

async function health(env) {
  const out = { setlistfm: { ok: false }, anthropic: { ok: false }, kv: !!env.LZ_CACHE };
  if (!env.SETLISTFM_KEY) out.setlistfm.error = "secret SETLISTFM_KEY not set";
  else {
    try {
      const r = await fetch(`${SFM}/artist/${MBID}`, {
        headers: { "x-api-key": env.SETLISTFM_KEY, accept: "application/json", "user-agent": UA },
      });
      out.setlistfm.status = r.status;
      out.setlistfm.ok = r.ok;
      if (r.ok) out.setlistfm.artist = (await r.json()).name;
    } catch (e) {
      out.setlistfm.error = String(e);
    }
  }
  if (!env.ANTHROPIC_API_KEY) out.anthropic.error = "secret ANTHROPIC_API_KEY not set";
  else {
    try {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      });
      out.anthropic.status = r.status;
      out.anthropic.ok = r.ok;
    } catch (e) {
      out.anthropic.error = String(e);
    }
  }
  out.spotify = { ok: false };
  try {
    await spotifyToken(env);
    out.spotify.ok = true;
  } catch (e) {
    out.spotify.error = e.msg || String(e);
  }
  out.discogs = { token: !!discogsAuth(env), secrets: Object.keys(env).filter((k) => /discogs/i.test(k)) };
  if (env.LZ_CACHE) {
    const last = await env.LZ_CACHE.get("dg:last", "json");
    out.discogs.lastPush = last ? new Date(last.at).toISOString() : null;
    out.discogs.fresh = !!(last && Date.now() - last.at < DG_TTL * 1000);
    if (last) out.discogs.items = last.n;
  }
  return json(out);
}

// Discogs (secret DISCOGS_TOKEN = personal access token; or DISCOGS_KEY + DISCOGS_SECRET).
// API Terms: content shown must be < 6 hours old, so everything is fetched live and cached for 5 hours at most;
// images are Restricted Data (display only, non-commercial). Pages show "Data provided by Discogs" with a link.
function discogsAuth(env) {
  const tok = env.DISCOGS_TOKEN || env.DISCOGS_USER_TOKEN || env.DISCOGS_PERSONAL_TOKEN;
  if (tok) return "Discogs token=" + tok;
  if (env.DISCOGS_KEY && env.DISCOGS_SECRET) return `Discogs key=${env.DISCOGS_KEY}, secret=${env.DISCOGS_SECRET}`;
  return "";
}
async function discogs(env, path, ttl = 18000) {
  const auth = discogsAuth(env);
  if (!auth) throw { status: 503, msg: "Discogs not configured" };
  const key = "discogs:v1:" + path;
  if (ttl && env.LZ_CACHE) {
    const hit = await env.LZ_CACHE.get(key, "json");
    if (hit) return hit;
  }
  const r = await fetch("https://api.discogs.com" + path, { headers: { authorization: auth, "user-agent": "LedZeppelinApp/1.1 +https://ledzeppelin.app", accept: "application/vnd.discogs.v2.discogs+json" } });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 160).replace(/\s+/g, " ");
    throw { status: r.status === 404 ? 404 : 502, msg: `Discogs ${r.status}: ${body} [ratelimit-remaining ${r.headers.get("x-discogs-ratelimit-remaining")}, server ${r.headers.get("server")}]` };
  }
  const d = await r.json();
  if (ttl && env.LZ_CACHE) await env.LZ_CACHE.put(key, JSON.stringify(d), { expirationTtl: ttl });
  return d;
}
// One album, assembled from what the Mac pushed (KV, expires after DG_TTL). {stale:true} when nothing is fresh.
async function discogsAlbum(env, master) {
  const ids = Object.values(DISCOGS_IDS).find((x) => String(x.m) === String(master));
  if (!ids || !env.LZ_CACHE) return { stale: true };
  const [m, rel, ver] = await Promise.all([
    env.LZ_CACHE.get("dg:master:" + ids.m, "json"),
    env.LZ_CACHE.get("dg:release:" + ids.r, "json"),
    env.LZ_CACHE.get("dg:versions:" + ids.m, "json"),
  ]);
  if (!m && !rel) return { stale: true };
  return { master: m, release: rel, versions: ver && ver.n, fetched: Math.min(...[m, rel].filter(Boolean).map((x) => x.at)) };
}
// Trim what the Mac sends to the fields the album pages use.
function dgTrim(kind, d) {
  const img = (x) => ({ type: x.type, uri: x.uri, uri150: x.uri150, w: x.width, h: x.height });
  const name = (n) => (n || "").replace(/ \(\d+\)$/, "").replace(/\*$/, "");
  const at = Date.now();
  if (kind === "master") return { at, id: d.id, url: d.uri, title: d.title, year: d.year, images: (d.images || []).slice(0, 30).map(img) };
  if (kind === "versions") return { at, n: d.pagination ? d.pagination.items : null };
  return {
    at, id: d.id, url: d.uri, country: d.country, released: d.released_formatted || d.released,
    images: (d.images || []).slice(0, 30).map(img),
    labels: (d.labels || []).map((l) => ({ name: name(l.name), catno: l.catno })),
    formats: (d.formats || []).map((f) => [f.qty > 1 ? f.qty + "×" : "", f.name, ...(f.descriptions || [])].filter(Boolean).join(" ")),
    credits: (d.extraartists || []).slice(0, 80).map((a) => ({ name: name(a.anv || a.name), role: a.role, tracks: a.tracks || "" })),
    companies: (d.companies || []).slice(0, 30).map((c) => ({ name: name(c.name), role: c.entity_type_name })),
    have: d.community && d.community.have, want: d.community && d.community.want,
  };
}

// Spotify: app token via client credentials (secrets SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET), cached in KV.
async function spotifyToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) throw { status: 503, msg: "Spotify not configured" };
  const cached = env.LZ_CACHE && (await env.LZ_CACHE.get("spotify:token"));
  if (cached) return cached;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET) },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw { status: 502, msg: "Spotify token " + r.status };
  const t = await r.json();
  if (env.LZ_CACHE) await env.LZ_CACHE.put("spotify:token", t.access_token, { expirationTtl: Math.max(60, (t.expires_in || 3600) - 120) });
  return t.access_token;
}

// Best Led Zeppelin recording of a song title on Spotify. Cached 30 days (misses 7 days).
async function spotifyTrack(env, title) {
  const clean = title.replace(/\s*\(.*?\)\s*/g, " ").trim() || title;
  const key = "spotify:track:v1:" + clean.toLowerCase();
  if (env.LZ_CACHE) {
    const hit = await env.LZ_CACHE.get(key, "json");
    if (hit) return hit;
  }
  const token = await spotifyToken(env);
  const q = encodeURIComponent(`track:"${clean}" artist:"Led Zeppelin"`);
  const r = await fetch(`https://api.spotify.com/v1/search?type=track&limit=10&q=${q}`, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw { status: 502, msg: "Spotify search " + r.status };
  const items = ((await r.json()).tracks || {}).items || [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lz = items.filter((t) => (t.artists || []).some((a) => a.name === "Led Zeppelin"));
  // Prefer an exact title match on a studio album, then any exact match, then the first Led Zeppelin track.
  const exact = lz.filter((t) => norm(t.name.replace(/\s*-\s.*$/, "")) === norm(clean));
  const pick = exact.find((t) => t.album && t.album.album_type === "album") || exact[0] || lz[0] || null;
  const out = pick ? { id: pick.id, name: pick.name, album: pick.album && pick.album.name } : { id: null };
  if (env.LZ_CACHE) await env.LZ_CACHE.put(key, JSON.stringify(out), { expirationTtl: pick ? 86400 * 30 : 86400 * 7 });
  return out;
}

// A Led Zeppelin album on Spotify by title (builder use; results stored in data/spotify-albums.json).
async function spotifyAlbums(env, title) {
  const token = await spotifyToken(env);
  const q = encodeURIComponent(`album:"${title}" artist:"Led Zeppelin"`);
  const r = await fetch(`https://api.spotify.com/v1/search?type=album&limit=10&q=${q}`, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw { status: 502, msg: "Spotify search " + r.status };
  return (((await r.json()).albums || {}).items || [])
    .filter((a) => (a.artists || []).some((x) => x.name === "Led Zeppelin"))
    .map((a) => ({ id: a.id, name: a.name, type: a.album_type, date: a.release_date, tracks: a.total_tracks }));
}

async function api(url, env) {
  const p = url.pathname;
  try {
    if (p === "/api/spotify") {
      const q = (url.searchParams.get("q") || "").slice(0, 120);
      if (!q) return json({ error: "q required" }, 400);
      // Always 200: pages simply show no player when there is no match or Spotify isn't configured.
      try {
        const t = await spotifyTrack(env, q);
        return json(t, 200, t.id ? 86400 : 3600);
      } catch (e) {
        return json({ id: null, error: e.msg || String(e) }, 200);
      }
    }
    if (p === "/api/spotify-albums") {
      const q = (url.searchParams.get("q") || "").slice(0, 120);
      if (!q) return json({ error: "q required" }, 400);
      return json(await spotifyAlbums(env, q), 200, 3600);
    }
    // Discogs: the Mac's to-do list (plain text: slug master release).
    if (p === "/api/discogs-plan") {
      const body = Object.entries(DISCOGS_IDS).map(([k, v]) => `${k} ${v.m} ${v.r}`).join("\n") + "\n";
      return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    if (p === "/api/discogs") {
      const ids = DISCOGS_IDS[(url.searchParams.get("a") || "").replace(/[^a-z0-9-]/g, "")];
      if (!ids) return json({ stale: true }, 200);
      return json(await discogsAlbum(env, ids.m), 200, 300);
    }
    // Newest shows (page 1), slimmed. Used by the home and concerts pages.
    if (p === "/api/latest") {
      const d = await sfm(env, `/artist/${MBID}/setlists?p=1`, 1800);
      return json({ total: d.total, shows: (d.setlist || []).map(slim) }, 200, 600);
    }
    // Wikipedia wikitext for an allow-listed album article (builder use only). Cached 7 days.
    if (p === "/api/wiki") {
      const t = url.searchParams.get("t") || "";
      if (!WIKI_OK.has(t)) return json({ error: "title not allowed" }, 403);
      const key = "wiki:v1:" + t;
      if (env.LZ_CACHE) {
        const hit = await env.LZ_CACHE.get(key, "json");
        if (hit) return json(hit, 200, 3600);
      }
      const api = `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext|revid&page=${encodeURIComponent(t)}`;
      const r = await fetch(api, { headers: { "user-agent": UA + " album-builder", "api-user-agent": UA } });
      if (!r.ok) return json({ error: "wikipedia " + r.status }, 502);
      const d = await r.json();
      if (!d.parse) return json({ error: (d.error && d.error.info) || "not found" }, 404);
      const out = { title: d.parse.title, revid: d.parse.revid, wikitext: d.parse.wikitext };
      if (env.LZ_CACHE) await env.LZ_CACHE.put(key, JSON.stringify(out), { expirationTtl: 86400 * 7 });
      return json(out, 200, 3600);
    }
    // One page of the full history, slimmed. Used by tools/build_setlists.py.
    if (p === "/api/setlists") {
      const page = Math.max(1, Math.min(500, parseInt(url.searchParams.get("p") || "1", 10) || 1));
      const d = await sfm(env, `/artist/${MBID}/setlists?p=${page}`, page === 1 ? 1800 : 86400 * 3);
      return json({ total: d.total, page: d.page, per: d.itemsPerPage, shows: (d.setlist || []).map(slim) }, 200, 600);
    }
    // One show by setlist.fm id.
    if (p === "/api/setlist") {
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9]/gi, "");
      if (!id) return json({ error: "id required" }, 400);
      const d = await sfm(env, `/setlist/${id}`, 86400 * 7);
      if (!d.id) return json({ error: "not found" }, 404);
      return json(slim(d), 200, 3600);
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: e.msg || String(e) }, e.status || 500);
  }
}

// POST /api/discogs-ingest?kind=master|release|versions&id=N — body is the raw Discogs JSON.
// Authorised by sending the same Discogs token the Worker holds (header x-ingest-token).
async function discogsIngest(request, url, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const tok = env.DISCOGS_TOKEN || env.DISCOGS_USER_TOKEN || env.DISCOGS_PERSONAL_TOKEN || "";
  const got = request.headers.get("x-ingest-token") || "";
  const a = new TextEncoder().encode(tok), b = new TextEncoder().encode(got);
  let same = tok.length > 0 && a.length === b.length;
  for (let i = 0; i < a.length && same; i++) same = a[i] === b[i];
  if (!same) return json({ error: "not authorised" }, 401);
  const kind = url.searchParams.get("kind");
  const id = (url.searchParams.get("id") || "").replace(/\D/g, "");
  if (!["master", "release", "versions"].includes(kind) || !id) return json({ error: "bad kind or id" }, 400);
  const known = Object.values(DISCOGS_IDS).some((x) => String(kind === "release" ? x.r : x.m) === id);
  if (!known) return json({ error: "id not in the album list" }, 400);
  const text = await request.text();
  if (text.length > 3_000_000) return json({ error: "too large" }, 413);
  let d;
  try { d = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
  await env.LZ_CACHE.put(`dg:${kind}:${id}`, JSON.stringify(dgTrim(kind, d)), { expirationTtl: DG_TTL });
  const last = (await env.LZ_CACHE.get("dg:last", "json")) || { n: 0 };
  await env.LZ_CACHE.put("dg:last", JSON.stringify({ at: Date.now(), n: (Date.now() - (last.at || 0) < 3600e3 ? last.n : 0) + 1 }), { expirationTtl: 86400 * 30 });
  return json({ ok: true, kind, id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api/discogs-ingest") return discogsIngest(request, url, env);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health") return health(env);
    if (url.pathname.startsWith("/api/")) return api(url, env);
    return env.ASSETS.fetch(request);
  },
};
