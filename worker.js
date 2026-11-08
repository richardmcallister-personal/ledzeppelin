// Led Zeppelin Worker: serves ./site and proxies setlist.fm with a KV cache.
// Secrets (Worker settings, never in the repo): SETLISTFM_KEY, ANTHROPIC_API_KEY.
// KV: LZ_CACHE.

const MBID = "678d88b2-87b0-403b-b63d-5da7465aecc3"; // Led Zeppelin on MusicBrainz / setlist.fm
// Wikipedia articles the album builder may read (tools/build_albums.py). Allow-listed so this is not an open proxy.
import WIKI_TITLES from "./tools/wiki_titles.json";
const WIKI_OK = new Set(Object.values(WIKI_TITLES).filter(Boolean));
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
  out.discogs = { ok: false };
  try {
    const d = await discogs(env, "/database/search?q=Led+Zeppelin&type=master&per_page=1", 0);
    out.discogs.ok = !!(d && d.results);
    out.discogs.auth = discogsAuth(env) ? discogsAuth(env).split(" ")[1].split("=")[0] : "none";
  } catch (e) {
    out.discogs.error = e.msg || String(e);
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
// One album, from its Discogs master: images, the original release's labels, formats and credits, and the
// number of versions. Trimmed and cached 5 hours.
async function discogsAlbum(env, master) {
  const key = "discogs:album:v1:" + master;
  if (env.LZ_CACHE) {
    const hit = await env.LZ_CACHE.get(key, "json");
    if (hit) return hit;
  }
  const m = await discogs(env, `/masters/${master}`, 0);
  const [rel, vers] = await Promise.all([
    m.main_release ? discogs(env, `/releases/${m.main_release}`, 0) : null,
    discogs(env, `/masters/${master}/versions?per_page=1`, 0).catch(() => null),
  ]);
  const img = (x) => ({ type: x.type, uri: x.uri, uri150: x.uri150, w: x.width, h: x.height });
  const out = {
    master: { id: m.id, url: m.uri, title: m.title, year: m.year },
    versions: vers && vers.pagination ? vers.pagination.items : null,
    images: (rel && rel.images && rel.images.length ? rel.images : m.images || []).slice(0, 24).map(img),
    release: rel && {
      id: rel.id, url: rel.uri, country: rel.country, released: rel.released_formatted || rel.released,
      labels: (rel.labels || []).map((l) => ({ name: l.name, catno: l.catno })),
      formats: (rel.formats || []).map((f) => [f.qty > 1 ? f.qty + "×" : "", f.name, ...(f.descriptions || [])].filter(Boolean).join(" ")),
      credits: (rel.extraartists || []).map((a) => ({ name: a.anv || a.name.replace(/ \(\d+\)$/, ""), role: a.role, tracks: a.tracks || "" })),
      companies: (rel.companies || []).map((c) => ({ name: c.name.replace(/ \(\d+\)$/, ""), role: c.entity_type_name })),
      have: rel.community && rel.community.have, want: rel.community && rel.community.want,
    },
  };
  if (env.LZ_CACHE) await env.LZ_CACHE.put(key, JSON.stringify(out), { expirationTtl: 18000 });
  return out;
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
    // Discogs: search Led Zeppelin masters (builder use), and one album by master id (album pages).
    if (p === "/api/discogs-search") {
      const t = (url.searchParams.get("t") || "").slice(0, 120);
      if (!t) return json({ error: "t required" }, 400);
      const d = await discogs(env, `/database/search?type=master&artist=${encodeURIComponent("Led Zeppelin")}&release_title=${encodeURIComponent(t)}&per_page=10`, 3600);
      return json((d.results || []).map((r) => ({ id: r.id, title: r.title, year: r.year, format: r.format, uri: r.uri })), 200, 600);
    }
    if (p === "/api/discogs") {
      const m = (url.searchParams.get("m") || "").replace(/\D/g, "");
      if (!m) return json({ error: "m required" }, 400);
      return json(await discogsAlbum(env, m), 200, 3600);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health") return health(env);
    if (url.pathname.startsWith("/api/")) return api(url, env);
    return env.ASSETS.fetch(request);
  },
};
