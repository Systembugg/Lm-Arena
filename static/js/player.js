import { isId } from "./util.js";
import { resolveAudio, related } from "./api.js";
import { store } from "./store.js";

const listeners = new Map();
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

let ytPlayer = null;
let ytReady = null;
let audioCtx = null;
let analyser = null;
let sourceNode = null;

function emit(ev) {
  listeners.get(ev)?.forEach((fn) => fn());
  if (ev !== "change") listeners.get("change")?.forEach((fn) => fn());
}

export const player = {
  audio: null,
  track: null,
  queue: [],
  index: 0,
  playing: false,
  cueing: false,
  mode: null,
  source: null,
  radio: null,
  stay: false,
  repeat: "off",
  shuffle: false,
  volume: 0.86,
  needsTap: false,
  pending: null,
  gen: 0,
  noted: false,
  failStreak: 0,

  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
  },

  init(audio) {
    this.audio = audio;
    this.volume = store.volume;
    this.repeat = store.repeat;
    this.shuffle = store.shuffle;
    this.queue = store.queue.slice();
    this.index = Math.min(store.index, Math.max(0, this.queue.length - 1));
    this.track = this.queue[this.index] || null;
    audio.volume = this.volume;
    audio.addEventListener("ended", () => {
      if (this.mode === "audio") this.handleEnded();
    });
    audio.addEventListener("error", () => {
      if (this.mode === "audio" && this.playing && !this.cueing) this.failCurrent("That cut dropped.");
    });
    audio.addEventListener("playing", () => {
      if (this.mode === "audio") this.markPlaying();
    });
    this.persist();
  },

  persist() {
    store.saveSession({
      queue: this.queue,
      index: this.index,
      progress: this.getTime(),
      volume: this.volume,
      repeat: this.repeat,
      shuffle: this.shuffle,
    });
  },

  unlock() {
    const audio = this.audio;
    if (!audio || audio.dataset.unlocked === "1") return;
    audio.dataset.unlocked = "1";
    const prev = audio.src;
    if (!prev || prev.startsWith("data:")) audio.src = SILENCE;
    audio.play().then(() => {
      if (audio.src.startsWith("data:")) audio.pause();
    }).catch(() => {});
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !audioCtx) {
      try { audioCtx = new Ctx(); } catch { /* ignore */ }
    }
    audioCtx?.resume?.().catch(() => {});
  },

  attachAnalyser() {
    if (sourceNode || !audioCtx) return analyser;
    try {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode = audioCtx.createMediaElementSource(this.audio);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch {
      analyser = null;
    }
    return analyser;
  },

  getAnalyser() {
    return analyser;
  },

  playList(tracks, index = 0, opts = {}) {
    const list = (tracks || []).filter((t) => t && isId(t.id));
    if (!list.length) return;
    this.queue = list.slice();
    this.index = Math.max(0, Math.min(index, list.length - 1));
    this.radio = opts.radio || null;
    if (opts.radio) this.stay = true;
    this.persist();
    emit("change");
    return this.cue(this.queue[this.index]);
  },

  playIndex(i) {
    if (!this.queue[i]) return;
    this.index = i;
    this.persist();
    return this.cue(this.queue[i]);
  },

  append(tracks) {
    const have = new Set(this.queue.map((t) => t.id));
    const extra = (tracks || []).filter((t) => t && isId(t.id) && !have.has(t.id));
    if (!extra.length) return;
    this.queue = this.queue.concat(extra);
    this.persist();
    emit("change");
  },

  async cue(track) {
    if (!track || !isId(track.id)) return;
    const gen = ++this.gen;
    this.track = track;
    this.cueing = true;
    this.needsTap = false;
    this.noted = false;
    this.playing = false;
    this.pending = null;
    emit("change");
    this.stopOthers();

    if (this.stay && this.index >= this.queue.length - 1) {
      related(track).then((more) => {
        if (gen === this.gen) this.append(more);
      }).catch(() => {});
    }

    const resolved = await resolveAudio(track.id);
    if (gen !== this.gen) return;
    const urls = resolved ? [resolved.url, ...(resolved.fallbacks || [])].filter(Boolean) : [];
    for (const url of urls) {
      if (gen !== this.gen) return;
      const result = await this.tryAudio(url, gen);
      if (gen !== this.gen) return;
      if (result === "ok") {
        this.mode = "audio";
        this.source = url.startsWith("/") ? "house" : "direct";
        if (url.startsWith("/")) this.attachAnalyser();
        this.cueing = false;
        this.failStreak = 0;
        document.body.dataset.source = "audio";
        this.maybeResumeTime(track);
        emit("change");
        return;
      }
      if (result === "gesture") {
        this.pending = { type: "audio", url, track };
        this.needsTap = true;
        this.cueing = false;
        emit("change");
        return;
      }
    }
    if (gen !== this.gen) return;
    const yt = await this.tryYouTube(track.id, gen);
    if (gen !== this.gen) return;
    if (yt === "ok") {
      this.mode = "youtube";
      this.source = "picture";
      this.cueing = false;
      this.failStreak = 0;
      document.body.dataset.source = "youtube";
      this.markPlaying();
      return;
    }
    if (yt === "gesture") {
      this.pending = { type: "youtube", id: track.id, track };
      this.needsTap = true;
      this.cueing = false;
      emit("change");
      return;
    }
    this.cueing = false;
    this.failCurrent("Couldn't cue that cut.");
  },

  maybeResumeTime(track) {
    if (store.progress > 3 && this.queue[store.index]?.id === track.id) {
      const d = this.audio.duration;
      if (!d || store.progress < d - 4) {
        try { this.audio.currentTime = store.progress; } catch { /* not seekable yet */ }
      }
    }
  },

  tryAudio(url, gen) {
    const audio = this.audio;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      };
      const timer = setTimeout(() => finish("error"), 4500);
      const onErr = () => finish("error");
      function cleanup() {
        clearTimeout(timer);
        audio.removeEventListener("error", onErr);
      }
      audio.addEventListener("error", onErr);
      if (ytPlayer?.pauseVideo) {
        try { ytPlayer.pauseVideo(); } catch { /* ignore */ }
      }
      audio.src = url;
      audio.play().then(() => {
        if (gen !== this.gen) return finish("error");
        finish("ok");
      }).catch((err) => {
        finish(err?.name === "NotAllowedError" ? "gesture" : "error");
      });
    });
  },

  async tryYouTube(id, gen) {
    try {
      const p = await ensurePlayer();
      if (gen !== this.gen) return "error";
      this.audio.pause();
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this._ytWait = null;
          resolve("gesture");
        }, 7000);
        this._ytWait = (ok) => {
          clearTimeout(timer);
          this._ytWait = null;
          resolve(ok ? "ok" : "error");
        };
        p.loadVideoById(id);
      });
    } catch (err) {
      return err?.name === "NotAllowedError" ? "gesture" : "error";
    }
  },

  stopOthers() {
    try { this.audio.pause(); } catch { /* ignore */ }
  },

  markPlaying() {
    this.playing = true;
    this.cueing = false;
    this.needsTap = false;
    if (!this.noted && this.track) {
      this.noted = true;
      store.pushHistory(this.track);
    }
    this.failStreak = 0;
    document.body.dataset.playing = "true";
    emit("change");
  },

  markPaused() {
    this.playing = false;
    document.body.dataset.playing = "false";
    this.persist();
    emit("change");
  },

  handleEnded() {
    if (this.pauseAfter) {
      this.pauseAfter = false;
      this.playing = false;
      document.body.dataset.playing = "false";
      this.toast?.("Lights out.");
      this.persist();
      emit("change");
      return;
    }
    if (this.repeat === "one" && this.track) {
      this.seekRatio(0);
      this.resume();
      return;
    }
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      this.persist();
      this.cue(this.queue[this.index]);
      return;
    }
    if (this.repeat === "all" && this.queue.length) {
      this.index = 0;
      this.persist();
      this.cue(this.queue[this.index]);
      return;
    }
    if (this.stay && this.track) {
      related(this.track).then((more) => {
        if (!more.length) {
          this.playing = false;
          document.body.dataset.playing = "false";
          emit("change");
          return;
        }
        this.append(more);
        this.index += 1;
        this.cue(this.queue[this.index]);
      });
      return;
    }
    this.playing = false;
    document.body.dataset.playing = "false";
    this.persist();
    emit("change");
  },

  failCurrent(msg) {
    this.failStreak += 1;
    this.playing = false;
    this.cueing = false;
    emit("change");
    if (this.failStreak >= 3) {
      this.toast?.(msg || "The line keeps dropping.");
      return;
    }
    this.toast?.(msg || "Skipping.");
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      this.cue(this.queue[this.index]);
    }
  },

  toggle() {
    this.unlock();
    if (this.needsTap && this.pending) {
      const pending = this.pending;
      this.needsTap = false;
      this.pending = null;
      if (pending.type === "audio") {
        this.audio.src = pending.url;
        this.mode = "audio";
        this.source = pending.url.startsWith("/") ? "house" : "direct";
        document.body.dataset.source = "audio";
        this.audio.play().then(() => this.markPlaying()).catch(() => this.cue(pending.track));
        return;
      }
      if (ytPlayer?.loadVideoById) {
        this.audio.pause();
        this.mode = "youtube";
        this.source = "picture";
        document.body.dataset.source = "youtube";
        ytPlayer.loadVideoById(pending.id);
        this.markPlaying();
        return;
      }
      this.cue(pending.track);
      return;
    }
    if (!this.track) return;
    if (this.playing) this.pause();
    else if (this.mode) this.resume();
    else this.cue(this.track);
  },

  pause() {
    if (this.mode === "youtube") {
      try { ytPlayer?.pauseVideo(); } catch { /* ignore */ }
    } else {
      this.audio.pause();
    }
    this.markPaused();
  },

  resume() {
    this.unlock();
    if (this.mode === "youtube") {
      try { ytPlayer?.playVideo(); } catch { /* ignore */ }
      this.markPlaying();
      return;
    }
    this.audio.play().then(() => this.markPlaying()).catch((err) => {
      if (err?.name === "NotAllowedError") {
        this.needsTap = true;
        emit("change");
      } else if (this.track) this.cue(this.track);
    });
  },

  next() {
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      this.cue(this.queue[this.index]);
    } else if (this.repeat === "all" && this.queue.length) {
      this.index = 0;
      this.cue(this.queue[this.index]);
    }
  },

  prev() {
    const t = this.getTime();
    if (t > 3) {
      this.seekRatio(0);
      return;
    }
    if (this.index > 0) {
      this.index -= 1;
      this.cue(this.queue[this.index]);
    } else this.seekRatio(0);
  },

  seekRatio(p) {
    const d = this.getDuration();
    if (!d) return;
    const to = Math.max(0, Math.min(d - 0.25, d * p));
    if (this.mode === "youtube" && ytPlayer?.seekTo) {
      try { ytPlayer.seekTo(to, true); } catch { /* ignore */ }
    } else {
      try { this.audio.currentTime = to; } catch { /* ignore */ }
    }
  },

  seekBy(sec) {
    const d = this.getDuration() || 1e9;
    const t = Math.max(0, Math.min(d, this.getTime() + sec));
    if (this.mode === "youtube" && ytPlayer?.seekTo) ytPlayer.seekTo(t, true);
    else {
      try { this.audio.currentTime = t; } catch { /* ignore */ }
    }
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
    try { ytPlayer?.setVolume?.(Math.round(this.volume * 100)); } catch { /* ignore */ }
    this.persist();
  },

  cycleRepeat() {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
    this.persist();
    emit("change");
    return this.repeat;
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle) {
      const head = this.queue.slice(0, this.index + 1);
      const tail = this.queue.slice(this.index + 1);
      for (let i = tail.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [tail[i], tail[j]] = [tail[j], tail[i]];
      }
      this.queue = head.concat(tail);
    }
    this.persist();
    emit("change");
    return this.shuffle;
  },

  toggleStay(station) {
    this.stay = !this.stay;
    if (station) this.radio = station;
    if (!this.stay) this.radio = null;
    emit("change");
    return this.stay;
  },

  removeAt(i) {
    if (!this.queue[i]) return;
    const was = i === this.index;
    this.queue.splice(i, 1);
    if (i < this.index) this.index -= 1;
    if (!this.queue.length) {
      this.track = null;
      this.pause();
    } else if (was) {
      this.index = Math.min(this.index, this.queue.length - 1);
      this.cue(this.queue[this.index]);
    }
    this.persist();
    emit("change");
  },

  move(from, to) {
    if (!this.queue[from] || to < 0 || to >= this.queue.length) return;
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, item);
    if (this.index === from) this.index = to;
    else if (from < this.index && to >= this.index) this.index -= 1;
    else if (from > this.index && to <= this.index) this.index += 1;
    this.persist();
    emit("change");
  },

  clearQueue() {
    const current = this.track;
    this.queue = current ? [current] : [];
    this.index = 0;
    this.persist();
    emit("change");
  },

  playNext(track) {
    if (!track || !isId(track.id)) return;
    const at = Math.min(this.queue.length, this.index + 1);
    this.queue.splice(at, 0, track);
    if (!this.track) {
      this.index = 0;
      this.cue(track);
    }
    this.persist();
    emit("change");
  },

  getTime() {
    if (this.mode === "youtube") {
      try { return ytPlayer?.getCurrentTime?.() || 0; } catch { return 0; }
    }
    return this.audio?.currentTime || 0;
  },

  getDuration() {
    let d = 0;
    if (this.mode === "youtube") {
      try { d = ytPlayer?.getDuration?.() || 0; } catch { d = 0; }
    } else d = this.audio?.duration || 0;
    if (!d || !Number.isFinite(d)) d = this.track?.duration || 0;
    return d || 0;
  },
};

function loadYTAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("yt-timeout")), 8000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error("yt-block"));
    };
    document.head.appendChild(s);
  });
  return ytReady;
}

function ensurePlayer() {
  return loadYTAPI().then(
    () =>
      new Promise((resolve, reject) => {
        if (ytPlayer) return resolve(ytPlayer);
        const timer = setTimeout(() => reject(new Error("yt-ready")), 8000);
        ytPlayer = new YT.Player("yt-player", {
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            origin: location.origin,
            iv_load_policy: 3,
          },
          events: {
            onReady: () => {
              clearTimeout(timer);
              try { ytPlayer.setVolume(Math.round(player.volume * 100)); } catch { /* ignore */ }
              resolve(ytPlayer);
            },
            onError: () => {
              player._ytWait?.(false);
              if (player.mode === "youtube") player.failCurrent("That picture won't play.");
            },
            onStateChange: (e) => {
              const YTPS = window.YT?.PlayerState;
              if (!YTPS || player.mode !== "youtube" && e.data !== YTPS.PLAYING && e.data !== YTPS.CUED) {
                if (e.data === YTPS?.PLAYING) player._ytWait?.(true);
              }
              if (e.data === YTPS?.PLAYING) {
                player._ytWait?.(true);
                if (player.mode === "youtube" || player.source === "picture") player.markPlaying();
              }
              if (e.data === YTPS?.PAUSED && player.mode === "youtube") player.markPaused();
              if (e.data === YTPS?.ENDED && player.mode === "youtube") player.handleEnded();
            },
          },
        });
      })
  );
}

export function warmYouTube() {
  loadYTAPI().then(ensurePlayer).catch(() => {});
}
