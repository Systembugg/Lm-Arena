import { catalogSearch } from "./catalog.js";
import { isId, normalize } from "./util.js";

const PIPED = [
  "https://pipedapi.kavin.rocks",
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.reallyaweso.me",
  "https://api.piped.yt",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.owo.si",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.darkness.services",
  "https://pipedapi.ducks.party",
];

const INV = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.tiekoetter.com",
  "https://yt.chocolatemoo53.com",
  "https://invidious.f5.si",
];

let health = { ytdlp: false, checked: false, version: "" };
const streamCache = new Map();
// The house line only exists when this page is served from its own root.
// A static host (jsDelivr, GitHack) has no /api, and a leading-slash fetch
// would hit that host's root instead of quietly falling through.
const house = location.pathname === "/" || location.pathname === "/index.html";

export function line() {
  return health;
}

export async function checkHealth() {
  if (!house) {
    health = { ytdlp: false, checked: true, version: "" };
    return health;
  }
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(1600) });
    const data = await res.json();
    health = { ytdlp: Boolean(data.ytdlp), checked: true, version: data.version || "" };
  } catch {
    health = { ytdlp: false, checked: true, version: "" };
  }
  return health;
}

function itemsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.relatedStreams)) return data.relatedStreams;
  return [];
}

function fromAny(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type && !["stream", "video"].includes(item.type)) return null;
  let id = item.videoId || item.id;
  if (!isId(id)) {
    const url = item.url || "";
    id = (url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1];
  }
  if (!isId(id)) return null;
  const thumbs = item.videoThumbnails || [];
  const thumb = item.thumbnail || item.thumbnailUrl || thumbs.find((t) => t.quality === "medium")?.url || thumbs[0]?.url;
  return normalize({
    id,
    title: item.title,
    artist: item.uploaderName || item.uploader || item.author || item.channel,
    duration: item.duration ?? item.lengthSeconds,
    thumb,
  });
}

async function raceJSON(urls, ms = 4800) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const winner = await Promise.any(
      urls.map(async (url) => {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        return { url, data };
      })
    );
    return winner;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rememberHost(url, key) {
  try {
    const origin = new URL(url).origin;
    sessionStorage.setItem(key, origin);
  } catch {
    /* ignore */
  }
}

function ordered(list, key) {
  let saved = "";
  try {
    saved = sessionStorage.getItem(key) || "";
  } catch {
    saved = "";
  }
  if (!saved) return list;
  return [saved, ...list.filter((x) => x !== saved)];
}

export async function search(q, limit = 16) {
  q = String(q || "").trim();
  if (!q) return [];
  if (health.ytdlp) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = await res.json();
        const tracks = (data.tracks || []).map(normalize).filter(Boolean);
        if (tracks.length) return tracks.slice(0, limit);
      }
    } catch {
      /* fall through */
    }
  }
  const pipedBases = ordered(PIPED, "rt-piped");
  const piped = await raceJSON(
    pipedBases.map((b) => `${b}/search?q=${encodeURIComponent(q)}&filter=music_songs`),
    5200
  );
  if (piped) {
    rememberHost(piped.url, "rt-piped");
    const tracks = itemsOf(piped.data).map(fromAny).filter(Boolean);
    if (tracks.length) return dedupe(tracks).slice(0, limit);
  }
  const invBases = ordered(INV, "rt-inv");
  const inv = await raceJSON(
    invBases.map((b) => `${b}/api/v1/search?q=${encodeURIComponent(q)}&type=video`),
    5200
  );
  if (inv) {
    rememberHost(inv.url, "rt-inv");
    const tracks = itemsOf(inv.data).map(fromAny).filter(Boolean);
    if (tracks.length) return dedupe(tracks).slice(0, limit);
  }
  return catalogSearch(q).slice(0, limit);
}

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
}

function pickAudio(streams) {
  const list = (streams || []).filter((s) => s?.url && /audio|m4a|mp4|webm/i.test(`${s.mimeType || ""} ${s.format || ""}`));
  const m4a = list.filter((s) => /mp4|m4a/i.test(`${s.mimeType || ""} ${s.format || ""}`));
  const pool = (m4a.length ? m4a : list).slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const modest = pool.find((s) => (s.bitrate || 0) <= 160000 && (s.bitrate || 0) >= 64000);
  return (modest || pool[0])?.url || null;
}

