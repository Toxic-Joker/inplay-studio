require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const axios = require('axios');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

if (!API_KEY) {
  console.warn('[InPlay Studio] WARNING: API_FOOTBALL_KEY is not set. API calls will fail.');
}

// ── API-Football client ─────────────────────────────────────────────
const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: { 'x-apisports-key': API_KEY },
  timeout: 10000,
});

// ── Default filtering config for "Other Live Matches" ───────────────
const DEFAULT_MAJOR_LEAGUE_IDS = [39, 140, 78, 135, 61, 2];
const DEFAULT_VIP_TEAMS = [
  'Barcelona', 'Real Madrid', 'Manchester City', 'Arsenal',
];
const EXCLUDE_PATTERNS = [
  /\bwomen\b/i, /\bféminin\b/i, / w$/i,
  /\bII\b/, /\breserves?\b/i, /\bb$/i,
  /\bu1[0-9]\b/i, /\bu2[0-9]\b/i,
];

function isExcludedTeam(name) {
  return EXCLUDE_PATTERNS.some((re) => re.test(name));
}

function isVipTeam(name, vipTeams) {
  return vipTeams.some((vip) => {
    if (name === vip) return true;
    if (name.startsWith(vip)) {
      const next = name.charAt(vip.length);
      return next === '' || /\W/.test(next);
    }
    return false;
  });
}

function parseCsvParam(value, fallback) {
  if (!value) return fallback;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Formatters: turn raw API-Football payloads into clean objects ──

function formatScorers(events, teamId) {
  return (events || [])
    .filter((e) => e.type === 'Goal' && e.team && e.team.id === teamId && e.detail !== 'Missed Penalty')
    .map((e) => {
      const minute = e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : '');
      const icon = e.detail === 'Own Goal' ? '⚽ (csc)' : '⚽';
      return `${(e.player.name || '').toUpperCase()} ${minute}' ${icon}`;
    })
    .join(' • ');
}

function formatMatch(fixture) {
  const { fixture: fx, league, teams, goals, events } = fixture;
  const status = fx.status.short;
  let time;
  if (status === 'HT') time = 'HT';
  else if (['FT', 'AET', 'PEN'].includes(status)) time = 'FT';
  else if (status === 'NS') time = "0'";
  else time = `${fx.status.elapsed || 0}'`;

  return {
    fixtureId: fx.id,
    status,
    time,
    homeTeam: teams.home.name,
    awayTeam: teams.away.name,
    homeTeamId: teams.home.id,
    awayTeamId: teams.away.id,
    homeScore: goals.home ?? 0,
    awayScore: goals.away ?? 0,
    homeLogo: teams.home.logo,
    awayLogo: teams.away.logo,
    homeScorers: formatScorers(events, teams.home.id),
    awayScorers: formatScorers(events, teams.away.id),
    leagueId: league.id,
    leagueName: league.name,
    leagueLogo: league.logo,
    season: league.season,
    round: league.round,
    rawEvents: events || [],
  };
}

const STAT_LABELS = {
  'Ball Possession': 'possession',
  'Total Shots': 'shotsTotal',
  'Shots on Goal': 'shotsOnTarget',
  'Passes %': 'passes',
  'Corner Kicks': 'corners',
  'Offsides': 'offsides',
  'Fouls': 'fouls',
  'Yellow Cards': 'yellowCards',
  'Goalkeeper Saves': 'saves',
};

function cleanStatValue(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string' && v.endsWith('%')) return parseInt(v, 10) || 0;
  return v;
}

