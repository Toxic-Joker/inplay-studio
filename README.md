# InPlay Studio

A self-hosted, real-time football broadcast overlay system for streamers. It sits between the [API-Football](https://api-football.com) live data feed and OBS Studio, letting you trigger professional-grade broadcast graphics — scoreboard, goal/card/sub animations, stats, standings, lineups, radar, other live matches, penalty shootouts, knockout brackets, and socials — from a single Control Panel, with a live camera window reserved for your own webcam.

Two overlay formats ship out of the box: a 16:9 overlay for YouTube/Twitch and a 9:16 overlay for TikTok/Reels/Shorts.

For the full design spec (every panel, every socket event, layout details), see [`INPLAY_STUDIO_SPEC.md`](./INPLAY_STUDIO_SPEC.md).

## Quick start

### 1. Prerequisites

- [Node.js 20+](https://nodejs.org) and npm (or Docker, see below)
- A free or paid [API-Football](https://dashboard.api-football.com/) API key

### 2. Install

```bash
git clone https://github.com/Toxic-Joker/inplay-studio.git
cd inplay-studio
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and paste your API key:

```env
API_FOOTBALL_KEY=your_api_football_key_here
```

### 4. Run

```bash
npm start
```

Then open:

| Page | URL | Purpose |
|---|---|---|
| Control Panel | http://localhost:3000/control-panel.html | Where the streamer triggers everything |
| Main Overlay | http://localhost:3000/main-overlay.html | OBS Browser Source (16:9, 1920×1080) |
| TikTok Overlay | http://localhost:3000/tiktok-overlay.html | OBS Browser Source (9:16, 1080×1920) |

Add the two overlay URLs as **Browser Sources** in OBS at their exact resolutions (1920×1080 and 1080×1920 respectively) — the overlays position everything relative to that fixed canvas size.

### No API key yet?

Turn on **Demo Mode** at the top of the Control Panel. It loads a sample match and lets you preview every panel with realistic mock data — no fixture ID or API key required.

## Running with Docker

```bash
cp .env.example .env      # then edit it with your API key
docker compose up -d
```

This builds and runs the whole app in a single container, with `public/` volume-mounted so overlay HTML edits apply without a rebuild.

```bash
docker compose logs -f     # view logs
docker compose restart     # after changing server.js
docker compose down        # stop
```

## Using it live

1. On the Control Panel, enter a **Fixture ID** (found via the [API-Football docs](https://api-football.com/documentation) → Fixtures → search by team/date) and click **Start Auto-Sync**.
2. The panel polls every 20 seconds, updates the scoreboard, and automatically fires full-screen animations for goals, cards, substitutions, half-time, and full-time.
3. Toggle any panel (Stats, Standings, Lineup, Radar, Other Matches, Penalty, Bracket, Socials) manually at any time — you never need to leave the Control Panel.
4. Place your OBS webcam/game source **below** the overlay Browser Source in the scene stack — a transparent window is reserved for it (toggle **Show alignment guide** in the Camera card to see exactly where).

## Customising

Everything below is editable live from the Control Panel — no code changes needed for day-to-day use:

- **Followed Teams** — the list of clubs/national teams always shown in "Other Matches", persisted in your browser.
- **Socials** — one or more handles that the overlay automatically alternates between.
- **Theme** — accent/kit colors and scoreboard gradient, plus a few competition presets, applied live to every connected overlay.
- **Background** — any image URL, or auto-pick one based on the tracked competition (falls back to a blurred league badge).

For deeper customisation (fonts, panel sizing, adding a new panel), edit the three files in `public/` — each is a self-contained HTML/CSS/JS file with no build step.

## Project structure

```
inplay-studio/
├── server.js                 # Express + Socket.io backend, API-Football proxy
├── public/
│   ├── control-panel.html    # Streamer's dashboard
│   ├── main-overlay.html     # OBS overlay, 16:9 (1920×1080)
│   └── tiktok-overlay.html   # OBS overlay, 9:16 (1080×1920)
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── INPLAY_STUDIO_SPEC.md     # Full design spec
```

## API reference

All endpoints are served by the backend at `http://localhost:3000`:

| Endpoint | Returns |
|---|---|
| `GET /api/match/:fixtureId` | Live score, scorers, time, raw events |
| `GET /api/statistics/:fixtureId` | Match stats (possession, shots, cards, etc.) |
| `GET /api/lineups/:fixtureId` | Starting XI, formation, events, captain |
| `GET /api/standings/:league/:season` | Top 14 league table |
| `GET /api/live-matches?excludeId=&vipTeams=&leagues=` | Other live matches, filtered |
| `GET /api/radar/:fixtureId` | Possession %, xG |
| `GET /api/bracket/:league/:season` | Knockout bracket with two-legged aggregation |
| `GET /api/penalty/:fixtureId` | Penalty shootout results |

See [`INPLAY_STUDIO_SPEC.md`](./INPLAY_STUDIO_SPEC.md) for full response shapes and the Socket.io event payloads used between the Control Panel and the overlays.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free to use, modify, and share for any noncommercial purpose. Commercial use requires a separate agreement with the copyright holder.
