import { STATIONS, stationById, nearestStation, stationForHour, freqPct, catalogSearch } from "./catalog.js";
import { store } from "./store.js";
import { search, suggest, importPlaylist, checkHealth, line, lookup } from "./api.js";
import { player, warmYouTube } from "./player.js";
import { esc, fmt, pad, dayKey, greet, clock, parseTarget, isId, normalize } from "./util.js";

const app = document.getElementById("app");
const ui = {
  stationId: stationForHour().id,
  filter: "cuts",
  sug: [],
  sugAt: -1,
  sleepUntil: 0,
  armedDelete: "",
  known: new Map(),
};
const lists = { search: [], station: [], query: "" };

window.rtImgErr = (img) => {
  const s = document.createElement("span");
  s.className = "fallback";
  s.textContent = img.dataset.letter || "·";
  img.replaceWith(s);
};

function remember(track) {
  if (track?.id) ui.known.set(track.id, track);
  return track;
}
function trackById(id) {
  return ui.known.get(id) || store.liked.find((t) => t.id === id) || store.history.find((t) => t.id === id) || player.queue.find((t) => t.id === id) || null;
}
function route() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, params: new URLSearchParams(qs || ""), path: "/" + parts.join("/") };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function heart(on) {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.4 2.4 8.1C1.2 6.9 1.3 4.8 2.7 3.6c1.2-1 3-1 4.1.2L8 5l1.2-1.2c1.1-1.2 2.9-1.2 4.1-.2 1.4 1.2 1.5 3.3.3 4.5L8 13.4z" ${on ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3"'}></path></svg>`;
}
function brand() {
  return `<a class="brand" href="#/"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="16" r="2.2" fill="#d23a2c"/><path d="M16 3.2v5" stroke="currentColor" stroke-width="1.4"/></svg><span>room <em>tone</em></span></a>`;
}
function nav(active) {
  const items = [["floor", "Floor"], ["dial", "Dial"], ["shelves", "Shelves"], ["log", "Log"]];
  return `<nav class="nav-links">${items.map(([id, label]) => `<a href="#/${id}" class="${active === id ? "is-active" : ""}">${label}</a>`).join("")}</nav><span class="clock" data-clock>${clock()}</span>`;
}
function tickerText() {
  const s = STATIONS.map((st) => `${st.freq.toFixed(1)} ${st.name}`).join("    ·    ");
  const live = player.track ? `On air  ${player.track.title} — ${player.track.artist}` : "On air  the room is open";
  const chunk = `${live}    ·    ${s}    ·    no account    ·    shelf stays here    ·    `;
  return `<div class="ticker"><div class="ticker-track"><span><i class="dot"></i>${esc(chunk)}</span><span aria-hidden="true"><i class="dot"></i>${esc(chunk)}</span></div></div>`;
}

function rowHTML(track, i, listName) {
  remember(track);
  const on = player.track?.id === track.id;
  const liked = store.isLiked(track.id);
  return `<div class="row${on ? " is-on" : ""}" data-row data-act="play-row" data-id="${track.id}" data-list="${esc(listName)}" tabindex="0" role="button" aria-label="Play ${esc(track.title)}">
    <span class="idx">${pad(i + 1)}</span>
    <span class="t"><img src="${esc(track.thumb)}" alt="" data-letter="${esc((track.title || "?").slice(0, 1))}" onerror="rtImgErr(this)"><span class="tt">${esc(track.title)}</span></span>
    <span class="ar">${esc(track.artist)}</span>
    <span class="tm">${track.duration ? fmt(track.duration) : "—"}</span>
    <span class="acts">
      <button type="button" data-act="like" data-id="${track.id}" aria-label="Like" class="${liked ? "is-liked" : ""}">${heart(liked)}</button>
      <button type="button" data-act="add" data-id="${track.id}" aria-label="Add to shelf">+</button>
      <button type="button" data-act="next-up" data-id="${track.id}" aria-label="Play next">↳</button>
    </span>
  </div>`;
}
function sheet(tracks, listName, head = true) {
  if (!tracks.length) return "";
  return `<div class="sheet">${head ? `<div class="sheet-head"><span>#</span><span>Title</span><span>Artist</span><span>Time</span><span></span></div>` : ""}${tracks.map((t, i) => rowHTML(t, i, listName)).join("")}</div>`;
}
function sleeve(track, listName) {
  remember(track);
  return `<button type="button" class="sleeve-card" data-act="play-row" data-id="${track.id}" data-list="${esc(listName)}">
    <span class="sleeve"><img src="${esc(track.thumb)}" alt="" data-letter="${esc((track.title || "?").slice(0, 1))}" onerror="rtImgErr(this)"></span>
    <strong>${esc(track.title)}</strong>
    <em>${esc(track.artist)}</em>
  </button>`;
}
function dialHTML() {
  const station = stationById(ui.stationId) || STATIONS[0];
  const marks = STATIONS.map((s) => {
    const left = freqPct(s.freq);
    return `<button type="button" class="dial-mark${s.id === station.id ? " is-hot" : ""}" style="left:${left}%" data-act="preview-station" data-station="${s.id}" aria-label="${esc(s.name)}"></button>
      <span class="dial-tag" style="left:${left}%">${esc(s.name)}</span>`;
  }).join("");
  return `<div class="dial">
    <div class="dial-scale" data-scale>
      <div class="dial-ticks"></div>
      ${marks}
      <div class="dial-needle" data-needle style="left:${freqPct(station.freq)}%"></div>
    </div>
    <div class="dial-nums"><span>88</span><span>93</span><span>98</span><span>103</span><span>108</span></div>
  </div>`;
}

function render() {
  const r = route();
  const page = r.parts[0] || "lobby";
  document.body.dataset.theme = page === "lobby" ? "paper" : "booth";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", page === "lobby" ? "#e4dccb" : "#12110e");
  if (page === "lobby") renderLobby();
  else renderBooth(page, r);
  syncChrome();
}