function formatStatistics(response) {
  const [homeBlock, awayBlock] = response;
  const home = { name: homeBlock?.team?.name, logo: homeBlock?.team?.logo };
  const away = { name: awayBlock?.team?.name, logo: awayBlock?.team?.logo };
  const stats = {};

  Object.values(STAT_LABELS).forEach((key) => {
    stats[key] = { home: 0, away: 0 };
  });

  (homeBlock?.statistics || []).forEach((s) => {
    const key = STAT_LABELS[s.type];
    if (key) stats[key].home = cleanStatValue(s.value);
  });
  (awayBlock?.statistics || []).forEach((s) => {
    const key = STAT_LABELS[s.type];
    if (key) stats[key].away = cleanStatValue(s.value);
  });

  return { home, away, stats };
}

function formatTeamLineup(block, events) {
  if (!block) return null;
  const teamId = block.team.id;
  const rows = {};

  (block.startXI || []).forEach(({ player }) => {
    const [row] = (player.grid || '0:0').split(':').map(Number);
    if (!rows[row]) rows[row] = [];
    const playerEvents = (events || [])
      .filter((e) => e.player && e.player.id === player.id && e.team && e.team.id === teamId)
      .map((e) => {
        if (e.type === 'Goal') return e.detail === 'Own Goal' ? 'og' : 'goal';
        if (e.type === 'Card') return e.detail === 'Yellow Card' ? 'yc' : 'rc';
        if (e.type === 'subst') return 'sub';
        return null;
      })
      .filter(Boolean);

    const assist = (events || []).some(
      (e) => e.assist && e.assist.id === player.id && e.team && e.team.id === teamId
    );
    if (assist) playerEvents.push('assist');

    const subEvent = (events || []).find(
      (e) => e.type === 'subst' && e.player && e.player.id === player.id && e.team && e.team.id === teamId
    );

    rows[row].push({
      number: player.number,
      name: (player.name || '').split(' ').slice(-1)[0],
      events: playerEvents,
      isCaptain: player.captain === true,
      subInName: subEvent?.assist?.name || null,
      subInNumber: null,
    });
  });

  return {
    name: block.team.name,
    logo: block.team.logo,
    formation: block.formation,
    primaryColor: block.team.colors?.player?.primary ? `#${block.team.colors.player.primary}` : '#4fc3f7',
    secondaryColor: block.team.colors?.player?.number ? `#${block.team.colors.player.number}` : '#ffffff',
    rows: Object.keys(rows)
      .sort((a, b) => a - b)
      .map((k) => rows[k]),
  };
}

function formatLineups(response, events) {
  const [homeBlock, awayBlock] = response;
  return {
    home: formatTeamLineup(homeBlock, events),
    away: formatTeamLineup(awayBlock, events),
  };
}

function formatStandings(response) {
  const league = response[0]?.league;
  const table = (league?.standings?.[0] || []).slice(0, 14).map((row) => ({
    rank: row.rank,
    team: row.team.name,
    logo: row.team.logo,
    played: row.all.played,
    goalDiff: row.goalsDiff,
    points: row.points,
  }));

  return {
    title: league?.name,
    logo: league?.logo,
    table,
  };
}

function formatRadar(fixture, statsResponse) {
  const [homeStats, awayStats] = statsResponse || [];
  const getStat = (block, type) => {
    const found = (block?.statistics || []).find((s) => s.type === type);
    return cleanStatValue(found?.value);
  };

  const homePossession = getStat(homeStats, 'Ball Possession') || 50;
  const awayPossession = 100 - homePossession;
  const homeXg = getStat(homeStats, 'expected_goals') || 0;
  const awayXg = getStat(awayStats, 'expected_goals') || 0;

  return {
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeLogo: fixture.teams.home.logo,
    awayLogo: fixture.teams.away.logo,
    homePossession,
    awayPossession,
    homeXg,
    awayXg,
    dominantSide: homePossession > 55 ? 'home' : awayPossession > 55 ? 'away' : null,
    status: fixture.fixture.status.short,
  };
}

