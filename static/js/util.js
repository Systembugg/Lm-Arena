export function isId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function fmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function uid(prefix = "id_") {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function thumb(id) {
  return isId(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

export function normalize(raw) {
  if (!raw || !isId(raw.id)) return null;
  let title = String(raw.title || "Untitled").replace(/\s+/g, " ").trim();
  let artist = String(raw.artist || raw.uploaderName || raw.author || "Unknown").replace(/\s+/g, " ").trim();
  artist = artist.replace(/\s*-\s*topic$/i, "").trim() || "Unknown";
  title = title.replace(/\s*[([【][^)\]】]{0,40}?(official|lyric|audio only|visualizer|remaster(?:ed)?(?:\s*\d{4})?|hd|4k|mv)[^)\]】]{0,20}[)\]】]/gi, " ");
  title = title.replace(/\s*(official\s*)?(music\s*)?(video|audio)\s*$/i, " ");
  title = title.replace(/[「」『』]/g, " ").replace(/\s+/g, " ").trim();
  title = title.replace(/\s*[-–—|]\s*$/g, "").trim();
  const split = title.match(/^(.{2,42}?)\s[-–—]\s(.+)$/);
  if (split) {
    const left = split[1].trim();
    const right = split[2].trim();
    const al = artist.toLowerCase();
    if (al === "unknown" || al.includes("topic") || left.toLowerCase() === al) {
      artist = left;
      title = right;
    }
  }
  if (artist !== "Unknown" && title.toLowerCase().startsWith(artist.toLowerCase())) {
    const rest = title.slice(artist.length).replace(/^[\s\-–—:]+/, "").trim();
    if (rest.length > 1) title = rest;
  }
  title = title.replace(/\s{2,}/g, " ").trim() || raw.title || "Untitled";
  const duration = Number(raw.duration ?? raw.lengthSeconds);
  return {
    id: raw.id,
    title,
    artist,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    thumb: raw.thumb || raw.thumbnail || thumb(raw.id),
  };
}

export function parseTarget(q) {
  const text = String(q || "").trim();
  const vid = text.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (vid) return { type: "video", id: vid[1] };
  if (isId(text)) return { type: "video", id: text };
  const list = text.match(/[?&]list=([A-Za-z0-9_-]{12,64})/);
  if (list) return { type: "playlist", id: list[1], raw: text };
  if (/^PL[A-Za-z0-9_-]{10,}$/.test(text)) return { type: "playlist", id: text, raw: text };
  return { type: "text", q: text };
}

export function dayKey(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function greet() {
  const h = new Date().getHours();
  if (h < 5) return "The late hour";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 21) return "Evening";
  return "Night";
}

export function clock() {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