function renderLobby() {
  const station = stationById(ui.stationId) || stationForHour();
  ui.stationId = station.id;
  const seed = station.seeds[0];
  const last = store.history[0];
  app.innerHTML = `
    <div class="lobby">
      <div class="crops" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      ${tickerText()}
      <header class="top">${brand()}${nav("")}</header>
      <section class="hero">
        <div class="hero-copy">
          <p class="kicker">01 / lobby · ${esc(greet())}</p>
          <h1>A room<br>with the<br><em>lights down.</em></h1>
          <p class="lede">Search the night. Keep a shelf. Leave no account behind. The log stays in this browser, and the room does not ask your name.</p>
          <div class="hero-actions">
            <button type="button" class="stamp" data-act="play-station" data-station="${station.id}">Drop the needle</button>
            <a class="textlink" href="#/floor">Enter the floor</a>
          </div>
          <form class="lobby-search" data-act="search">
            <label class="sr" for="lobby-q">Search</label>
            <input id="lobby-q" name="q" type="search" placeholder="or name a record" autocomplete="off" enterkeyhint="search" />
          </form>
          ${last ? `<p class="resume-link"><button type="button" data-act="resume">Resume · ${esc(last.title)}</button></p>` : ""}
        </div>
        <aside class="receiver is-photo" id="receiver">
          <img class="plate" src="img/platter.jpg" alt="" />
          <div class="plate-ticket" data-readout>
            <span class="kicker"><i class="dot"></i> On air · <span data-city>${esc(station.city)}</span></span>
            <strong data-freq>${station.freq.toFixed(1)}</strong>
            <em data-sname>${esc(station.name)}</em>
            <p data-blurb>${esc(station.blurb)}</p>
            ${seed ? `<span class="plate-cut">${esc(seed.artist)} — ${esc(seed.title)}</span>` : ""}
          </div>
        </aside>
      </section>
      <section class="dial-band">
        <div class="dial-band-head">
          <span class="kicker">Tune the room</span>
          <span class="kicker" data-sname>${esc(station.name)} · ${station.freq.toFixed(1)}</span>
        </div>
        ${dialHTML()}
      </section>
      <section class="index" aria-label="Stations">
        ${STATIONS.map((s) => `<button type="button" class="index-row${s.id === station.id ? " is-hot" : ""}" data-station="${s.id}" data-act="play-station">
          <span class="num kicker">${s.num}</span>
          <i class="swatch" style="background:${s.color}"></i>
          <span class="nm">${esc(s.name)}</span>
          <span class="fq">${s.freq.toFixed(1)}</span>
          <span class="ct">${esc(s.city)}</span>
          <span class="bl">${esc(s.blurb)}</span>
          <span class="play-mini">Play</span>
        </button>`).join("")}
      </section>
      <section class="colophon">
        <div>
          <div class="kicker">Colophon</div>
          <p>room tone is a listening room, not a service. Shelves, likes, and the log never leave this browser. Nothing here requires a sign-in.</p>
        </div>
        <div>
          <div class="kicker">House line</div>
          <p id="line-note">Cuts are cued live from public videos. The house line is yt-dlp. When it is quiet, the room extracts directly in your browser.</p>
        </div>
        <div>
          <div class="kicker">Local</div>
          <p>Close the tab and the shelf is still here. Export it if you switch browsers. The room does not keep a copy.</p>
        </div>
      </section>
      <section class="keys">
        <div>
          <div class="kicker">Hands</div>
          <div class="keygrid">
            <span><kbd>space</kbd>play</span>
            <span><kbd>←</kbd><kbd>→</kbd>seek</span>
            <span><kbd>↑</kbd><kbd>↓</kbd>volume</span>
            <span><kbd>N</kbd>next</span>
            <span><kbd>L</kbd>like</span>
            <span><kbd>/</kbd>search</span>
            <span><kbd>esc</kbd>close</span>
          </div>
        </div>
      </section>
    </div>`;
}

function renderBooth(page, r) {
  const shelves = store.playlists;
  app.innerHTML = `
    <div class="booth">
      <aside class="rail">
        ${brand()}
        <div class="group">Room</div>
        <a href="#/floor" class="${page === "floor" ? "is-active" : ""}">Floor</a>
        <a href="#/dial" class="${page === "dial" ? "is-active" : ""}">Dial</a>
        <a href="#/shelves" class="${page === "shelves" || page === "shelf" ? "is-active" : ""}">Shelves</a>
        <a href="#/log" class="${page === "log" ? "is-active" : ""}">Log</a>
        <div class="group">Yours</div>
        <a href="#/shelves">Liked <span class="kicker">${store.liked.length}</span></a>
        ${shelves.map((p) => `<a href="#/shelf/${p.id}" class="${r.parts[1] === p.id ? "is-active" : ""}">${esc(p.name)}</a>`).join("") || `<span class="kicker">No shelves yet</span>`}
      </aside>
      <div class="booth-main">
        <header class="topbar">
          ${brand()}
          <form class="search-wrap" data-act="search">
            <label class="sr" for="q">Search</label>
            <input id="q" name="q" type="search" placeholder="Search the night  /" autocomplete="off" value="${esc(r.params.get("q") || "")}" />
            <div class="suggest" id="suggest" hidden></div>
          </form>
          ${nav(page === "shelf" ? "shelves" : page)}
        </header>
        <div class="main" id="main"></div>
      </div>
    </div>`;
  const main = document.getElementById("main");
  if (page === "floor") renderFloor(main, r);
  else if (page === "dial") renderDial(main, r);
  else if (page === "shelves") renderShelves(main);
  else if (page === "shelf") renderShelf(main, r.parts[1]);
  else if (page === "log") renderLog(main);
  else if (page === "t") renderTrack(main, r.parts[1]);
  else renderFloor(main, r);
}