async function formatLiveMatches(excludeId, vipTeams, majorLeagueIds) {
  const { data } = await api.get('/fixtures', { params: { live: 'all' } });
  const matches = (data.response || [])
    .filter((fx) => fx.fixture.id !== Number(excludeId))
    .filter((fx) => !isExcludedTeam(fx.teams.home.name) && !isExcludedTeam(fx.teams.away.name))
    .filter(
      (fx) =>
        majorLeagueIds.includes(fx.league.id) ||
        isVipTeam(fx.teams.home.name, vipTeams) ||
        isVipTeam(fx.teams.away.name, vipTeams)
    )
    .slice(0, 8)
    .map((fx) => ({
      fixtureId: fx.fixture.id,
      time: fx.fixture.status.short === 'HT' ? 'HT' : `${fx.fixture.status.elapsed || 0}'`,
      homeTeam: fx.teams.home.name,
      awayTeam: fx.teams.away.name,
      homeLogo: fx.teams.home.logo,
      awayLogo: fx.teams.away.logo,
      homeScore: fx.goals.home ?? 0,
      awayScore: fx.goals.away ?? 0,
    }));

  return matches;
}

function formatPenalty(fixture) {
  const events = (fixture.events || []).filter(
    (e) => e.type === 'Goal' && (e.detail === 'Penalty' || e.detail === 'Missed Penalty')
  );
  const buildRow = (teamId) =>
    events
      .filter((e) => e.team && e.team.id === teamId)
      .map((e) => (e.detail === 'Penalty' ? 'scored' : 'missed'));

  return {
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    homeLogo: fixture.teams.home.logo,
    awayLogo: fixture.teams.away.logo,
    homePenalties: buildRow(fixture.teams.home.id),
    awayPenalties: buildRow(fixture.teams.away.id),
    homeScore: fixture.score?.penalty?.home,
    awayScore: fixture.score?.penalty?.away,
  };
}

const BRACKET_ROUND_ORDER = ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];

async function formatBracket(leagueId, season) {
  const { data } = await api.get('/fixtures', { params: { league: leagueId, season } });
  const fixtures = data.response || [];

  const rounds = BRACKET_ROUND_ORDER.map((roundName) => {
    const roundFixtures = fixtures.filter((fx) => fx.league.round === roundName);

    // Aggregate two-legged ties by unordered team pair.
    const ties = new Map();
    roundFixtures.forEach((fx) => {
      const ids = [fx.teams.home.id, fx.teams.away.id].sort((a, b) => a - b);
      const key = ids.join('-');
      if (!ties.has(key)) {
        ties.set(key, {
          teamA: fx.teams.home,
          teamB: fx.teams.away,
          aggA: 0,
          aggB: 0,
        });
      }
      const tie = ties.get(key);
      const aIsHome = fx.teams.home.id === tie.teamA.id;
      tie.aggA += aIsHome ? fx.goals.home ?? 0 : fx.goals.away ?? 0;
      tie.aggB += aIsHome ? fx.goals.away ?? 0 : fx.goals.home ?? 0;
    });

    return {
      round: roundName,
      matchups: Array.from(ties.values()).map((tie) => ({
        homeTeam: tie.teamA.name,
        homeLogo: tie.teamA.logo,
        homeScore: tie.aggA,
        awayTeam: tie.teamB.name,
        awayLogo: tie.teamB.logo,
        awayScore: tie.aggB,
        winner: tie.aggA === tie.aggB ? null : tie.aggA > tie.aggB ? 'home' : 'away',
      })),
    };
  });

  return { rounds };
}

// ── App setup ────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// ── REST endpoints ───────────────────────────────────────────────────

app.get('/api/match/:fixtureId', async (req, res) => {
  try {
    const { data } = await api.get('/fixtures', { params: { id: req.params.fixtureId } });
    const fixture = data.response[0];
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    res.json(formatMatch(fixture));
  } catch (err) {
    console.error('[match]', err.message);
    res.status(502).json({ error: 'Failed to fetch match data' });
  }
});

