# InPlay Studio — Complete Project Specification
### A Live Football Broadcast Overlay System for Streamers

---

## Table of Contents
1. [Project Vision](#1-project-vision)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [File Structure](#4-file-structure)
5. [The Three Core Files](#5-the-three-core-files)
6. [Overlay Panels — Complete Feature Reference](#6-overlay-panels--complete-feature-reference)
7. [Control Panel — Complete Feature Reference](#7-control-panel--complete-feature-reference)
8. [Customisation Guide (For Friends)](#8-customisation-guide-for-friends)
9. [Docker Setup](#9-docker-setup)
10. [API Reference](#10-api-reference)
11. [Known Quirks & Solutions](#11-known-quirks--solutions)
12. [Design Guidelines](#12-design-guidelines)

---

## 1. Project Vision

**InPlay Studio** is a self-hosted, real-time football broadcast overlay system. It sits between a live football data API and OBS Studio (or any browser-source streaming tool) to produce professional-grade graphics that appear on stream.

The streamer operates a **Control Panel** (a web page open on their second screen or phone) to trigger and control what appears on screen. The **Overlay** (a browser source in OBS) receives commands instantly via WebSockets and animates the graphics. There is also a **TikTok Overlay** — a vertically cropped, 9:16 version of the same system.

### What it does
- Displays a live scoreboard with real team names, logos, and a live match clock
- Shows goal scorers below the score bar as a smooth, infinite scrolling ticker
- Triggers a full-screen animated event card (goal, red card, substitution, half-time, etc.)
- Displays a live pitch mini-map / radar showing possession and xG
- Shows a match statistics panel (possession, shots, corners, offsides, fouls, cards, saves)
- Displays the league standings table (top 14 teams)
- Shows a tactical formation lineup with player names, numbers, and live event icons (goals ⚽, assists 🅰️, yellow cards 🟨, red cards 🟥, substitutions ↕️, captains ©)
- Shows a penalty shootout bar with scored/missed circles per team, live-updating
- Shows a knockout bracket (R16 through Final) with score aggregation for two-legged ties
- Shows other live matches happening simultaneously (filtered to elite teams/leagues only, no women's teams, no reserve teams)
- Displays a social media handle card
- Shows a global alert bar (Half Time, Full Time, etc.)
- Works for both 16:9 (YouTube/Twitch) and 9:16 (TikTok/Reels) simultaneously

### The golden rule
The streamer should **never need to leave the Control Panel** during a live stream. Every visual element is triggered by a single click. The system auto-detects goals, substitutions, cards, and triggers the appropriate animations automatically.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STREAMER'S MACHINE                           │
│                                                                     │
│  ┌──────────────────┐        ┌────────────────────────────────────┐ │
│  │  Control Panel   │        │         Node.js Server             │ │
│  │  (Browser Tab)   │──────▶ │  Express + Socket.io + Axios       │ │
│  │  port :3000/     │        │  port :3000                        │ │
│  │  control-panel   │◀────── │                                    │ │
│  └──────────────────┘        │  REST endpoints:                   │ │
│                               │  /api/match/:id                   │ │
│                               │  /api/statistics/:id              │ │
│                               │  /api/lineups/:id                 │ │
│                               │  /api/standings/:league/:season   │ │
│                               │  /api/live-matches                │ │
│                               │  /api/radar/:id                   │ │
│                               │  /api/bracket/:league/:season     │ │
│                               │  /api/penalty/:id                 │ │
│                               └──────────────┬─────────────────── ┘ │
│                                              │                      │
│                               ┌──────────────▼─────────────────── ┐ │
│                               │      API-Football v3               │ │
│                               │  (v3.football.api-sports.io)       │ │
│                               └────────────────────────────────── ┘ │
│                                              │ WebSocket broadcast  │
│              ┌───────────────────────────────▼──────────────────┐   │
│              │               OBS Studio                          │   │
│              │                                                   │   │
│              │  Browser Source 1: main-overlay.html (1920×1080) │   │
│              │  Browser Source 2: tiktok-overlay.html (1080×1920)│  │
│              └───────────────────────────────────────────────── ┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Communication flow
1. Streamer opens `http://localhost:3000/control-panel.html` in a browser
2. Streamer enters a **Fixture ID** (from API-Football) and clicks "Start Auto-Sync"
3. The server starts polling `api-football` every 20 seconds
4. On every poll: if the score changes, goals/cards/subs are detected and a `FULL_SCREEN_EVENT` is automatically broadcast via Socket.io
5. The streamer can also manually trigger any panel at any time
6. OBS browser sources listen on the same Socket.io connection and animate instantly

---

## 3. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Server runtime | **Node.js 20 LTS** | Stable, widely supported |
| Web framework | **Express 4** | Simple REST + static file serving |
| Real-time comms | **Socket.io 4** | WebSocket with fallback, works through OBS's browser |
| API client | **Axios** | Clean HTTP client with interceptors |
| Data source | **API-Football v3** (api-sports.io) | Best live football data API, affordable |
| Frontend | **Vanilla HTML/CSS/JS** | No build step, loads instantly in OBS |
| Fonts | **Google Fonts** (Rajdhani + Inter) | Rajdhani for bold sport displays, Inter for UI |
| Icons | **Font Awesome 6** (CDN) | Football icons, social icons, card icons |
| Containerisation | **Docker + Docker Compose** | One command to run everywhere |
| Environment config | **dotenv** | Keep API keys out of code |

---

## 4. File Structure

```
inplay-studio/
│
├── docker-compose.yml          ← Run everything with one command
├── Dockerfile                  ← Node.js container definition
├── .env                        ← Your secrets (API key) — NEVER commit this
├── .env.example                ← Template for friends to copy
├── .gitignore
├── package.json
│
└── public/                     ← Everything in here is served as static files
    ├── control-panel.html      ← The streamer's dashboard
    ├── main-overlay.html       ← OBS browser source (16:9, 1920×1080)
    └── tiktok-overlay.html     ← OBS browser source (9:16, 1080×1920)
│
└── server.js                   ← The backend (API proxy + WebSocket hub)
```

> **Important:** All three HTML files are self-contained single-file apps. They use CDN links for Font Awesome and Google Fonts. There is no bundler, no npm install for the frontend.

---

## 5. The Three Core Files

### 5.1 `server.js`
The backend. Responsibilities:
- Serve the `public/` folder as static files
- Proxy API-Football requests (keeps the API key secret from the browser)
- Act as a WebSocket hub: the Control Panel sends `update_overlay` events, the server re-broadcasts them as `sync_overlay` to all connected overlays
- Auto-detect goals, cards, and substitutions by comparing the previous and current match state
- Format raw API data into clean objects the frontend can use directly

### 5.2 `control-panel.html`
The streamer's dashboard. Responsibilities:
- Input field for the **Fixture ID** (the match to track)
- "Start Auto-Sync" button that begins polling the server every 20 seconds
- Buttons to manually show/hide every overlay panel
- Manual event triggers (goal home, goal away, yellow card, red card, substitution, half-time, full-time, etc.)
- Smart auto-trigger brain: automatically fires `FULL_SCREEN_EVENT` when score/events change
- Goal scorer resolver: 3-layer fallback to find the correct scorer name even when API events lag behind the score update
- Live score memory to detect changes between polls

### 5.3 `main-overlay.html` (and `tiktok-overlay.html`)
The OBS overlay. Responsibilities:
- Listen to Socket.io events and update the DOM accordingly
- All panels start hidden (`transform: translateX(±120%)`) and slide in when shown
- Every panel is absolutely positioned for a 1920×1080 canvas
- Smooth CSS transitions for all show/hide operations
- Seamless infinite scrolling ticker for goal scorers (CSS `@keyframes` with a JS-calculated duration)

---

## 6. Overlay Panels — Complete Feature Reference

### Layout grid (1920×1080)
```
┌──────────────────────────────────────────────────────────────────┐
│  [camera hole top-left, ~350×350px]    [camera hole, same right] │
│                                                                  │
│  LEFT COLUMN (x=20px)     CENTER          RIGHT COLUMN (x=right)│
│  ┌────────────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │ Stats / Stand. │    │          │    │ Lineup / Bracket     │  │
│  │ (400px wide)   │    │  RADAR   │    │ (380px wide)         │  │
│  │                │    │          │    │                      │  │
│  │ top: 120px     │    │ centered │    │ top: 120px           │  │
│  └────────────────┘    └──────────┘    └──────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              SCOREBOARD (full width, ~90px tall)         │    │
│  │   [home logo] [home name] [home score]:[away score]...   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────┐                    ┌──────────────────────┐  │
│  │ Other Matches  │                    │ Socials card         │  │
│  │ bottom: 30px   │                    │ bottom: 30px, right  │  │
│  └────────────────┘                    └──────────────────────┘  │
│                                                                  │
│  [PENALTY BAR — floats at bottom of camera hole when active]     │
│  [FULL SCREEN EVENT — covers entire canvas, z-index highest]     │
│  [GLOBAL ALERT — full-width banner, half-time / full-time]       │
└──────────────────────────────────────────────────────────────────┘
```

---

### Panel 1: Scoreboard
**Always visible** once the overlay loads.

| Property | Detail |
|---|---|
| Position | Full width, top of screen |
| Height | ~90px |
| CSS IDs | `full-scoreboard-wrapper`, `display-home-team`, `display-away-team`, `display-home-score`, `display-away-score`, `display-time`, `home-logo`, `away-logo` |
| Socket event | `LIVE_UPDATE` |

**What it shows:**
- Home team logo (left edge, absolutely positioned)
- Away team logo (right edge, absolutely positioned)
- Home team name (left, truncated if too long)
- Score (center, large digits with a divider)
- Match time (below score, e.g. `45'`, `HT`, `FT`)
- Away team name (right)
- Goal scorers row below: each team's goals shown as a seamless infinite scrolling ticker `"MBAPPÉ 34' ⚽ • DEMBÉLÉ 67' ⚽"`. The ticker only scrolls if the text overflows its container. It never resets/glitches mid-scroll — the animation only restarts when the scorer text actually changes.

**Data received from socket:**
```json
{
  "homeTeam": "Paris Saint Germain",
  "awayTeam": "Marseille",
  "homeScore": 2,
  "awayScore": 0,
  "time": "67'",
  "homeLogo": "https://...",
  "awayLogo": "https://...",
  "homeScorers": "MBAPPÉ 34' ⚽ • DEMBÉLÉ 67' ⚽",
  "awayScorers": ""
}
```

---

### Panel 2: Match Stats
**Left column panel, slides in from the left.**

| Property | Detail |
|---|---|
| Position | `left: 20px`, `top: 120px`, `width: 400px`, `min-height: 670px` |
| CSS class | `.stats-container`, toggled with `.visible` |
| Socket event | `TOGGLE_STATS` with `{ show: true/false, ...stats }` |

**What it shows:**
9 stat rows, each with home value, a split bar (home color | away color, widths represent proportions), and away value:
1. Possession (%)
2. Shots (Total)
3. On Target
4. Passes (%)
5. Corners
6. Offsides
7. Fouls
8. Yellow Cards
9. GK Saves

Team logos at the bottom of the panel.

The bar for each stat uses the team's primary kit color (`--home-color`, `--away-color` CSS variables set dynamically from the API lineup data).

---

### Panel 3: Standings Table
**Left column panel, slides in from the left (mutually exclusive with Stats — hiding Stats shows Standings).**

| Property | Detail |
|---|---|
| Position | Same as Stats panel (they replace each other) |
| CSS class | `.standings-container` |
| Socket event | `TOGGLE_STANDINGS` with `{ show: true, title, logo, table[] }` |

**What it shows:**
- League logo + name in header
- 14 rows: `#` rank, team logo, team name, MP (matches played), GD (goal difference), PTS (points, in gold)

---

### Panel 4: Lineup
**Right column panel, slides in from the right.**

| Property | Detail |
|---|---|
| Position | `right: 20px`, `top: 120px`, `width: 380px` |
| CSS class | `.lineup-container` |
| Socket event | `SHOW_LINEUPS` |

**What it shows:**
- Team logo + name + formation (e.g. `4-3-3`) in the header
- A rendered pitch (dark green with white lines — halfway line, center circle, penalty boxes)
- Players positioned according to their API grid coordinates, displayed as circles with jersey number
- Player's short name (last name) below the circle
- Live event icons overlaid on each player: `⚽` goal, `🅰️` assist, `🟨` yellow, `🟥` red, `↕️` sub (with incoming player's name and number shown below)
- Captain marked with `©`
- The overlay auto-refreshes lineup data every 30 seconds to pick up substitutions during the match

**Which team is shown:**
The Control Panel has "Show Home Lineup" and "Show Away Lineup" buttons. The overlay shows one team at a time.

**Player data structure from server:**
```json
{
  "home": {
    "name": "Manchester City",
    "logo": "https://...",
    "formation": "4-3-3",
    "primaryColor": "#6CABDD",
    "secondaryColor": "#FFFFFF",
    "rows": [
      [{ "number": 31, "name": "Ederson", "events": [], "isCaptain": false }],
      [{ "number": 2, "name": "Walker", "events": ["yc"], "isCaptain": false }],
      ...
    ]
  }
}
```

---

### Panel 5: Radar / Mini-Map
**Center panel, visible below the scoreboard.**

| Property | Detail |
|---|---|
| Position | Centered horizontally, below scoreboard |
| CSS class | `.radar-wrapper` |
| Socket event | `TOGGLE_RADAR` |

**What it shows:**
- A stylised top-down football pitch (SVG lines)
- xG values for each team (left panel = home, right panel = away)
- A possession badge in the center of the pitch that drifts left or right based on which team has >55% possession
- The badge shows the dominant team's logo + "DANGEROUS ATTACK" text
- At half-time / full-time: a status overlay slides over the radar showing "MI-TEMPS" or "TEMPS RÉGLEMENTAIRE" with both team logos

**Radar event overlay:**
When a goal/card event fires, a temporary overlay appears over the radar for a few seconds showing the event icon and team name (e.g. "BUT! BUT! BUT!" with the team logo), then fades out.

---

### Panel 6: Other Live Matches
**Bottom left panel, anchored `bottom: 30px`.**

| Property | Detail |
|---|---|
| Position | `left: 20px`, `bottom: 30px`, `width: 400px` |
| CSS class | `.matches-container` |
| Socket event | `TOGGLE_MATCHES` |

**What it shows:**
- "OTHER MATCHES" header with a live time badge
- One match at a time: home logo + name + score vs away logo + name + score
- Pagination dots at the bottom (one dot per match, active dot highlighted green)
- If more than one match, cycles every 8 seconds with a crossfade animation
- Shows maximum 8 matches

**Filtering rules (server-side):**
- **VIP teams**: exact name match only (not substring, to avoid "Arsenal Sarandi" etc.)
- **Major leagues**: Premier League (39), La Liga (140), Bundesliga (78), Serie A (135), Ligue 1 (61), Champions League (2)
- **Always excluded**: women's teams (` W`, `Women`, `Féminin`), reserve/B teams (`II`, `B`, `Reserves`), youth teams (`U18`, `U21`, `U23`)
- The current match (being tracked) is always excluded

**Panel behaviour:**
- Once shown, stays visible permanently (like the stats bar)
- Does NOT disappear/reappear on data updates — only the inner card crossfades
- Only hides when the streamer clicks "Hide Matches"

---

### Panel 7: Penalty Shootout Bar
**Floats inside/below the camera hole area, slides down to hide.**

| Property | Detail |
|---|---|
| Position | Bottom of camera hole, centered |
| CSS class | `.penalty-bar` |
| Socket event | `TOGGLE_PENALTY` |

**What it shows:**
- "PENALTY" label tab
- Home team name
- Competition logo (center badge)
- Away team name
- For each team: a row of circles — filled green ✓ for scored, red ✗ for missed, empty for not yet taken
- Auto-refreshes every 10 seconds during a penalty shootout

---

### Panel 8: Knockout Bracket
**Full-screen overlay.**

| Property | Detail |
|---|---|
| Position | Full 1920×1080, `z-index: 2000` |
| CSS class | `.bracket-panel` |
| Socket event | `TOGGLE_BRACKET` |

**What it shows:**
- Competition logo + name
- R16 → QF → SF → Final bracket tree
- Each matchup: home logo, home score (aggregate), away score (aggregate), away logo
- Winner's logo is full opacity, loser's is dimmed
- Handles two-legged ties correctly (server aggregates both legs)
- Handles third-place matches

---

### Panel 9: Socials Card
**Bottom right corner.**

| Property | Detail |
|---|---|
| Position | `right: 20px`, `bottom: 30px` |
| CSS class | `.socials-container` |
| Socket event | `TOGGLE_SOCIALS` |

**What it shows:**
- Platform logo (X/Twitter, Instagram, TikTok, YouTube — configurable)
- Handle (e.g. `@YourHandle`)

---

### Panel 10: Full-Screen Event
**Highest z-index, covers everything.**

| Property | Detail |
|---|---|
| Position | Full 1920×1080, `z-index: 9999` |
| CSS class | `.fs-event-container` |
| Socket event | `FULL_SCREEN_EVENT` |
| Auto-hide | After ~4 seconds |

**Event types and what they display:**

| Type | Title | Icon | Player line |
|---|---|---|---|
| `goal` | `GOAL!` | ⚽ spinning | Scorer name |
| `owngoal` | `BUT CSC!` | ⚽ | Scorer name |
| `yellowcard` | `CARTON JAUNE` | 🟨 | Player name |
| `redcard` | `CARTON ROUGE` | 🟥 | Player name |
| `sub` | `REMPLACEMENT` | ↕️ | Player out name + player in name |
| `halftime` | `MI-TEMPS` | ⏸️ | — |
| `fulltime` | `TEMPS RÉGLEMENTAIRE` | 🏁 | — |
| `var` | `VAR` | 📺 | Decision text |

**Goal scorer auto-detection (3-layer fallback):**
1. Search `rawEvents` array for the most recent `Goal` event matching the correct team ID
2. If not found (API lag), parse the already-formatted `homeScorers`/`awayScorers` string to extract the last name
3. If still not found, display "BUT POUR [TEAM NAME]" immediately, then retry the API after 5 seconds and update the overlay if the name becomes available

---

### Panel 11: Global Alert
**Full-width banner, slides down from above the scoreboard.**

| Property | Detail |
|---|---|
| Socket event | `GLOBAL_ALERT` with `{ text: "HALF TIME", sub: "The match resumes shortly" }` |
| Auto-hide | After a configurable timeout |

---

## 7. Control Panel — Complete Feature Reference

### Layout
Three-column layout:
- **Left column**: Match info, sync controls, score display
- **Center column**: Manual event buttons (goal, card, sub, etc.)
- **Right column**: Panel toggles (stats, standings, lineup, matches, radar, bracket, socials, penalty)

### Auto-Sync brain
When "Start Auto-Sync" is clicked:
1. Immediately fetches `/api/match/:fixtureId`
2. Updates the control panel display (teams, score, time)
3. Compares new score against `memoryHomeScore` / `memoryAwayScore`
4. If home score increased → calls `triggerGoalEvent('home', liveData, fixtureId)`
5. If away score increased → calls `triggerGoalEvent('away', liveData, fixtureId)`
6. Checks events for new yellow cards, red cards, substitutions → triggers appropriate `FULL_SCREEN_EVENT`
7. Repeats every 20 seconds
8. Auto-detects half-time and full-time status changes

### Stats auto-sync
When "Show Stats" is clicked:
- Fetches stats immediately
- Starts a 60-second interval to refresh stats
- Broadcasts `TOGGLE_STATS` with the new data on every refresh

### Lineup auto-sync
When "Show Lineup" is clicked:
- Fetches lineups immediately
- Starts a 30-second interval (picks up substitutions during the match)
- The lineup panel on the overlay auto-updates without sliding out and back in

---

## 8. Customisation Guide (For Friends)

This section is for anyone who wants to run their own version of InPlay Studio.

### Step 1: Get an API key
Sign up at [api-football.com](https://api-football.com) (or api-sports.io). The **free tier** gives 100 requests/day which is enough for testing. For live streaming, a paid plan (~$20/month) gives you unlimited or high-quota access.

### Step 2: Create your `.env` file
Copy `.env.example` to `.env` and fill in your key:
```env
API_FOOTBALL_KEY=your_key_here
```

### Step 3: Customize your brand
Open `public/control-panel.html` and find the `// ── CONFIGURATION ──` section near the top of the `<script>` tag. Change:

```javascript
const CONFIG = {
  // Your social media handle and platform
  socialHandle: "@YourHandle",
  socialPlatform: "twitter",   // "twitter" | "instagram" | "tiktok" | "youtube"

  // Your VIP teams — these will be shown in "Other Matches"
  // Use EXACT names as they appear in API-Football
  vipTeams: [
    "Barcelona", "Real Madrid", "Manchester City", "Arsenal",
    // ... add your favorites here
  ],

  // Major league IDs to always show in "Other Matches"
  // Common IDs: 39=EPL, 140=LaLiga, 78=Bundesliga, 135=SerieA, 61=Ligue1, 2=UCL
  majorLeagueIds: [39, 140, 78, 135, 61, 2],
};
```

### Step 4: Change colors
Open `public/main-overlay.html` and find the `:root` CSS variables at the top of the `<style>` tag:

```css
:root {
  /* Main accent color (used for highlights, active elements) */
  --accent: #00e5ff;

  /* Scoreboard background gradient */
  --scoreboard-bg-start: #0a1426;
  --scoreboard-bg-end:   #121f36;

  /* Default team colors (overridden dynamically from API kit colors) */
  --home-color: #4fc3f7;
  --away-color: #ef5350;

  /* Panel backgrounds */
  --panel-bg: rgba(10, 20, 38, 0.95);
  --panel-border: rgba(255, 255, 255, 0.2);
}
```

### Step 5: Change fonts
Replace the Google Fonts import at the top:
```html
<link href="https://fonts.googleapis.com/css2?family=YOUR_FONT:wght@400;700&display=swap" rel="stylesheet">
```
Then update `font-family` in the CSS.

### Step 6: Find a Fixture ID
Go to [api-football.com/documentation](https://api-football.com/documentation) → Fixtures → Search by team or date. Or use their API explorer. The fixture ID is a number like `1035274`.

---

## 9. Docker Setup

The entire project runs in a single Docker container. No need to install Node.js, npm, or manage versions manually.

### `Dockerfile`
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source files
COPY server.js ./
COPY public/ ./public/

# Expose the single port the app uses
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
```

### `docker-compose.yml`
```yaml
version: "3.9"

services:
  inplay-studio:
    build: .
    container_name: inplay-studio
    restart: unless-stopped
    ports:
      - "3000:3000"        # Access at http://localhost:3000
    env_file:
      - .env               # Loads your API_FOOTBALL_KEY automatically
    volumes:
      - ./public:/app/public   # Hot-reload: edit HTML files without rebuilding
```

### `.env.example`
```env
# Copy this file to .env and fill in your API key
# Get your key at: https://dashboard.api-football.com/

API_FOOTBALL_KEY=your_api_football_key_here
```

### `.gitignore`
```
node_modules/
.env
*.log
```

### `package.json`
```json
{
  "name": "inplay-studio",
  "version": "2.0.0",
  "description": "Live football broadcast overlay for OBS",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

### Running it

**First time:**
```bash
# 1. Clone/download the project
cd inplay-studio

# 2. Copy the env template
cp .env.example .env

# 3. Edit .env and paste your API key
nano .env   # or open with any text editor

# 4. Start with Docker
docker compose up -d

# 5. Open your browser
open http://localhost:3000/control-panel.html
```

**Updating the overlay HTML** (no rebuild needed because of the volume mount):
```bash
# Just edit the HTML files in public/ — changes are live instantly
```

**Restarting after server.js changes:**
```bash
docker compose restart
```

**Viewing logs:**
```bash
docker compose logs -f
```

**Stopping:**
```bash
docker compose down
```

---

## 10. API Reference

All endpoints are served by the Node.js backend at `http://localhost:3000`.

### `GET /api/match/:fixtureId`
Returns live match data.

**Response:**
```json
{
  "time": "67'",
  "homeTeam": "Barcelona",
  "awayTeam": "Real Madrid",
  "homeScore": 2,
  "awayScore": 1,
  "homeScorers": "LEWANDOWSKI 23' ⚽ • PEDRI 55' ⚽",
  "awayScorers": "VINICIUS 40' ⚽",
  "homeLogo": "https://...",
  "awayLogo": "https://...",
  "leagueId": 140,
  "season": 2024,
  "homeTeamId": 529,
  "awayTeamId": 541,
  "rawEvents": [...]
}
```

### `GET /api/statistics/:fixtureId`
Returns match stats for the stats panel.

### `GET /api/lineups/:fixtureId`
Returns starting XI with formation grid, player events, captain info.

### `GET /api/standings/:leagueId/:season`
Returns top 14 teams in the league table.

### `GET /api/live-matches?excludeId=:fixtureId`
Returns up to 8 other live matches (filtered, no women's/reserve teams).

### `GET /api/radar/:fixtureId`
Returns possession %, xG, and possession state for the radar panel.

### `GET /api/bracket/:leagueId/:season`
Returns knockout bracket with aggregated two-legged scores.

### `GET /api/penalty/:fixtureId`
Returns penalty shootout data (list of `"scored"` or `"missed"` per team).

---

## 11. Known Quirks & Solutions

### Goal scorer timing lag
**Problem:** API-Football sometimes updates the score 5–10 seconds before the events array reflects the new goal. So when the system detects a score change and searches `rawEvents` for the scorer, it finds nothing.

**Solution:** Three-layer fallback in `triggerGoalEvent()`:
1. Search `rawEvents` for a `Goal` event matching the team ID (fastest, works when in sync)
2. Parse the `homeScorers`/`awayScorers` string (already formatted server-side from a separate code path)
3. Show "BUT POUR [TEAM]" immediately, then silently re-fetch after 5 seconds and update the overlay with the real name

### Seamless scorer ticker glitch
**Problem:** Every `LIVE_UPDATE` socket event was calling `updateSeamlessMarquee()` which reset `animation: none` immediately, causing the ticker to jump/stutter on the loop point.

**Solution:** Cache the last text value per element in `_marqueeCache`. If the text hasn't changed AND an animation is already running, return early without touching the DOM. Only restart the animation when the text actually changes.

### Other Matches panel flickering
**Problem:** The panel was toggling off and on with each data update because `updateMatchesUI()` always started with a fade-out even on first render.

**Solution:** Added an `animate` boolean parameter. First render (`animate=false`) applies data instantly with no fade. Subsequent interval ticks (`animate=true`) fade the inner card only. The panel container itself never gets its `.visible` class removed unless the streamer explicitly hides it.

### VIP team substring matching
**Problem:** `vipTeams.some(vip => name.includes(vip))` would match "Inter de Bebedouro" (because "Inter" is in the VIP list) and "Arsenal Sarandi" (because "Arsenal" matches).

**Solution:** Exact name matching — the team name must equal the VIP name exactly, OR start with it followed by a non-word character (space before "FC" etc.). Combined with a regex exclusion list for women's/reserve/youth teams that runs before the VIP check.

### API-Football league IDs reference
```
39  = English Premier League
140 = Spanish La Liga
78  = German Bundesliga
135 = Italian Serie A
61  = French Ligue 1
2   = UEFA Champions League
3   = UEFA Europa League
848 = UEFA Conference League
15  = AFCON
1   = FIFA World Cup
4   = UEFA European Championship
```

---

## 12. Design Guidelines

### Visual language
- **Dark navy** backgrounds (`#0a1426`, `#121f36`) — feels like a broadcast control room
- **Accent cyan** (`#00e5ff`) for active states, borders, highlights
- **Rajdhani** font for all display text (scores, names, labels) — bold, angular, sports-broadcast feel
- **Inter** font for UI text (control panel, small labels)
- Panels slide in from off-screen with a `cubic-bezier(0.25, 1, 0.5, 1)` easing — a quick start, gentle landing
- Team colors from the API (kit primary/secondary) are applied dynamically to stat bars and player circles
- All panels share the same border style: `2px solid rgba(255,255,255,0.2)` with `box-shadow: 5px 5px 25px rgba(0,0,0,0.6)`

### The 1920×1080 canvas rule
OBS browser sources render at exactly 1920×1080. The overlay body is `overflow: hidden` and all panel positions are fixed/absolute with pixel values. Do not use viewport units (`vw`, `vh`) — they behave unexpectedly in OBS's browser engine. Use pixels only.

### Panel sizing targets
| Panel | Width | Target height | Notes |
|---|---|---|---|
| Stats | 400px | 670px min | Matches lineup height |
| Standings | 400px | ~670px | 14 rows × 43px + headers |
| Lineup | 380px | ~670px | Header 120px + pitch 520px + margins |
| Other Matches | 400px | ~140px | Anchored to bottom |
| Radar | ~800px | ~200px | Centered |

### TikTok overlay differences
The `tiktok-overlay.html` is a 9:16 vertical canvas (1080×1920). The same Socket.io events drive it. Key differences:
- Scoreboard is at the top, full width
- Panels are stacked vertically instead of side-by-side
- Font sizes are slightly larger for small-screen readability
- The lineup panel is narrower and centered
- Margins and positioning are recalculated for the portrait format
- Everything else (event handling, marquee, panel logic) is identical to `main-overlay.html`

---

*Built for streamers, by a streamer. Questions? Check the API-Football docs at [api-football.com/documentation](https://api-football.com/documentation).*