function renderFloor(main, r) {
  const q = (r.params.get("q") || "").trim();
  lists.query = q;
  if (!q) {
    main.innerHTML = `
      <p class="kicker">02 / floor</p>
      <button type="button" class="prompt" data-act="focus-search">What are you<br><em>trying to hear?</em></button>
      <div class="recents">${store.recents.map((s) => `<button type="button" data-act="recent" data-q="${esc(s)}">${esc(s)}</button>`).join("") || `<span class="kicker">The search line is open.</span>`}</div>
      <div class="program-head"><h2>House program</h2><a class="textlink" href="#/dial">The dial</a></div>
      ${STATIONS.map((s) => {
        const tracks = s.seeds;
        if (!tracks.length) return "";
        tracks.forEach(remember);
        lists["station:" + s.id] = tracks;
        return `<div class="section-head"><h2 style="font-size:26px">${esc(s.name)}</h2><button type="button" class="textlink" data-act="play-station" data-station="${s.id}">Play ${s.freq.toFixed(1)}</button></div>
          <div class="scroller">${tracks.map((t) => sleeve(t, "station:" + s.id)).join("")}</div>`;
      }).join("")}
      ${store.history.length ? `<div class="section-head"><h2>From the log</h2><a class="textlink" href="#/log">All of it</a></div><div class="scroller">${store.history.slice(0, 8).map((t) => sleeve(t, "history")).join("")}</div>` : ""}`;
    return;
  }
  main.innerHTML = `<p class="kicker">Searching “${esc(q)}”</p><p class="empty">Cueing the catalog…</p>`;
  runSearch(q, main);
}

async function runSearch(q, main) {
  const target = parseTarget(q);
  if (target.type === "video") {
    go(`#/t/${target.id}`);
    return;
  }
  if (target.type === "playlist") {
    await importAndOpen(q);
    return;
  }
  store.pushRecent(q);
  let tracks = [];
  let note = "";
  try {
    tracks = await search(q, 18);
  } catch {
    tracks = [];
  }
  if (!tracks.length) {
    tracks = catalogSearch(q);
    note = tracks.length ? "Live search is quiet. Showing the house catalog." : "";
  }
  tracks = applyFilter(tracks);
  lists.search = tracks;
  tracks.forEach(remember);
  if (!main.isConnected) return;
  main.innerHTML = `
    <div class="section-head">
      <div>
        <p class="kicker">${note || `${tracks.length} cuts`}</p>
        <h2>${esc(q)}</h2>
      </div>
      <div class="filters">
        ${["cuts", "mixes", "all"].map((f) => `<button type="button" data-act="filter" data-filter="${f}" class="${ui.filter === f ? "is-on" : ""}">${f}</button>`).join("")}
      </div>
    </div>
    ${tracks.length ? sheet(tracks, "search") : `<p class="empty">Nothing under that name. Try a player, a city, or a mood.</p>`}`;
}

function applyFilter(tracks) {
  const base = tracks.filter((t) => !t.duration || t.duration >= 45);
  if (ui.filter === "all") return base;
  if (ui.filter === "mixes") return base.filter((t) => (t.duration || 0) >= 12 * 60);
  return base.filter((t) => !t.duration || t.duration < 12 * 60);
}

function renderDial(main) {
  const station = stationById(ui.stationId) || stationForHour();
  const tracks = lists.station.length && lists.stationStation === station.id ? lists.station : station.seeds.slice();
  lists.station = tracks;
  lists.stationStation = station.id;
  tracks.forEach(remember);
  main.innerHTML = `
    <div class="dial-page">
      <p class="kicker">03 / dial</p>
      <div class="dial-readout" data-readout>
        <div class="dial-freq" data-freq>${station.freq.toFixed(1)}</div>
        <div>
          <div class="dial-name" data-sname>${esc(station.name)}</div>
          <div class="kicker">${esc(station.city)}</div>
        </div>
      </div>
      <p class="dial-blurb">${esc(station.blurb)}</p>
      ${dialHTML()}
      <div class="hero-actions">
        <button type="button" class="stamp" data-act="play-station" data-station="${station.id}">Play this frequency</button>
        <button type="button" class="textlink" data-act="stay-station" data-station="${station.id}">${player.stay && player.radio?.id === station.id ? "Staying" : "Stay on it"}</button>
      </div>
      <div class="section-head"><h2>Program</h2><span class="kicker">${tracks.length} cuts</span></div>
      <div id="station-program">${tracks.length ? sheet(tracks, "station") : `<p class="empty">This frequency is still tuning.</p>`}</div>
    </div>`;
  enrichStation(station);
}

async function enrichStation(station) {
  const live = await search(station.query, 12);
  if (ui.stationId !== station.id) return;
  const have = new Set(station.seeds.map((t) => t.id));
  const extra = live.filter((t) => !have.has(t.id) && (!t.duration || t.duration < 15 * 60));
  lists.station = [...station.seeds, ...extra].slice(0, 16);
  lists.stationStation = station.id;
  lists.station.forEach(remember);
  const box = document.getElementById("station-program");
  if (box) box.innerHTML = sheet(lists.station, "station");
  if (player.radio?.id === station.id) player.append(extra);
}

function renderShelves(main) {
  const liked = store.liked;
  main.innerHTML = `
    <p class="kicker">04 / shelves · playlists</p>
    <h2 class="prompt" style="font-size:clamp(42px,5vw,68px)">Your shelves.</h2>
    <form class="inline-form" data-act="new-shelf">
      <input name="name" class="line-input" placeholder="Name a shelf" maxlength="60" aria-label="Shelf name" />
      <button class="stamp" type="submit">Make</button>
    </form>
    <form class="import-row" data-act="import-pl">
      <input name="url" placeholder="Paste a YouTube link" aria-label="YouTube link" />
      <button class="stamp" type="submit">Import</button>
    </form>
    <div class="hero-actions" style="margin-bottom:18px">
      <button type="button" class="textlink" data-act="export">Export shelves</button>
      <label class="textlink">Import file<input id="import-file" type="file" accept="application/json" hidden /></label>
    </div>
    <div class="section-head"><h2>Liked</h2><span class="kicker">${liked.length}</span></div>
    ${liked.length ? sheet(liked, "liked") : `<p class="empty">Nothing saved. The heart on a row keeps it here.</p>`}
    <div class="section-head"><h2>Shelves</h2></div>
    <div class="shelf-list">
      ${store.playlists.length ? store.playlists.map((p) => `<a class="shelf-item" href="#/shelf/${p.id}">
        <span class="kicker">${pad(Math.min(99, p.tracks.length))}</span>
        <span><b>${esc(p.name)}</b><div class="bar" style="width:${Math.max(8, Math.min(100, p.tracks.length * 8))}%"></div></span>
        <span class="shelf-meta">${p.tracks.length} cuts</span>
      </a>`).join("") : `<p class="empty">No shelves yet. Name one above.</p>`}
    </div>`;
}