export async function streamsFor(id) {
  if (!isId(id)) return null;
  if (streamCache.has(id)) return streamCache.get(id);
  const bases = ordered(PIPED, "rt-piped");
  const hit = await raceJSON(bases.map((b) => `${b}/streams/${id}`), 5600);
  if (!hit) return null;
  rememberHost(hit.url, "rt-piped");
  const data = hit.data || {};
  const rec = {
    url: pickAudio(data.audioStreams),
    related: itemsOf(data.relatedStreams).map(fromAny).filter((t) => t && t.id !== id).slice(0, 12),
    duration: Number(data.duration) || null,
    title: data.title || "",
    artist: data.uploader || "",
    thumb: data.thumbnailUrl || "",
  };
  if (rec.url || rec.related.length) streamCache.set(id, rec);
  return rec;
}

export async function resolveAudio(id) {
  if (!isId(id)) return null;
  if (health.ytdlp) return { url: `/api/stream/${id}`, kind: "house", fallbacks: [] };
  const info = await streamsFor(id);
  const fallbacks = ordered(INV, "rt-inv").slice(0, 2).map((b) => `${b}/latest_version?id=${id}&itag=140`);
  if (info?.url) return { url: info.url, kind: "direct", fallbacks };
  return { url: fallbacks[0], kind: "direct", fallbacks: fallbacks.slice(1) };
}

export async function lookup(id) {
  if (!isId(id)) return null;
  const info = await streamsFor(id);
  if (info?.title) {
    return normalize({ id, title: info.title, artist: info.artist, duration: info.duration, thumb: info.thumb });
  }
  const found = await search(id, 5);
  return found.find((t) => t.id === id) || null;
}

export async function related(track) {
  if (!track?.id) return [];
  const info = await streamsFor(track.id);
  if (info?.related?.length) return info.related;
  const found = await search(`${track.artist} ${track.title}`.slice(0, 80), 8);
  return found.filter((t) => t.id !== track.id);
}

export async function importPlaylist(raw) {
  if (health.ytdlp) {
    try {
      const res = await fetch(`/api/import?url=${encodeURIComponent(raw)}`, { signal: AbortSignal.timeout(40000) });
      if (res.ok) {
        const data = await res.json();
        return {
          title: data.title || "Imported shelf",
          tracks: (data.tracks || []).map(normalize).filter(Boolean),
        };
      }
    } catch {
      /* browser path */
    }
  }
  const id = (String(raw).match(/[?&]list=([A-Za-z0-9_-]+)/) || [])[1] || raw;
  const bases = ordered(PIPED, "rt-piped");
  const hit = await raceJSON(bases.map((b) => `${b}/playlists/${encodeURIComponent(id)}`), 7000);
  if (hit) {
    rememberHost(hit.url, "rt-piped");
    const tracks = itemsOf(hit.data?.relatedStreams || hit.data).map(fromAny).filter(Boolean);
    if (tracks.length) return { title: hit.data?.name || "Imported shelf", tracks };
  }
  const inv = await raceJSON(
    ordered(INV, "rt-inv").map((b) => `${b}/api/v1/playlists/${encodeURIComponent(id)}`),
    7000
  );
  if (inv) {
    const videos = inv.data?.videos || itemsOf(inv.data);
    const tracks = videos.map(fromAny).filter(Boolean);
    if (tracks.length) return { title: inv.data?.title || "Imported shelf", tracks };
  }
  return null;
}

export function suggest(q) {
  q = String(q || "").trim();
  if (q.length < 2) return Promise.resolve([]);
  return new Promise((resolve) => {
    const cb = "rtSug" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const timer = setTimeout(() => done([]), 2200);
    function done(list) {
      clearTimeout(timer);
      try { delete window[cb]; } catch { /* ignore */ }
      s.remove();
      resolve(list);
    }
    window[cb] = (data) => {
      const rows = Array.isArray(data?.[1]) ? data[1].map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean) : [];
      done(rows.slice(0, 6));
    };
    s.onerror = () => done([]);
    s.src = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}&callback=${cb}`;
    document.head.appendChild(s);
  });
}
