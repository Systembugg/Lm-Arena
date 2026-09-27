import { uid } from "./util.js";

const KEY = "roomtone.v1";

const state = {
  liked: [],
  playlists: [],
  history: [],
  recents: [],
  volume: 0.86,
  repeat: "off",
  shuffle: false,
  queue: [],
  index: 0,
  progress: 0,
};

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — the room still plays */
  }
}

function cleanTrack(t) {
  if (!t || typeof t.id !== "string") return null;
  return {
    id: t.id,
    title: String(t.title || "Untitled").slice(0, 180),
    artist: String(t.artist || "Unknown").slice(0, 120),
    duration: Number(t.duration) || null,
    thumb: String(t.thumb || ""),
  };
}

export const store = {
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!raw || typeof raw !== "object") return;
      state.liked = (raw.liked || []).map(cleanTrack).filter(Boolean).slice(0, 400);
      state.playlists = (raw.playlists || [])
        .map((p) => ({
          id: String(p.id || uid("pl_")),
          name: String(p.name || "Untitled shelf").slice(0, 60),
          tracks: (p.tracks || []).map(cleanTrack).filter(Boolean).slice(0, 400),
          created: Number(p.created) || Date.now(),
        }))
        .slice(0, 40);
      state.history = (raw.history || []).map((h) => ({ ...cleanTrack(h), at: Number(h.at) || Date.now() })).filter((h) => h.id).slice(0, 180);
      state.recents = (raw.recents || []).map((q) => String(q).slice(0, 80)).filter(Boolean).slice(0, 8);
      state.volume = Math.min(1, Math.max(0, Number(raw.volume ?? 0.86)));
      state.repeat = ["off", "all", "one"].includes(raw.repeat) ? raw.repeat : "off";
      state.shuffle = Boolean(raw.shuffle);
      state.queue = (raw.queue || []).map(cleanTrack).filter(Boolean).slice(0, 200);
      state.index = Math.max(0, Number(raw.index) || 0);
      state.progress = Math.max(0, Number(raw.progress) || 0);
    } catch {
      /* ignore corrupt shelf */
    }
  },
  get liked() {
    return state.liked;
  },
  get playlists() {
    return state.playlists;
  },
  get history() {
    return state.history;
  },
  get recents() {
    return state.recents;
  },
  get volume() {
    return state.volume;
  },
  get repeat() {
    return state.repeat;
  },
  get shuffle() {
    return state.shuffle;
  },
  get queue() {
    return state.queue;
  },
  get index() {
    return state.index;
  },
  get progress() {
    return state.progress;
  },
  isLiked(id) {
    return state.liked.some((t) => t.id === id);
  },
  toggleLike(track) {
    const t = cleanTrack(track);
    if (!t) return false;
    const i = state.liked.findIndex((x) => x.id === t.id);
    if (i >= 0) state.liked.splice(i, 1);
    else state.liked.unshift(t);
    persist();
    return i < 0;
  },
  createPlaylist(name) {
    const p = {
      id: uid("pl_"),
      name: String(name || "Untitled shelf").trim().slice(0, 60) || "Untitled shelf",
      tracks: [],
      created: Date.now(),
    };
    state.playlists.unshift(p);
    persist();
    return p;
  },
  renamePlaylist(id, name) {
    const p = state.playlists.find((x) => x.id === id);
    if (!p) return;
    p.name = String(name || p.name).trim().slice(0, 60) || p.name;
    persist();
  },
  deletePlaylist(id) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    persist();
  },
  playlist(id) {
    return state.playlists.find((p) => p.id === id) || null;
  },
  addToPlaylist(pid, track) {
    const p = state.playlists.find((x) => x.id === pid);
    const t = cleanTrack(track);
    if (!p || !t) return false;
    if (p.tracks.some((x) => x.id === t.id)) return false;
    p.tracks.push(t);
    persist();
    return true;
  },
  removeFromPlaylist(pid, tid) {
    const p = state.playlists.find((x) => x.id === pid);
    if (!p) return;
    p.tracks = p.tracks.filter((t) => t.id !== tid);
    persist();
  },
  pushHistory(track) {
    const t = cleanTrack(track);
    if (!t) return;
    if (state.history[0]?.id === t.id) {
      state.history[0].at = Date.now();
    } else {
      state.history.unshift({ ...t, at: Date.now() });
      state.history = state.history.slice(0, 180);
    }
    persist();
  },
  clearHistory() {
    state.history = [];
    persist();
  },
  pushRecent(q) {
    q = String(q || "").trim().slice(0, 80);
    if (q.length < 2) return;
    state.recents = [q, ...state.recents.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    persist();
  },
  saveSession(partial) {
    if (partial.queue) state.queue = partial.queue.map(cleanTrack).filter(Boolean).slice(0, 200);
    if (partial.index != null) state.index = partial.index;
    if (partial.progress != null) state.progress = partial.progress;
    if (partial.volume != null) state.volume = partial.volume;
    if (partial.repeat) state.repeat = partial.repeat;
    if (partial.shuffle != null) state.shuffle = partial.shuffle;
    persist();
  },
  exportJSON() {
    return JSON.stringify(
      { liked: state.liked, playlists: state.playlists, exported: new Date().toISOString() },
      null,
      2
    );
  },
  importJSON(text) {
    const data = JSON.parse(text);
    const liked = (data.liked || []).map(cleanTrack).filter(Boolean);
    const playlists = (data.playlists || [])
      .map((p) => ({
        id: uid("pl_"),
        name: String(p.name || "Imported shelf").slice(0, 60),
        tracks: (p.tracks || []).map(cleanTrack).filter(Boolean),
        created: Date.now(),
      }))
      .filter((p) => p.tracks.length || p.name);
    state.liked = [...liked, ...state.liked.filter((t) => !liked.some((n) => n.id === t.id))].slice(0, 400);
    state.playlists = [...playlists, ...state.playlists].slice(0, 40);
    persist();
    return { shelves: playlists.length, liked: liked.length };
  },
};