function renderShelf(main, id) {
  const p = store.playlist(id);
  if (!p) {
    main.innerHTML = `<p class="empty">That shelf is gone.</p>`;
    return;
  }
  main.innerHTML = `
    <p class="kicker">Shelf · ${p.tracks.length} cuts</p>
    <input class="rename" value="${esc(p.name)}" data-act="rename" data-id="${p.id}" aria-label="Shelf name" />
    <div class="hero-actions" style="margin:14px 0 18px">
      <button type="button" class="stamp" data-act="play-shelf" data-id="${p.id}" ${p.tracks.length ? "" : "disabled"}>Play shelf</button>
      <button type="button" class="textlink" data-act="delete-shelf" data-id="${p.id}">${ui.armedDelete === p.id ? "Confirm delete" : "Delete"}</button>
    </div>
    ${p.tracks.length ? sheet(p.tracks, "pl:" + p.id) : `<p class="empty">Empty shelf. Add cuts from the floor with the plus.</p>`}`;
}

function renderLog(main) {
  const groups = new Map();
  store.history.forEach((t) => {
    const k = dayKey(t.at || Date.now());
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  main.innerHTML = `
    <div class="section-head"><div><p class="kicker">05 / log</p><h2>What played here.</h2></div>
      ${store.history.length ? `<button type="button" class="textlink" data-act="clear-log">Clear log</button>` : ""}
    </div>
    ${store.history.length ? [...groups.entries()].map(([day, tracks]) => `<div class="log-day kicker">${esc(day)}</div>${sheet(tracks, "history", false)}`).join("") : `<p class="empty">Nothing in the log yet. Play a cut and it will keep a quiet record.</p>`}`;
}

function renderTrack(main, id) {
  if (!isId(id)) {
    main.innerHTML = `<p class="empty">That isn’t a cut we can cue.</p>`;
    return;
  }
  const known = trackById(id) || normalize({ id, title: "Cueing…", artist: "Looking it up" });
  remember(known);
  main.innerHTML = slip(known);
  if (known.title === "Cueing…") {
    lookup(id).then((t) => {
      if (!t || !main.isConnected) return;
      remember(t);
      if (player.track?.id === t.id && player.track.title === "Cueing…") player.track = t;
      main.innerHTML = slip(t);
      syncChrome();
    });
  }
}
function slip(track) {
  return `<div class="track-slip">
    <div class="sleeve" style="width:220px;height:220px"><img src="${esc(track.thumb)}" alt="" data-letter="${esc((track.title || "?").slice(0, 1))}" onerror="rtImgErr(this)"></div>
    <div>
      <p class="kicker">Cut</p>
      <h1>${esc(track.title)}</h1>
      <p class="lede">${esc(track.artist)}${track.duration ? " · " + fmt(track.duration) : ""}</p>
      <div class="hero-actions">
        <button type="button" class="stamp" data-act="play-one" data-id="${track.id}">Play</button>
        <button type="button" class="textlink" data-act="add" data-id="${track.id}">Add to shelf</button>
        <button type="button" class="textlink" data-act="like" data-id="${track.id}">${store.isLiked(track.id) ? "Liked" : "Like"}</button>
      </div>
    </div>
  </div>`;
}

function getList(name) {
  if (name === "search") return lists.search.slice();
  if (name === "station") return (lists.station.length ? lists.station : stationById(ui.stationId)?.seeds || []).slice();
  if (name?.startsWith("station:")) return (stationById(name.split(":")[1])?.seeds || []).slice();
  if (name === "liked") return store.liked.slice();
  if (name === "history") return store.history.map(({ at, ...t }) => t);
  if (name?.startsWith("pl:")) return store.playlist(name.slice(3))?.tracks.slice() || [];
  if (name === "queue") return player.queue.slice();
  return [];
}

async function playStation(id, { stay = false } = {}) {
  const station = stationById(id);
  if (!station) return;
  ui.stationId = id;
  player.unlock();
  let tracks = station.seeds.slice();
  if (!tracks.length) {
    toast("Finding the frequency…");
    tracks = await search(station.query, 10);
  }
  if (!tracks.length) {
    toast("That frequency is quiet right now.");
    return;
  }
  player.playList(tracks, 0, { radio: stay || player.stay ? station : null });
  if (stay) player.stay = true;
  search(station.query, 12).then((live) => {
    const have = new Set(tracks.map((t) => t.id));
    player.append(live.filter((t) => !have.has(t.id)));
  });
  if (route().parts[0] === "lobby") {
    /* stay on the lobby, dock appears */
  }
}

function sourceLabel() {
  if (!player.track) return "Nothing cued.";
  if (player.source === "house") return "House line · yt-dlp";
  if (player.source === "picture") return "Picture line";
  if (player.source === "direct") return "Direct extract";
  return line().ytdlp ? "House line standing by." : "House line quiet.";
}

function syncChrome() {
  const dock = document.getElementById("dock");
  const show = Boolean(player.track) && (player.playing || player.cueing || document.body.dataset.theme === "booth" || player.needsTap);
  dock.hidden = !show;
  document.body.classList.toggle("has-dock", show);
  const title = document.getElementById("dock-title");
  const artist = document.getElementById("dock-artist");
  const img = document.getElementById("dock-img");
  if (player.track) {
    title.textContent = player.track.title;
    artist.textContent = player.cueing ? "Cueing…" : player.needsTap ? "Tap once more" : player.track.artist;
    img.src = player.track.thumb || "";
    img.alt = "";
  }
  document.getElementById("q-count").textContent = String(player.queue.length);
  document.getElementById("like-btn").classList.toggle("is-liked", player.track && store.isLiked(player.track.id));
  document.body.dataset.playing = player.playing ? "true" : "false";
  document.body.dataset.cueing = player.cueing ? "true" : "false";
  document.body.dataset.source = player.source || "none";
  const monitor = document.getElementById("monitor");
  monitor.hidden = player.source !== "picture";
  document.getElementById("play-btn").setAttribute("aria-label", player.playing ? "Pause" : "Play");
  if (document.getElementById("now").dataset.open === "true") fillNow();
  if (document.getElementById("queue").dataset.open === "true") fillQueue();
  document.querySelectorAll("[data-row]").forEach((row) => {
    row.classList.toggle("is-on", row.dataset.id === player.track?.id);
  });
  document.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = clock(); });
  if (document.querySelector(".lobby") && ui.tickerFor !== (player.track?.id || "")) {
    ui.tickerFor = player.track?.id || "";
    const hold = document.createElement("div");
    hold.innerHTML = tickerText();
    document.querySelector(".ticker")?.replaceWith(hold.firstElementChild);
  }
  const note = document.getElementById("line-note");
  if (note && line().checked) {
    note.textContent = line().ytdlp
      ? "House line is up. Search and audio run through yt-dlp on this machine."
      : "House line is quiet from here. The room will cue a direct extract in your browser, then a picture if it must.";
  }
}

