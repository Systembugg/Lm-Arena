# room tone

A listening room with no account. Search, stations, shelves, a queue, and a log that stays in the browser.

Audio is cued live from public YouTube videos. The house line is [yt-dlp](https://github.com/yt-dlp/yt-dlp): search, metadata, playlist import, and a range-aware stream proxy. If that line can’t reach YouTube, the room cues a direct extract in the browser instead.

Nothing is stored on the server. Likes, shelves, history, and the queue live in `localStorage`.

## Run

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

Or `./run.sh`.

Open `/`. No sign-in.

The same files open from any static host. Paths are relative to `static/index.html`, and if that page is not served from `/` the room skips the house line and cues audio in the browser.

## Keys

`space` play · `←` `→` seek · `↑` `↓` volume · `n` next · `p` previous · `l` like · `/` search · `q` queue · `esc` close
