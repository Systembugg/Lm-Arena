function cut(id, title, artist, duration) {
  return {
    id,
    title,
    artist,
    duration,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

export const STATIONS = [
  {
    id: "paper",
    num: "01",
    name: "Paper",
    freq: 88.9,
    city: "Small room",
    color: "#c4b49a",
    blurb: "Voice, guitar, and the noise of the take. Nothing arranged for a crowd.",
    query: "nick drake vashti bunyan sibylle baier folk audio",
    seeds: [
      cut("xqe6TF2y8i4", "Pink Moon", "Nick Drake", 180),
      cut("jvLtyyBRITo", "Place to Be", "Nick Drake", 161),
    ],
  },
  {
    id: "drift",
    num: "02",
    name: "Drift",
    freq: 91.2,
    city: "Environmental",
    color: "#7f8b72",
    blurb: "Music that furnishes a room and then leaves it alone.",
    query: "hiroshi yoshimura brian eno ambient environmental music",
    seeds: [
      cut("TO8kwMJuSvU", "Green", "Hiroshi Yoshimura", 315),
      cut("OlaTeXX3uH8", "An Ending (Ascent)", "Brian Eno", 262),
    ],
  },
  {
    id: "dust",
    num: "03",
    name: "Dust",
    freq: 93.6,
    city: "Addis, late",
    color: "#b08a45",
    blurb: "Ethio-jazz. A minor key with a brass section that refuses to hurry.",
    query: "mulatu astatke ethio jazz hailu mergia",
    seeds: [
      cut("jwdBRqIsVUY", "Yèkèrmo Sèw", "Mulatu Astatke", 254),
      cut("Wy-v-FgiUD8", "Tezeta", "Mulatu Astatke", 377),
    ],
  },
  {
    id: "heat",
    num: "04",
    name: "Heat",
    freq: 96.0,
    city: "Open window",
    color: "#c45032",
    blurb: "Afrobeat with the horns standing up. Long cuts welcome.",
    query: "fela kuti tony allen afrobeat",
    seeds: [cut("RHR0tKRxiyY", "Water No Get Enemy", "Fela Kuti", 661)],
  },
  {
    id: "kissa",
    num: "05",
    name: "Kissa",
    freq: 98.7,
    city: "After midnight",
    color: "#8d342c",
    blurb: "Trio jazz, brushed drums, the kind of quiet that has a pulse.",
    query: "chet baker bill evans ahmad jamal jazz trio audio",
    seeds: [
      cut("z4PKzz81m5c", "Almost Blue", "Chet Baker", 454),
      cut("wCINvavqFXk", "Waltz for Debby", "Bill Evans Trio", 414),
      cut("EpVXH3Vm2wg", "My Foolish Heart", "Bill Evans Trio", 296),
    ],
  },
  {
    id: "bay",
    num: "06",
    name: "Bay",
    freq: 101.1,
    city: "Heat on the water",
    color: "#d06a32",
    blurb: "City pop with the windows down. Chorus first, questions later.",
    query: "city pop tatsuro yamashita mariya takeuchi miki matsubara",
    seeds: [
      cut("pqobRu9aR3M", "Sparkle", "Tatsuro Yamashita", 257),
      cut("T_lC2O1oIew", "Plastic Love", "Mariya Takeuchi", 309),
      cut("QNYT9wVwQ8A", "Stay With Me", "Miki Matsubara", 343),
    ],
  },
  {
    id: "salt",
    num: "07",
    name: "Salt",
    freq: 103.5,
    city: "Ipanema, noon",
    color: "#3e6d62",
    blurb: "Bossa, sung close to the microphone.",
    query: "bossa nova stan getz joao gilberto astrud gilberto",
    seeds: [
      cut("v5DZ5clg-bg", "The Girl From Ipanema", "Stan Getz", 175),
      cut("sx0TLkdWFEU", "The Girl From Ipanema", "Stan Getz & João Gilberto", 330),
    ],
  },
  {
    id: "wire",
    num: "08",
    name: "Wire",
    freq: 105.6,
    city: "After the clubs",
    color: "#31404e",
    blurb: "Songs with elbows. Post-punk, new wave, a chorus you can walk to.",
    query: "talking heads television new order post punk",
    seeds: [cut("Fb2q141rMNE", "This Must Be the Place (Naive Melody)", "Talking Heads", 292)],
  },
  {
    id: "concrete",
    num: "09",
    name: "Concrete",
    freq: 107.6,
    city: "Between stations",
    color: "#5c645c",
    blurb: "Electronic music with dirt still on it. No festival drops.",
    query: "boards of canada burial aphex twin selected ambient works",
    seeds: [cut("A2zKARkpDW4", "Dayvan Cowboy", "Boards of Canada", 277)],
  },
];

export function stationById(id) {
  return STATIONS.find((s) => s.id === id) || null;
}

export function nearestStation(freq) {
  return STATIONS.reduce((best, s) => (Math.abs(s.freq - freq) < Math.abs(best.freq - freq) ? s : best));
}

export function stationForHour(date = new Date()) {
  const h = date.getHours();
  const id = h < 6 ? "drift" : h < 11 ? "paper" : h < 16 ? "salt" : h < 20 ? "bay" : h < 23 ? "kissa" : "dust";
  return stationById(id) || STATIONS[4];
}

export function allSeeds() {
  return STATIONS.flatMap((s) => s.seeds.map((t) => ({ ...t, station: s.id, stationName: s.name })));
}

export function catalogSearch(q) {
  const tokens = String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!tokens.length) return [];
  return allSeeds().filter((t) => {
    const hay = `${t.title} ${t.artist} ${t.stationName}`.toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

export function freqPct(freq) {
  return 3 + ((freq - 88) / 20) * 94;
}