function fillQueue() {
  const body = document.getElementById("queue-body");
  if (!player.queue.length) {
    body.innerHTML = `<p class="empty" style="font-size:22px;padding:18px">Queue is empty.</p>`;
    return;
  }
  body.innerHTML = player.queue.map((t, i) => `
    <div class="q-row${i === player.index ? " is-on" : ""}">
      <button type="button" data-act="play-index" data-i="${i}" class="kicker">${pad(i + 1)}</button>
      <button type="button" data-act="play-index" data-i="${i}" style="text-align:left"><span class="tt">${esc(t.title)}</span><div class="kicker">${esc(t.artist)}</div></button>
      <span class="q-tools">
        <button type="button" data-act="q-up" data-i="${i}" aria-label="Move up">↑</button>
        <button type="button" data-act="q-down" data-i="${i}" aria-label="Move down">↓</button>
        <button type="button" data-act="q-remove" data-i="${i}" aria-label="Remove">×</button>
      </span>
    </div>`).join("");
}

function fillNow() {
  const track = player.track;
  const kicker = document.getElementById("now-kicker");
  const body = document.getElementById("now-body");
  if (!track) {
    body.innerHTML = `<p class="empty">Nothing on the platter.</p>`;
    return;
  }
  const station = player.radio;
  kicker.textContent = station ? `${station.freq.toFixed(1)}  ${station.name}` : sourceLabel();
  const upcoming = player.queue.slice(player.index + 1, player.index + 5);
  body.innerHTML = `
    <div class="now-grid">
      <div class="platter">
        <div class="disc${player.playing ? " is-spinning" : ""}">
          <img src="${esc(track.thumb)}" alt="" onerror="rtImgErr(this)" data-letter="${esc(track.title.slice(0, 1))}" />
          <i class="spindle"></i>
        </div>
        <svg class="arm${player.playing ? " is-down" : ""}" viewBox="0 0 140 180" aria-hidden="true">
          <circle cx="108" cy="22" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M108 30 C108 78 78 96 58 132" fill="none" stroke="currentColor" stroke-width="3"/>
          <rect x="40" y="126" width="30" height="12"/>
        </svg>
      </div>
      <div>
        <p class="kicker">${esc(track.artist)}</p>
        <h2 class="now-title">${esc(track.title)}</h2>
        <canvas class="scope" id="scope" width="640" height="96" aria-hidden="true"></canvas>
        <div class="now-times"><span id="now-time">${fmt(player.getTime())}</span><span id="now-dur">${fmt(player.getDuration())}</span></div>
        <div class="scrub now-scrub" data-scrub-now><div class="scrub-fill" id="now-fill"></div></div>
        <div class="transport" style="gap:10px">
          <button type="button" data-act="prev" aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M3 2.5h1.6v11H3zM13.2 13.2 6.2 8l7-5.2v10.4z"/></svg></button>
          <button type="button" data-act="toggle" class="play-btn" aria-label="Play"><svg viewBox="0 0 16 16"><path class="ico-play" d="M4.2 2.2v11.6L13.6 8 4.2 2.2z"/><path class="ico-pause" d="M3.6 2.4h2.8v11.2H3.6zM9.6 2.4h2.8v11.2H9.6z"/></svg></button>
          <button type="button" data-act="next" aria-label="Next"><svg viewBox="0 0 16 16"><path d="M11.4 2.5H13v11h-1.6zM2.8 2.8 9.8 8l-7 5.2V2.8z"/></svg></button>
          <button type="button" data-act="like-current" class="${store.isLiked(track.id) ? "is-liked" : ""}" aria-label="Like">${heart(store.isLiked(track.id))}</button>
        </div>
        ${upcoming.length ? `<div class="upnext"><div class="kicker" style="margin-top:12px">Up next</div>${upcoming.map((t, i) => `<button type="button" data-act="play-index" data-i="${player.index + 1 + i}"><span class="kicker">${pad(player.index + 2 + i)}</span><strong>${esc(t.title)}</strong></button>`).join("")}</div>` : ""}
      </div>
    </div>`;
  bindScrub(body.querySelector("[data-scrub-now]"));
}