app.get('/api/statistics/:fixtureId', async (req, res) => {
  try {
    const { data } = await api.get('/fixtures/statistics', { params: { fixture: req.params.fixtureId } });
    res.json(formatStatistics(data.response));
  } catch (err) {
    console.error('[statistics]', err.message);
    res.status(502).json({ error: 'Failed to fetch statistics' });
  }
});

app.get('/api/lineups/:fixtureId', async (req, res) => {
  try {
    const [lineupsRes, fixtureRes] = await Promise.all([
      api.get('/fixtures/lineups', { params: { fixture: req.params.fixtureId } }),
      api.get('/fixtures', { params: { id: req.params.fixtureId } }),
    ]);
    const events = fixtureRes.data.response[0]?.events || [];
    res.json(formatLineups(lineupsRes.data.response, events));
  } catch (err) {
    console.error('[lineups]', err.message);
    res.status(502).json({ error: 'Failed to fetch lineups' });
  }
});

app.get('/api/standings/:league/:season', async (req, res) => {
  try {
    const { league, season } = req.params;
    const { data } = await api.get('/standings', { params: { league, season } });
    res.json(formatStandings(data.response));
  } catch (err) {
    console.error('[standings]', err.message);
    res.status(502).json({ error: 'Failed to fetch standings' });
  }
});

app.get('/api/live-matches', async (req, res) => {
  try {
    const vipTeams = parseCsvParam(req.query.vipTeams, DEFAULT_VIP_TEAMS);
    const majorLeagueIds = parseCsvParam(req.query.leagues, DEFAULT_MAJOR_LEAGUE_IDS).map(Number);
    const matches = await formatLiveMatches(req.query.excludeId, vipTeams, majorLeagueIds);
    res.json({ matches });
  } catch (err) {
    console.error('[live-matches]', err.message);
    res.status(502).json({ error: 'Failed to fetch live matches' });
  }
});

app.get('/api/radar/:fixtureId', async (req, res) => {
  try {
    const [fixtureRes, statsRes] = await Promise.all([
      api.get('/fixtures', { params: { id: req.params.fixtureId } }),
      api.get('/fixtures/statistics', { params: { fixture: req.params.fixtureId } }),
    ]);
    const fixture = fixtureRes.data.response[0];
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    res.json(formatRadar(fixture, statsRes.data.response));
  } catch (err) {
    console.error('[radar]', err.message);
    res.status(502).json({ error: 'Failed to fetch radar data' });
  }
});

app.get('/api/bracket/:league/:season', async (req, res) => {
  try {
    const { league, season } = req.params;
    res.json(await formatBracket(league, season));
  } catch (err) {
    console.error('[bracket]', err.message);
    res.status(502).json({ error: 'Failed to fetch bracket' });
  }
});

app.get('/api/penalty/:fixtureId', async (req, res) => {
  try {
    const { data } = await api.get('/fixtures', { params: { id: req.params.fixtureId } });
    const fixture = data.response[0];
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    res.json(formatPenalty(fixture));
  } catch (err) {
    console.error('[penalty]', err.message);
    res.status(502).json({ error: 'Failed to fetch penalty data' });
  }
});

// ── Socket.io hub ─────────────────────────────────────────────────────
// The Control Panel emits `update_overlay` events ({ type, payload }).
// The server re-broadcasts them verbatim as `sync_overlay` to every
// connected overlay (main-overlay.html / tiktok-overlay.html).
io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  socket.on('update_overlay', (data) => {
    io.emit('sync_overlay', data);
  });

  socket.on('disconnect', () => {
    console.log(`[socket] client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`InPlay Studio running at http://localhost:${PORT}`);
  console.log(`  Control Panel:  http://localhost:${PORT}/control-panel.html`);
  console.log(`  Main Overlay:   http://localhost:${PORT}/main-overlay.html`);
  console.log(`  TikTok Overlay: http://localhost:${PORT}/tiktok-overlay.html`);
});