function openNow() {
  document.getElementById("now").dataset.open = "true";
  document.body.dataset.now = "open";
  fillNow();
}
function closeNow() {
  document.getElementById("now").dataset.open = "false";
  document.body.dataset.now = "closed";
}
function openQueue() {
  document.getElementById("queue").dataset.open = "true";
  document.getElementById("scrim").hidden = false;
  fillQueue();
}
function closeQueue() {
  document.getElementById("queue").dataset.open = "false";
  document.getElementById("scrim").hidden = true;
}
function closePopover() {
  const pop = document.getElementById("popover");
  pop.hidden = true;
  pop.innerHTML = "";
}
function openPopover(html, anchor) {
  const pop = document.getElementById("popover");
  pop.innerHTML = html;
  pop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = 260;
  let left = Math.min(rect.left, window.innerWidth - width - 12);
  left = Math.max(8, left);
  let top = rect.bottom + 8;
  pop.style.left = left + "px";
  pop.style.top = top + "px";
  requestAnimationFrame(() => {
    const h = pop.offsetHeight;
    if (top + h > window.innerHeight - 12) pop.style.top = Math.max(8, rect.top - h - 8) + "px";
  });
}

function toast(msg) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
player.toast = toast;

function moreHTML() {
  return `
    <button type="button" data-act="repeat">Repeat · ${player.repeat}</button>
    <button type="button" data-act="shuffle">Shuffle · ${player.shuffle ? "on" : "off"}</button>
    <button type="button" data-act="stay-toggle">Stay · ${player.stay ? "on" : "off"}</button>
    <div class="pop-label">Lights out</div>
    <div class="pop-row">
      <button type="button" data-act="sleep" data-min="15">15</button>
      <button type="button" data-act="sleep" data-min="30">30</button>
      <button type="button" data-act="sleep" data-min="45">45</button>
      <button type="button" data-act="sleep" data-min="end">End</button>
      <button type="button" data-act="sleep" data-min="0">Off</button>
    </div>
    <p class="pop-note">${esc(sourceLabel())}</p>
    <button type="button" data-act="keys">Keyboard</button>`;
}
function addHTML(id) {
  const shelves = store.playlists;
  return `
    <div class="pop-label">Add to shelf</div>
    ${shelves.map((p) => `<button type="button" data-act="add-to" data-id="${id}" data-pid="${p.id}">${esc(p.name)}</button>`).join("") || `<p class="pop-note">No shelves yet.</p>`}
    <form data-act="add-new" data-id="${id}"><input name="name" placeholder="New shelf" aria-label="New shelf" /></form>`;
}

async function importAndOpen(raw) {
  toast("Importing…");
  const result = await importPlaylist(raw);
  if (!result?.tracks?.length) {
    toast("Couldn’t read that link.");
    return;
  }
  const p = store.createPlaylist(result.title || "Imported");
  result.tracks.forEach((t) => store.addToPlaylist(p.id, t));
  toast(`Shelved ${result.tracks.length} cuts.`);
  go(`#/shelf/${p.id}`);
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) {
    if (!e.target.closest("#popover")) closePopover();
    if (!e.target.closest("#suggest") && !e.target.closest("#q")) {
      const sug = document.getElementById("suggest");
      if (sug) sug.hidden = true;
    }
    return;
  }
  const act = el.dataset.act;
  if (["play-row", "play-station", "play-one", "play-index", "play-shelf", "toggle", "resume", "drop"].includes(act)) {
    player.unlock();
  }
  if (act !== "add" && act !== "more" && !el.closest("#popover")) closePopover();

  if (act === "play-row") {
    const listName = el.dataset.list || "";
    const list = getList(listName);
    const idx = Math.max(0, list.findIndex((t) => t.id === el.dataset.id));
    const station = listName === "station"
      ? stationById(ui.stationId)
      : listName.startsWith("station:")
        ? stationById(listName.split(":")[1])
        : null;
    player.playList(list.length ? list : [trackById(el.dataset.id)].filter(Boolean), idx, { radio: station });
  } else if (act === "play-one") {
    const t = trackById(el.dataset.id);
    if (t) player.playList([t], 0);
  } else if (act === "play-station") {
    playStation(el.dataset.station, { stay: true });
  } else if (act === "preview-station") {
    ui.stationId = el.dataset.station;
    if (route().parts[0] === "dial") render();
    else paintStation(el.dataset.station);
  } else if (act === "stay-station") {
    player.stay = true;
    player.radio = stationById(el.dataset.station);
    toast("Staying on " + player.radio.name);
    render();
  } else if (act === "toggle") player.toggle();
  else if (act === "prev") player.prev();
  else if (act === "next") player.next();
  else if (act === "resume") {
    if (store.history[0]) player.playList([store.history[0]], 0);
  } else if (act === "now") openNow();
  else if (act === "close-now") closeNow();
  else if (act === "queue") openQueue();
  else if (act === "close-queue" || act === "close-overlays") { closeQueue(); closePopover(); }
  else if (act === "clear-queue") player.clearQueue();
  else if (act === "play-index") player.playIndex(Number(el.dataset.i));
  else if (act === "q-remove") player.removeAt(Number(el.dataset.i));
  else if (act === "q-up") player.move(Number(el.dataset.i), Number(el.dataset.i) - 1);
  else if (act === "q-down") player.move(Number(el.dataset.i), Number(el.dataset.i) + 1);
  else if (act === "like" || act === "like-current") {
    const t = act === "like-current" ? player.track : trackById(el.dataset.id);
    if (!t) return;
    const on = store.toggleLike(t);
    toast(on ? "Kept." : "Removed from liked.");
    syncChrome();
    if (route().parts[0] === "shelves" || route().parts[0] === "shelf") render();
    else el.closest(".row")?.querySelector("[data-act='like']")?.classList.toggle("is-liked", on);
  } else if (act === "add") {
    e.stopPropagation();
    openPopover(addHTML(el.dataset.id), el);
  } else if (act === "add-to") {
    const t = trackById(el.dataset.id);
    const p = store.playlist(el.dataset.pid);
    if (t && p) {
      const added = store.addToPlaylist(p.id, t);
      toast(added ? `Added to ${p.name}` : `Already on ${p.name}`);
    }
    closePopover();
  } else if (act === "next-up") {
    const t = trackById(el.dataset.id);
    if (t) { player.playNext(t); toast("Next."); }
  } else if (act === "more") {
    e.stopPropagation();
    openPopover(moreHTML(), el);
  } else if (act === "repeat") {
    const mode = player.cycleRepeat();
    toast("Repeat " + mode);
    openPopover(moreHTML(), document.getElementById("more-btn"));
  } else if (act === "shuffle") {
    toast(player.toggleShuffle() ? "Shuffle on" : "Shuffle off");
    openPopover(moreHTML(), document.getElementById("more-btn"));
  } else if (act === "stay-toggle") {
    player.stay = !player.stay;
    if (!player.stay) player.radio = null;
    toast(player.stay ? "Staying with the line" : "Will stop at the end");
    closePopover();
  } else if (act === "sleep") {
    const min = el.dataset.min;
    if (min === "0") { ui.sleepUntil = 0; player.pauseAfter = false; toast("Lights stay on"); }
    else if (min === "end") { player.pauseAfter = true; toast("Lights out at the end of this cut"); }
    else { ui.sleepUntil = Date.now() + Number(min) * 60000; player.pauseAfter = false; toast(`Lights out in ${min}`); }
    closePopover();
  } else if (act === "keys") {
    openPopover(`<p class="pop-note">space play · arrows seek and volume · N next · P previous · L like · / search · Q queue · esc close</p>`, document.getElementById("more-btn"));
  } else if (act === "focus-search") document.getElementById("q")?.focus();
  else if (act === "recent") go(`#/floor?q=${encodeURIComponent(el.dataset.q)}`);
  else if (act === "filter") {
    ui.filter = el.dataset.filter;
    const q = lists.query;
    if (q) runSearch(q, document.getElementById("main"));
  } else if (act === "play-shelf") {
    const p = store.playlist(el.dataset.id);
    if (p?.tracks.length) player.playList(p.tracks, 0);
  } else if (act === "delete-shelf") {
    if (ui.armedDelete === el.dataset.id) {
      store.deletePlaylist(el.dataset.id);
      ui.armedDelete = "";
      toast("Shelf discarded.");
      go("#/shelves");
    } else {
      ui.armedDelete = el.dataset.id;
      render();
    }
  } else if (act === "clear-log") {
    store.clearHistory();
    toast("Log cleared.");
    render();
  } else if (act === "export") {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "room-tone-shelves.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (act === "suggest-pick") {
    go(`#/floor?q=${encodeURIComponent(el.dataset.q)}`);
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form");
  if (!form) return;
  const act = form.dataset.act;
  if (!act) return;
  e.preventDefault();
  if (act === "search") {
    const q = new FormData(form).get("q").trim();
    if (!q) return;
    go(`#/floor?q=${encodeURIComponent(q)}`);
  } else if (act === "new-shelf") {
    const name = new FormData(form).get("name");
    const p = store.createPlaylist(name);
    toast("Shelf made.");
    go(`#/shelf/${p.id}`);
  } else if (act === "import-pl") {
    const url = new FormData(form).get("url");
    if (url) await importAndOpen(url);
  } else if (act === "add-new") {
    const name = new FormData(form).get("name");
    const p = store.createPlaylist(name);
    const t = trackById(form.dataset.id);
    if (t) store.addToPlaylist(p.id, t);
    toast(`Added to ${p.name}`);
    closePopover();
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id !== "import-file") return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const result = store.importJSON(text);
    toast(`Brought in ${result.shelves} shelves.`);
    render();
  } catch {
    toast("That file isn’t a shelf export.");
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.act === "rename") {
    store.renamePlaylist(e.target.dataset.id, e.target.value);
  }
  if (e.target.id === "volume") player.setVolume(Number(e.target.value));
  if (e.target.id === "q") {
    const q = e.target.value.trim();
    clearTimeout(ui.sugTimer);
    ui.sugTimer = setTimeout(async () => {
      ui.sug = q.length > 1 ? await suggest(q) : [];
      ui.sugAt = -1;
      const box = document.getElementById("suggest");
      if (!box) return;
      if (!ui.sug.length) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = ui.sug.map((s, i) => `<button type="button" data-act="suggest-pick" data-q="${esc(s)}" class="${i === ui.sugAt ? "is-hi" : ""}">${esc(s)}</button>`).join("");
    }, 140);
  }
});

document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "Escape") {
    closeNow();
    closeQueue();
    closePopover();
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;
  if (e.key === "Enter" && document.activeElement?.dataset?.act && !["BUTTON", "A"].includes(document.activeElement.tagName)) {
    document.activeElement.click();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    if (!document.getElementById("q")) go("#/floor");
    setTimeout(() => document.getElementById("q")?.focus(), 30);
    return;
  }
  if (e.key === " ") { e.preventDefault(); player.unlock(); player.toggle(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); player.seekBy(5); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); player.seekBy(-5); }
  else if (e.key === "ArrowUp") { e.preventDefault(); player.setVolume(player.volume + 0.05); document.getElementById("volume").value = player.volume; }
  else if (e.key === "ArrowDown") { e.preventDefault(); player.setVolume(player.volume - 0.05); document.getElementById("volume").value = player.volume; }
  else if (e.key === "n" || e.key === "N") player.next();
  else if (e.key === "p" || e.key === "P") player.prev();
  else if (e.key === "l" || e.key === "L") {
    if (player.track) {
      const on = store.toggleLike(player.track);
      toast(on ? "Kept." : "Removed from liked.");
      syncChrome();
    }
  } else if (e.key === "q" || e.key === "Q") {
    if (document.getElementById("queue").dataset.open === "true") closeQueue();
    else openQueue();
  }
});

let dialDrag = null;
document.addEventListener("pointerdown", (e) => {
  const scale = e.target.closest("[data-scale]");
  if (!scale) return;
  if (e.target.closest("[data-act='preview-station']")) return;
  dialDrag = scale;
  scale.setPointerCapture?.(e.pointerId);
  moveNeedle(scale, e.clientX);
});
document.addEventListener("pointermove", (e) => {
  if (!dialDrag) return;
  moveNeedle(dialDrag, e.clientX);
});
document.addEventListener("pointerup", () => {
  if (dialDrag && route().parts[0] === "dial") render();
  else if (dialDrag) paintStation(ui.stationId);
  dialDrag = null;
});
function moveNeedle(scale, clientX) {
  const rect = scale.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const freq = 88 + ((p - 0.03) / 0.94) * 20;
  const station = nearestStation(freq);
  ui.stationId = station.id;
  document.querySelectorAll("[data-needle]").forEach((n) => { n.style.left = freqPct(station.freq) + "%"; });
  document.querySelectorAll("[data-freq]").forEach((n) => { n.textContent = station.freq.toFixed(1); });
  document.querySelectorAll("[data-sname]").forEach((n) => { n.textContent = station.name; });
  document.querySelectorAll("[data-station]").forEach((row) => row.classList.toggle("is-hot", row.dataset.station === station.id));
  document.querySelectorAll(".dial-mark").forEach((m) => m.classList.toggle("is-hot", m.dataset.station === station.id));
}
function paintStation(id) {
  const station = stationById(id);
  if (!station) return;
  document.querySelectorAll("[data-blurb]").forEach((el) => { el.textContent = station.blurb; });
  document.querySelectorAll("[data-city]").forEach((el) => { el.textContent = station.city; });
  const seed = station.seeds[0];
  document.querySelectorAll(".plate-cut").forEach((el) => {
    el.textContent = seed ? `${seed.artist} — ${seed.title}` : "";
  });
}

function bindScrub(el, read) {
  if (!el) return;
  const seek = (ev) => {
    const rect = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    player.seekRatio(p);
    const fill = el.querySelector(".scrub-fill");
    if (fill) fill.style.width = (p * 100) + "%";
  };
  el.addEventListener("pointerdown", (ev) => {
    el.dataset.drag = "1";
    el.setPointerCapture?.(ev.pointerId);
    seek(ev);
  });
  el.addEventListener("pointermove", (ev) => { if (el.dataset.drag === "1") seek(ev); });
  el.addEventListener("pointerup", () => { el.dataset.drag = "0"; });
  el.addEventListener("pointercancel", () => { el.dataset.drag = "0"; });
}

function tick() {
  if (ui.sleepUntil && Date.now() > ui.sleepUntil) {
    ui.sleepUntil = 0;
    player.pause();
    toast("Lights out.");
  }
  const t = player.getTime();
  const d = player.getDuration();
  const now = document.getElementById("time-now");
  const dur = document.getElementById("time-dur");
  if (now) now.textContent = fmt(t);
  if (dur) dur.textContent = fmt(d || player.track?.duration || 0);
  const scrub = document.getElementById("scrub");
  if (scrub && scrub.dataset.drag !== "1" && d) {
    const p = Math.min(100, (t / d) * 100);
    document.getElementById("scrub-fill").style.width = p + "%";
    scrub.setAttribute("aria-valuenow", String(Math.round(p)));
  }
  const nt = document.getElementById("now-time");
  if (nt) nt.textContent = fmt(t);
  const nd = document.getElementById("now-dur");
  if (nd) nd.textContent = fmt(d || 0);
  const nf = document.getElementById("now-fill");
  const ns = document.querySelector("[data-scrub-now]");
  if (nf && ns?.dataset.drag !== "1" && d) nf.style.width = Math.min(100, (t / d) * 100) + "%";
  if (player.playing && Math.floor(t) % 5 === 0) player.persist();
  if (player.playing) document.title = `${player.track?.title || "room tone"} — room tone`;
  else if (!player.cueing) document.title = "room tone";
}

function draw() {
  const canvas = document.getElementById("scope");
  if (canvas && document.body.dataset.now === "open") {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 72;
    if (canvas.width !== Math.floor(w * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "#ff4d3a";
    ctx.beginPath();
    const analyser = player.getAnalyser();
    const playing = player.playing;
    if (analyser && player.mode === "audio" && player.source === "house") {
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * buf.length);
        const y = (buf[i] / 255) * h;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    } else {
      const time = performance.now() / 1000;
      const amp = playing ? h * 0.28 : h * 0.045;
      for (let x = 0; x < w; x++) {
        const y = h / 2
          + Math.sin(x * 0.018 + time * 2.1) * amp * (0.55 + 0.45 * Math.sin(x * 0.004 + time * 0.7))
          + Math.sin(x * 0.047 - time * 3.1) * amp * 0.28;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}

bindScrub(document.getElementById("scrub"));

window.addEventListener("hashchange", render);
player.on("change", () => {
  syncChrome();
  if (document.getElementById("now")?.dataset.open === "true") fillNow();
});

store.load();
player.init(document.getElementById("audio"));
player.volume = store.volume;
document.getElementById("volume").value = String(player.volume);
// A <base> tag (htmlpreview inserts one) would send "#/floor" off to the raw file.
document.addEventListener("click", (event) => {
  const a = event.target.closest?.("a[href]");
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (!href.startsWith("#")) return;
  event.preventDefault();
  go(href);
}, true);

if (!location.hash) location.hash = "#/";
render();
checkHealth().then(() => {
  const note = document.getElementById("line-note");
  if (note) {
    note.textContent = line().ytdlp
      ? "House line is up. Search and audio run through yt-dlp on this machine."
      : "House line is quiet from here. The room will cue a direct extract in your browser, then a picture if it must.";
  }
});
warmYouTube();
setInterval(tick, 250);
setInterval(() => document.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = clock(); }), 10000);
draw();
if ("mediaSession" in navigator) {
  const setSession = () => {
    if (!player.track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: player.track.title,
      artist: player.track.artist,
      album: player.radio?.name || "room tone",
      artwork: player.track.thumb ? [{ src: player.track.thumb, sizes: "480x360", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = player.playing ? "playing" : "paused";
  };
  player.on("change", setSession);
  try {
    navigator.mediaSession.setActionHandler("play", () => player.toggle());
    navigator.mediaSession.setActionHandler("pause", () => player.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => player.next());
    navigator.mediaSession.setActionHandler("previoustrack", () => player.prev());
  } catch { /* ignore */ }
}
