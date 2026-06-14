// pip-pad-worker — PipOS + De-stimulation Video Player
// Deploy to your own domain | KV namespace binding: PIP_KV
// Designed for a child-friendly de-stimulation player on a Raspberry Pi kiosk

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // API routes
    if (path === '/api/yt/search') return handleYTSearch(request, env, cors);
    if (path === '/api/yt/video') return handleYTVideo(request, env, cors);
    if (path === '/api/settings' && request.method === 'GET') return handleGetSettings(request, env, cors);
    if (path === '/api/settings' && request.method === 'POST') return handleSaveSettings(request, env, cors);
    if (path === '/api/pin/verify' && request.method === 'POST') return handleVerifyPin(request, env, cors);
    if (path === '/api/pin/set' && request.method === 'POST') return handleSetPin(request, env, cors);
    if (path === '/api/mode' && request.method === 'POST') return handleSetMode(request, env, cors);

    // Page routes
    if (path === '/admin') return new Response(adminHTML(), { headers: { 'Content-Type': 'text/html', ...cors } });
    if (path === '/player') return new Response(playerHTML(), { headers: { 'Content-Type': 'text/html', ...cors } });
    if (path === '/' || path === '') return new Response(piposHTML(), { headers: { 'Content-Type': 'text/html', ...cors } });

    return new Response('Not found', { status: 404 });
  }
};

// ─────────────────────────────────────────────
// INNERTUBE API — no key needed
// ─────────────────────────────────────────────

async function getInnertubeKey(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36' }
  });
  const html = await res.text();
  const m = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return m ? m[1] : null;
}

async function handleYTSearch(request, env, cors) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  if (!q) return new Response(JSON.stringify({ results: [] }), { headers: { 'Content-Type': 'application/json', ...cors } });

  try {
    // Use InnerTube WEB client — no key required for search
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20250401.00.00',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250401.00.00',
            hl: 'en',
            gl: 'US',
          }
        },
        query: q,
        params: 'EgIQAQ%3D%3D' // filter: videos only
      })
    });

    const data = await res.json();
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const results = contents
      .filter(c => c.videoRenderer)
      .slice(0, 20)
      .map(c => {
        const v = c.videoRenderer;
        const videoId = v.videoId;
        const title = v.title?.runs?.[0]?.text || '';
        const channel = v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '';
        const duration = v.lengthText?.simpleText || '';
        const views = v.viewCountText?.simpleText || '';
        const thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
        return { videoId, title, channel, duration, views, thumb };
      });

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, results: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
}

async function handleYTVideo(request, env, cors) {
  const url = new URL(request.url);
  const videoId = url.searchParams.get('id') || '';
  if (!videoId) return new Response(JSON.stringify({ error: 'no id' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

  try {
    const key = await getInnertubeKey(videoId);
    const endpoint = key
      ? `https://www.youtube.com/youtubei/v1/player?key=${key}`
      : 'https://www.youtube.com/youtubei/v1/player';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 30,
          }
        },
        videoId
      })
    });
    const data = await res.json();
    const details = data?.videoDetails || {};
    return new Response(JSON.stringify({
      videoId,
      title: details.title || '',
      channel: details.author || '',
      description: (details.shortDescription || '').slice(0, 300),
      duration: details.lengthSeconds || 0,
      thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    }), { headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
}

// ─────────────────────────────────────────────
// SETTINGS & PIN
// ─────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  preset: 'calm',
  grayscale: 40,
  contrast: 85,
  brightness: 90,
  sepia: 15,
  saturation: 100,
  speed: 0.85,
  volume: 60,
  localPort: 8765,
  parentMode: false,
};

async function handleGetSettings(request, env, cors) {
  const raw = await env.PIP_KV.get('settings');
  const settings = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
  return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json', ...cors } });
}

async function handleSaveSettings(request, env, cors) {
  const body = await request.json();
  const pin = body.pin;
  const stored = await env.PIP_KV.get('pin') || '0000';
  if (pin !== stored) return new Response(JSON.stringify({ error: 'wrong pin' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors } });
  const current = JSON.parse(await env.PIP_KV.get('settings') || JSON.stringify(DEFAULT_SETTINGS));
  const updated = { ...current, ...body.settings };
  await env.PIP_KV.put('settings', JSON.stringify(updated));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
}

async function handleVerifyPin(request, env, cors) {
  const body = await request.json();
  const stored = await env.PIP_KV.get('pin') || '0000';
  const ok = body.pin === stored;
  return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json', ...cors } });
}

async function handleSetPin(request, env, cors) {
  const body = await request.json();
  const oldPin = body.oldPin;
  const newPin = body.newPin;
  const stored = await env.PIP_KV.get('pin') || '0000';
  if (oldPin !== stored) return new Response(JSON.stringify({ error: 'wrong pin' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors } });
  if (!/^\d{4}$/.test(newPin)) return new Response(JSON.stringify({ error: 'pin must be 4 digits' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  await env.PIP_KV.put('pin', newPin);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
}

async function handleSetMode(request, env, cors) {
  const body = await request.json();
  const pin = body.pin;
  const stored = await env.PIP_KV.get('pin') || '0000';
  if (pin !== stored) return new Response(JSON.stringify({ error: 'wrong pin' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors } });
  const settings = JSON.parse(await env.PIP_KV.get('settings') || JSON.stringify(DEFAULT_SETTINGS));
  settings.parentMode = !!body.parentMode;
  await env.PIP_KV.put('settings', JSON.stringify(settings));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
}

// ─────────────────────────────────────────────
// PIPOS SHELL — root page
// ─────────────────────────────────────────────

function piposHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>PipOS</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; user-select:none; }
  html,body { width:100%; height:100dvh; overflow:hidden; background:#0a0a12; color:#fff; font-family:'Segoe UI',system-ui,sans-serif; }

  /* ── CHILD MODE (default) ── */
  #child-boot {
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#0a0a12; flex-direction:column; gap:24px;
    transition: opacity 0.6s ease;
  }
  #child-boot .logo { font-size:clamp(48px,12vw,80px); }
  #child-boot .label { font-size:clamp(18px,4vw,28px); color:#aaa; letter-spacing:2px; }
  #child-boot .launch-btn {
    margin-top:16px;
    background:linear-gradient(135deg,#6c63ff,#48d1cc);
    border:none; border-radius:50px; padding:18px 48px;
    font-size:clamp(20px,5vw,32px); color:#fff; cursor:pointer;
    box-shadow:0 8px 32px rgba(108,99,255,0.4);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  #child-boot .launch-btn:active { transform:scale(0.96); box-shadow:0 4px 16px rgba(108,99,255,0.3); }

  /* hidden PIN tap zone — bottom-right corner */
  #pin-zone {
    position:fixed; bottom:0; right:0; width:80px; height:80px;
    z-index:999; cursor:default;
  }

  /* ── PIN OVERLAY ── */
  #pin-overlay {
    display:none; position:fixed; inset:0; z-index:1000;
    background:rgba(10,10,18,0.97); flex-direction:column;
    align-items:center; justify-content:center; gap:20px;
  }
  #pin-overlay.show { display:flex; }
  #pin-overlay h2 { font-size:clamp(20px,5vw,28px); color:#aaa; letter-spacing:1px; }
  #pin-dots { display:flex; gap:16px; margin:8px 0; }
  .dot {
    width:20px; height:20px; border-radius:50%;
    border:2px solid #555; background:transparent;
    transition: background 0.2s, border-color 0.2s;
  }
  .dot.filled { background:#6c63ff; border-color:#6c63ff; }
  #pin-keypad { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:8px; }
  .key {
    width:clamp(64px,18vw,88px); height:clamp(64px,18vw,88px);
    border-radius:50%; border:2px solid #333;
    background:#1a1a2e; color:#fff;
    font-size:clamp(22px,5vw,30px); cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    transition: background 0.15s, transform 0.1s;
  }
  .key:active { background:#2a2a4e; transform:scale(0.93); }
  .key.del { background:#1e1e30; color:#ff6b6b; border-color:#ff6b6b33; font-size:clamp(16px,4vw,22px); }
  #pin-error { color:#ff6b6b; font-size:16px; min-height:20px; }
  #pin-cancel { margin-top:12px; color:#555; font-size:14px; cursor:pointer; }
  #pin-cancel:hover { color:#888; }

  /* ── PARENT MODE / PIPOS HOME ── */
  #pipos-home {
    display:none; position:fixed; inset:0;
    background:linear-gradient(160deg,#0a0a18 0%,#0f0f24 100%);
    flex-direction:column;
  }
  #pipos-home.show { display:flex; }

  .pipos-topbar {
    display:flex; align-items:center; justify-content:space-between;
    padding:12px 20px; background:rgba(255,255,255,0.03);
    border-bottom:1px solid rgba(255,255,255,0.06);
    flex-shrink:0;
  }
  .pipos-logo { display:flex; align-items:center; gap:10px; }
  .pipos-logo .mark { font-size:22px; }
  .pipos-logo .name { font-size:18px; font-weight:700; letter-spacing:2px; color:#6c63ff; }
  .pipos-clock { font-size:14px; color:#666; letter-spacing:1px; }
  .pipos-badge {
    font-size:11px; background:rgba(108,99,255,0.2); color:#6c63ff;
    border:1px solid #6c63ff44; border-radius:20px; padding:4px 12px;
    letter-spacing:1px;
  }

  .pipos-body { flex:1; display:flex; flex-direction:column; padding:24px 20px; gap:20px; overflow:hidden; }

  .section-label { font-size:11px; color:#555; letter-spacing:2px; text-transform:uppercase; margin-bottom:8px; }

  .app-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .app-tile {
    aspect-ratio:1; border-radius:20px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:10px; cursor:pointer; border:2px solid transparent;
    transition: transform 0.15s, box-shadow 0.2s;
    position:relative; overflow:hidden;
  }
  .app-tile:active { transform:scale(0.94); }
  .app-tile.active {
    background:linear-gradient(135deg,#1a1a35,#1e1e40);
    border-color:#6c63ff44;
    box-shadow:0 8px 32px rgba(108,99,255,0.2);
  }
  .app-tile.locked {
    background:#111118; border-color:#222;
    opacity:0.4; cursor:not-allowed;
  }
  .app-tile .tile-icon { font-size:clamp(28px,7vw,40px); }
  .app-tile .tile-name { font-size:clamp(10px,2.5vw,13px); color:#aaa; letter-spacing:1px; }
  .app-tile.active .tile-name { color:#6c63ff; }
  .tile-lock { position:absolute; top:8px; right:10px; font-size:12px; color:#444; }

  .pipos-actions { display:flex; gap:12px; margin-top:auto; }
  .action-btn {
    flex:1; padding:14px; border-radius:14px; border:none; cursor:pointer;
    font-size:14px; font-weight:600; letter-spacing:1px;
    transition: opacity 0.2s, transform 0.15s;
  }
  .action-btn:active { transform:scale(0.97); opacity:0.8; }
  .btn-settings { background:rgba(255,255,255,0.07); color:#aaa; }
  .btn-lock { background:rgba(255,107,107,0.15); color:#ff6b6b; border:1px solid #ff6b6b33; }
</style>
</head>
<body>

<!-- CHILD MODE -->
<div id="child-boot">
  <div class="logo">🎬</div>
  <div class="label">PIP PLAYER</div>
  <button class="launch-btn" onclick="launchPlayer()">▶ Watch</button>
</div>

<!-- HIDDEN PIN ZONE (3x tap bottom-right to unlock) -->
<div id="pin-zone"></div>

<!-- PIN OVERLAY -->
<div id="pin-overlay">
  <h2>PARENT MODE</h2>
  <div id="pin-dots">
    <div class="dot" id="d0"></div>
    <div class="dot" id="d1"></div>
    <div class="dot" id="d2"></div>
    <div class="dot" id="d3"></div>
  </div>
  <div id="pin-error"></div>
  <div id="pin-keypad">
    ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k =>
      k === '' ? '<div></div>' :
      k === '⌫' ? `<div class="key del" onclick="pinKey('del')">${k}</div>` :
      `<div class="key" onclick="pinKey('${k}')">${k}</div>`
    ).join('')}
  </div>
  <div id="pin-cancel" onclick="closePin()">Cancel</div>
</div>

<!-- PIPOS HOME (parent mode) -->
<div id="pipos-home">
  <div class="pipos-topbar">
    <div class="pipos-logo">
      <span class="mark">⬡</span>
      <span class="name">PipOS</span>
    </div>
    <div class="pipos-clock" id="clock">--:--</div>
    <div class="pipos-badge">PARENT MODE</div>
  </div>
  <div class="pipos-body">
    <div>
      <div class="section-label">Apps</div>
      <div class="app-grid">
        <div class="app-tile active" onclick="launchPlayer()">
          <div class="tile-icon">🎬</div>
          <div class="tile-name">Pip Player</div>
        </div>
        <div class="app-tile locked">
          <div class="tile-icon">🎮</div>
          <div class="tile-name">Games</div>
          <div class="tile-lock">🔒</div>
        </div>
        <div class="app-tile locked">
          <div class="tile-icon">📚</div>
          <div class="tile-name">Learn</div>
          <div class="tile-lock">🔒</div>
        </div>
        <div class="app-tile locked">
          <div class="tile-icon">🎵</div>
          <div class="tile-name">Music</div>
          <div class="tile-lock">🔒</div>
        </div>
        <div class="app-tile locked">
          <div class="tile-icon">🎨</div>
          <div class="tile-name">Draw</div>
          <div class="tile-lock">🔒</div>
        </div>
        <div class="app-tile locked">
          <div class="tile-icon">➕</div>
          <div class="tile-name">Add App</div>
          <div class="tile-lock">🔒</div>
        </div>
      </div>
    </div>
    <div class="pipos-actions">
      <button class="action-btn btn-settings" onclick="window.location='/admin'">⚙ Settings</button>
      <button class="action-btn btn-lock" onclick="lockToChild()">🔒 Lock to Child</button>
    </div>
  </div>
</div>

<script>
const API = '';
let pinBuffer = '';
let pinTapCount = 0;
let pinTapTimer = null;

// ── Boot logic ──
async function boot() {
  const s = await getSettings();
  if (s.parentMode) {
    showParentMode();
  }
  // else child mode is already visible (default)
  startClock();
}

async function getSettings() {
  try {
    const r = await fetch(API + '/api/settings');
    return await r.json();
  } catch { return { parentMode: false }; }
}

function showParentMode() {
  document.getElementById('child-boot').style.opacity = '0';
  setTimeout(() => {
    document.getElementById('child-boot').style.display = 'none';
    document.getElementById('pipos-home').classList.add('show');
  }, 300);
}

function launchPlayer() {
  window.location = '/player';
}

// ── Clock ──
function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  };
  tick();
  setInterval(tick, 10000);
}

// ── PIN tap zone (3x taps bottom-right) ──
const pinZone = document.getElementById('pin-zone');
pinZone.addEventListener('click', () => {
  pinTapCount++;
  clearTimeout(pinTapTimer);
  if (pinTapCount >= 3) {
    pinTapCount = 0;
    openPin();
  } else {
    pinTapTimer = setTimeout(() => { pinTapCount = 0; }, 1200);
  }
});

function openPin() {
  pinBuffer = '';
  updateDots();
  document.getElementById('pin-error').textContent = '';
  document.getElementById('pin-overlay').classList.add('show');
}

function closePin() {
  pinBuffer = '';
  updateDots();
  document.getElementById('pin-overlay').classList.remove('show');
}

function pinKey(k) {
  if (k === 'del') {
    pinBuffer = pinBuffer.slice(0, -1);
  } else if (pinBuffer.length < 4) {
    pinBuffer += k;
  }
  updateDots();
  if (pinBuffer.length === 4) {
    setTimeout(checkPin, 120);
  }
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('d' + i).classList.toggle('filled', i < pinBuffer.length);
  }
}

async function checkPin() {
  const res = await fetch(API + '/api/pin/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pinBuffer })
  });
  const data = await res.json();
  if (data.ok) {
    // Set parent mode on
    await fetch(API + '/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinBuffer, parentMode: true })
    });
    closePin();
    showParentMode();
  } else {
    document.getElementById('pin-error').textContent = 'Wrong PIN';
    // Shake dots
    const dots = document.getElementById('pin-dots');
    dots.style.animation = 'none';
    dots.offsetHeight;
    dots.style.animation = 'shake 0.4s ease';
    pinBuffer = '';
    updateDots();
  }
}

async function lockToChild() {
  const pin = prompt('Enter PIN to lock:');
  if (!pin) return;
  const res = await fetch(API + '/api/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, parentMode: false })
  });
  const d = await res.json();
  if (d.ok) {
    window.location.reload();
  } else {
    alert('Wrong PIN');
  }
}

boot();
</script>
<style>
@keyframes shake {
  0%,100%{transform:translateX(0)}
  20%{transform:translateX(-8px)}
  40%{transform:translateX(8px)}
  60%{transform:translateX(-6px)}
  80%{transform:translateX(6px)}
}
</style>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// PLAYER HTML
// ─────────────────────────────────────────────

function playerHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>Pip Player</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; user-select:none; -webkit-tap-highlight-color:transparent; }
html,body { width:100%; height:100dvh; overflow:hidden; background:#000; color:#fff; font-family:system-ui,sans-serif; }

/* ── VIDEO AREA ── */
#video-wrap {
  position:relative; width:100%; background:#000;
  height: calc(100dvh - 200px); /* leaves room for controls */
  overflow:hidden; flex-shrink:0;
}
#yt-frame, #local-video {
  width:100%; height:100%; border:none; position:absolute; top:0; left:0;
}
#local-video { display:none; object-fit:contain; background:#000; }

/* De-stim overlay */
#destim-overlay {
  position:absolute; inset:0; z-index:5; pointer-events:none;
  /* filter applied via JS */
}

/* ── CONTROLS PANEL ── */
#controls {
  position:fixed; bottom:0; left:0; right:0;
  background:linear-gradient(0deg,#050508 80%,transparent);
  padding:10px 14px 14px; z-index:20;
  max-height:200px; overflow:hidden;
}

/* Tab bar */
#tab-bar { display:flex; gap:8px; margin-bottom:10px; }
.tab {
  flex:1; padding:7px; border-radius:8px; border:none;
  background:#1a1a2e; color:#666; font-size:12px; cursor:pointer;
  transition:background 0.2s, color 0.2s;
}
.tab.active { background:#6c63ff22; color:#6c63ff; border:1px solid #6c63ff44; }

/* Tab panels */
.tab-panel { display:none; }
.tab-panel.active { display:block; }

/* Search panel */
#search-row { display:flex; gap:8px; }
#search-input {
  flex:1; background:#1a1a2e; border:1px solid #333; border-radius:10px;
  padding:10px 14px; color:#fff; font-size:15px; outline:none;
}
#search-input::placeholder { color:#555; }
#search-btn {
  background:#6c63ff; border:none; border-radius:10px;
  padding:10px 18px; color:#fff; font-size:15px; cursor:pointer;
}
#search-results {
  display:flex; gap:10px; overflow-x:auto; padding:10px 0 4px;
  scrollbar-width:none;
}
#search-results::-webkit-scrollbar { display:none; }
.result-card {
  flex-shrink:0; width:120px; cursor:pointer;
  border-radius:10px; overflow:hidden; background:#111;
  border:2px solid transparent; transition:border-color 0.2s;
}
.result-card:hover { border-color:#6c63ff66; }
.result-card img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; }
.result-card .r-title { font-size:10px; color:#ccc; padding:4px 6px; line-height:1.3; max-height:36px; overflow:hidden; }
.result-card .r-dur { font-size:9px; color:#666; padding:0 6px 4px; }

/* Local file panel */
#local-panel { padding:4px 0; }
.local-source { display:flex; gap:10px; flex-direction:column; }
#file-drop {
  border:2px dashed #333; border-radius:12px; padding:20px;
  text-align:center; color:#555; font-size:13px; cursor:pointer;
  transition:border-color 0.2s;
}
#file-drop:hover { border-color:#6c63ff; color:#aaa; }
#http-row { display:flex; gap:8px; }
#http-input {
  flex:1; background:#1a1a2e; border:1px solid #333; border-radius:10px;
  padding:8px 12px; color:#fff; font-size:13px; outline:none;
}
#http-btn {
  background:#48d1cc22; border:1px solid #48d1cc44; border-radius:10px;
  padding:8px 14px; color:#48d1cc; font-size:13px; cursor:pointer;
}

/* Settings panel */
#settings-panel { overflow-y:auto; max-height:150px; scrollbar-width:none; }
#settings-panel::-webkit-scrollbar { display:none; }

.preset-row { display:flex; gap:8px; margin-bottom:10px; }
.preset-btn {
  flex:1; padding:8px 4px; border-radius:10px; border:1px solid #333;
  background:#111; color:#888; font-size:12px; cursor:pointer;
  transition:all 0.2s;
}
.preset-btn.active { background:#6c63ff22; color:#6c63ff; border-color:#6c63ff44; }
.preset-btn:nth-child(2).active { background:#48d1cc22; color:#48d1cc; border-color:#48d1cc44; }
.preset-btn:nth-child(3).active { background:#ff6b6b22; color:#ff6b6b; border-color:#ff6b6b44; }

.slider-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; }
.slider-row { display:flex; flex-direction:column; gap:2px; }
.slider-label { font-size:10px; color:#555; display:flex; justify-content:space-between; }
.slider-label span { color:#888; }
input[type=range] {
  width:100%; height:4px; -webkit-appearance:none; appearance:none;
  background:#222; border-radius:2px; outline:none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance:none; width:14px; height:14px; border-radius:50%;
  background:#6c63ff; cursor:pointer;
}

/* Playback bar */
#playback-bar {
  display:flex; align-items:center; gap:10px;
  background:#0e0e1a; border-radius:10px; padding:8px 12px; margin-bottom:8px;
}
#play-btn { font-size:20px; background:none; border:none; color:#fff; cursor:pointer; flex-shrink:0; }
#track-name { flex:1; font-size:12px; color:#aaa; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
#back-btn { font-size:13px; background:#ffffff11; border:none; color:#aaa; cursor:pointer; border-radius:6px; padding:6px 10px; }
</style>
</head>
<body>

<!-- VIDEO -->
<div id="video-wrap">
  <iframe id="yt-frame"
    src="about:blank"
    allow="autoplay; fullscreen"
    allowfullscreen>
  </iframe>
  <video id="local-video" controls playsinline></video>
  <div id="destim-overlay"></div>
</div>

<!-- CONTROLS -->
<div id="controls">
  <div id="playback-bar">
    <button id="back-btn" onclick="window.location='/'">⬡ Home</button>
    <div id="track-name">Nothing playing</div>
  </div>

  <div id="tab-bar">
    <button class="tab active" onclick="switchTab('search')">🔍 YouTube</button>
    <button class="tab" onclick="switchTab('local')">📁 Local</button>
    <button class="tab" onclick="switchTab('settings')">🎛 Calm</button>
  </div>

  <!-- SEARCH -->
  <div class="tab-panel active" id="panel-search">
    <div id="search-row">
      <input id="search-input" type="search" placeholder="Search YouTube..." autocomplete="off"
        onkeydown="if(event.key==='Enter')doSearch()">
      <button id="search-btn" onclick="doSearch()">▶</button>
    </div>
    <div id="search-results"></div>
  </div>

  <!-- LOCAL -->
  <div class="tab-panel" id="panel-local">
    <div class="local-source">
      <div id="file-drop" onclick="document.getElementById('file-input').click()">
        📂 Tap to open MP4 from device
        <input type="file" id="file-input" accept="video/mp4,video/webm,video/*" style="display:none" onchange="loadLocalFile(this)">
      </div>
      <div id="http-row">
        <input id="http-input" type="url" placeholder="http://YOUR-NAS-IP:8765/video.mp4">
        <button id="http-btn" onclick="loadHTTP()">▶ Play</button>
      </div>
    </div>
  </div>

  <!-- SETTINGS -->
  <div class="tab-panel" id="panel-settings">
    <div class="preset-row">
      <button class="preset-btn active" onclick="applyPreset('calm')">😌 Calm</button>
      <button class="preset-btn" onclick="applyPreset('focus')">🧠 Focus</button>
      <button class="preset-btn" onclick="applyPreset('sleep')">😴 Sleep</button>
      <button class="preset-btn" onclick="applyPreset('off')">✨ Normal</button>
    </div>
    <div class="slider-grid">
      <div class="slider-row">
        <div class="slider-label">Grayscale <span id="v-gray">40%</span></div>
        <input type="range" min="0" max="100" value="40" id="s-gray" oninput="updateFilter()">
      </div>
      <div class="slider-row">
        <div class="slider-label">Contrast <span id="v-contrast">85%</span></div>
        <input type="range" min="40" max="120" value="85" id="s-contrast" oninput="updateFilter()">
      </div>
      <div class="slider-row">
        <div class="slider-label">Brightness <span id="v-bright">90%</span></div>
        <input type="range" min="20" max="110" value="90" id="s-bright" oninput="updateFilter()">
      </div>
      <div class="slider-row">
        <div class="slider-label">Warm Tone <span id="v-sepia">15%</span></div>
        <input type="range" min="0" max="80" value="15" id="s-sepia" oninput="updateFilter()">
      </div>
      <div class="slider-row">
        <div class="slider-label">Saturation <span id="v-sat">100%</span></div>
        <input type="range" min="0" max="150" value="100" id="s-sat" oninput="updateFilter()">
      </div>
      <div class="slider-row">
        <div class="slider-label">Speed <span id="v-speed">0.85x</span></div>
        <input type="range" min="50" max="200" value="85" id="s-speed" oninput="updateSpeed()">
      </div>
    </div>
  </div>
</div>

<script>
const API = '';
const PRESETS = {
  calm:  { gray:40, contrast:85, bright:90, sepia:15, sat:100, speed:85 },
  focus: { gray:70, contrast:75, bright:80, sepia:25, sat:80,  speed:75 },
  sleep: { gray:100,contrast:60, bright:50, sepia:40, sat:60,  speed:65 },
  off:   { gray:0,  contrast:100,bright:100,sepia:0,  sat:100, speed:100 }
};

let currentPreset = 'calm';
let currentTitle = '';

// ── Init ──
async function init() {
  const s = await fetch(API + '/api/settings').then(r=>r.json()).catch(()=>({preset:'calm'}));
  applyPreset(s.preset || 'calm');
}

// ── Tabs ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i)=>{
    t.classList.toggle('active', ['search','local','settings'][i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
}

// ── YouTube Search ──
async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  document.getElementById('search-results').innerHTML = '<div style="color:#555;font-size:12px;padding:8px">Searching...</div>';
  try {
    const data = await fetch(API + '/api/yt/search?q=' + encodeURIComponent(q)).then(r=>r.json());
    const el = document.getElementById('search-results');
    el.innerHTML = '';
    if (!data.results?.length) {
      el.innerHTML = '<div style="color:#555;font-size:12px;padding:8px">No results</div>';
      return;
    }
    data.results.forEach(v => {
      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = \`
        <img src="\${v.thumb}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22><rect fill=%22%23222%22 width=%2216%22 height=%229%22/></svg>'">
        <div class="r-title">\${v.title}</div>
        <div class="r-dur">\${v.duration}</div>
      \`;
      card.onclick = () => playYT(v.videoId, v.title);
      el.appendChild(card);
    });
  } catch(e) {
    document.getElementById('search-results').innerHTML = \`<div style="color:#ff6b6b;font-size:12px;padding:8px">Error: \${e.message}</div>\`;
  }
}

// ── Play YouTube ──
function playYT(videoId, title) {
  const frame = document.getElementById('yt-frame');
  document.getElementById('local-video').style.display = 'none';
  frame.style.display = 'block';
  frame.src = \`https://www.youtube-nocookie.com/embed/\${videoId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3\`;
  currentTitle = title || videoId;
  document.getElementById('track-name').textContent = currentTitle;
}

// ── Local file ──
function loadLocalFile(input) {
  const file = input.files[0];
  if (!file) return;
  const vid = document.getElementById('local-video');
  const frame = document.getElementById('yt-frame');
  frame.src = 'about:blank';
  frame.style.display = 'none';
  vid.src = URL.createObjectURL(file);
  vid.style.display = 'block';
  vid.play();
  currentTitle = file.name;
  document.getElementById('track-name').textContent = file.name;
}

// ── HTTP / SMB-via-HTTP ──
function loadHTTP() {
  const url = document.getElementById('http-input').value.trim();
  if (!url) return;
  const vid = document.getElementById('local-video');
  const frame = document.getElementById('yt-frame');
  frame.src = 'about:blank';
  frame.style.display = 'none';
  vid.src = url;
  vid.style.display = 'block';
  vid.play();
  currentTitle = url.split('/').pop();
  document.getElementById('track-name').textContent = currentTitle;
}

// ── De-stim filter ──
function updateFilter() {
  const gray = document.getElementById('s-gray').value;
  const contrast = document.getElementById('s-contrast').value;
  const bright = document.getElementById('s-bright').value;
  const sepia = document.getElementById('s-sepia').value;
  const sat = document.getElementById('s-sat').value;

  document.getElementById('v-gray').textContent = gray + '%';
  document.getElementById('v-contrast').textContent = contrast + '%';
  document.getElementById('v-bright').textContent = bright + '%';
  document.getElementById('v-sepia').textContent = sepia + '%';
  document.getElementById('v-sat').textContent = sat + '%';

  const filter = \`grayscale(\${gray}%) contrast(\${contrast}%) brightness(\${bright}%) sepia(\${sepia}%) saturate(\${sat}%)\`;
  document.getElementById('destim-overlay').style.backdropFilter = filter;
  // Also apply to video element for local files
  document.getElementById('local-video').style.filter = filter;
  // For YT iframes we use a mix-blend-mode overlay trick
  const overlay = document.getElementById('destim-overlay');
  overlay.style.background = sepia > 0 ? \`rgba(255,200,100,\${sepia/300})\` : 'transparent';
  overlay.style.mixBlendMode = 'multiply';
  document.getElementById('yt-frame').style.filter = filter;
}

function updateSpeed() {
  const val = document.getElementById('s-speed').value;
  const speed = val / 100;
  document.getElementById('v-speed').textContent = speed.toFixed(2) + 'x';
  const vid = document.getElementById('local-video');
  if (vid.src) vid.playbackRate = speed;
  // YT speed via postMessage
  const frame = document.getElementById('yt-frame');
  try {
    frame.contentWindow.postMessage(JSON.stringify({
      event: 'command', func: 'setPlaybackRate', args: [speed]
    }), '*');
  } catch {}
}

function applyPreset(name) {
  currentPreset = name;
  const p = PRESETS[name] || PRESETS.calm;
  document.getElementById('s-gray').value = p.gray;
  document.getElementById('s-contrast').value = p.contrast;
  document.getElementById('s-bright').value = p.bright;
  document.getElementById('s-sepia').value = p.sepia;
  document.getElementById('s-sat').value = p.sat;
  document.getElementById('s-speed').value = p.speed;
  updateFilter();
  updateSpeed();
  // Update preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn,i) => {
    btn.classList.toggle('active', ['calm','focus','sleep','off'][i] === name);
  });
  // Update tab label
  const labels = { calm:'😌 Calm', focus:'🧠 Focus', sleep:'😴 Sleep', off:'✨ Normal' };
  document.querySelectorAll('.tab')[2].textContent = labels[name] || '🎛 Calm';
}

init();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// ADMIN HTML
// ─────────────────────────────────────────────

function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PipOS Admin</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a12; color:#fff; font-family:system-ui,sans-serif; min-height:100vh; }
.admin-wrap { max-width:480px; margin:0 auto; padding:24px 16px; }
h1 { font-size:22px; color:#6c63ff; letter-spacing:2px; margin-bottom:4px; }
.subtitle { color:#555; font-size:13px; margin-bottom:28px; }
.card {
  background:#111118; border:1px solid #1e1e30; border-radius:16px;
  padding:20px; margin-bottom:16px;
}
.card h2 { font-size:14px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:14px; }
.field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
label { font-size:12px; color:#666; }
input[type=text], input[type=number], input[type=password], select {
  background:#0a0a18; border:1px solid #2a2a40; border-radius:10px;
  padding:10px 14px; color:#fff; font-size:14px; outline:none; width:100%;
}
input:focus { border-color:#6c63ff; }
.btn {
  width:100%; padding:12px; border-radius:10px; border:none;
  background:linear-gradient(135deg,#6c63ff,#48d1cc); color:#fff;
  font-size:14px; font-weight:600; cursor:pointer; letter-spacing:1px;
  transition:opacity 0.2s;
}
.btn:hover { opacity:0.9; }
.btn-danger { background:linear-gradient(135deg,#ff6b6b,#ff9999); }
.msg { margin-top:10px; font-size:13px; min-height:18px; }
.msg.ok { color:#48d1cc; }
.msg.err { color:#ff6b6b; }
.back-link { color:#6c63ff; text-decoration:none; font-size:13px; display:inline-block; margin-bottom:20px; }

/* PIN gate */
#pin-gate { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:80vh; gap:20px; }
#pin-gate h2 { color:#aaa; letter-spacing:2px; }
#admin-pin-input {
  background:#111; border:2px solid #333; border-radius:14px;
  padding:16px 20px; color:#fff; font-size:32px; letter-spacing:12px;
  text-align:center; width:180px; outline:none;
}
#admin-pin-input:focus { border-color:#6c63ff; }
#pin-gate-error { color:#ff6b6b; font-size:13px; min-height:18px; }

#admin-content { display:none; }

/* SMB info box */
.info-box {
  background:#0a1520; border:1px solid #1a3040; border-radius:10px;
  padding:14px; font-family:monospace; font-size:12px; color:#48d1cc;
  line-height:1.8; overflow-x:auto; white-space:pre;
}
</style>
</head>
<body>
<div class="admin-wrap">

  <!-- PIN GATE -->
  <div id="pin-gate">
    <h2>⬡ PIPOS ADMIN</h2>
    <input type="password" id="admin-pin-input" maxlength="4" placeholder="····"
      oninput="if(this.value.length===4)checkAdminPin()">
    <div id="pin-gate-error"></div>
  </div>

  <!-- ADMIN CONTENT -->
  <div id="admin-content">
    <a href="/" class="back-link">← Back to PipOS</a>
    <h1>⬡ PIPOS ADMIN</h1>
    <p class="subtitle">Parent settings — WARP access only</p>

    <!-- PIN MANAGEMENT -->
    <div class="card">
      <h2>🔐 PIN Management</h2>
      <div class="field">
        <label>Current PIN</label>
        <input type="password" id="old-pin" maxlength="4" placeholder="Current 4-digit PIN">
      </div>
      <div class="field">
        <label>New PIN</label>
        <input type="password" id="new-pin" maxlength="4" placeholder="New 4-digit PIN">
      </div>
      <button class="btn" onclick="changePin()">Update PIN</button>
      <div class="msg" id="pin-msg"></div>
    </div>

    <!-- DEFAULT SETTINGS -->
    <div class="card">
      <h2>🎛 Default Settings</h2>
      <div class="field">
        <label>Default Preset</label>
        <select id="default-preset">
          <option value="calm">😌 Calm</option>
          <option value="focus">🧠 Focus</option>
          <option value="sleep">😴 Sleep</option>
          <option value="off">✨ Normal</option>
        </select>
      </div>
      <button class="btn" onclick="saveDefaultPreset()">Save Default</button>
      <div class="msg" id="preset-msg"></div>
    </div>

    <!-- LOCAL MEDIA SERVER -->
    <div class="card">
      <h2>📁 Local Media Server</h2>
      <div class="field">
        <label>HTTP Server Port (for SMB-mounted videos)</label>
        <input type="number" id="local-port" value="8765" min="1024" max="65535">
      </div>
      <button class="btn" onclick="savePort()">Save Port</button>
      <div class="msg" id="port-msg"></div>

      <br>
      <div class="field">
        <label>SMB Mount + Local HTTP Server Setup (run on Pi)</label>
        <div class="info-box" id="smb-instructions">Loading...</div>
      </div>
    </div>

    <!-- PIPOS MODE -->
    <div class="card">
      <h2>🔒 Mode Control</h2>
      <button class="btn" onclick="setMode(true)">Unlock Parent Mode</button>
      <br><br>
      <button class="btn btn-danger" onclick="setMode(false)">Lock to Child Mode</button>
      <div class="msg" id="mode-msg"></div>
    </div>

  </div>
</div>

<script>
const API = '';
let adminPin = '';
let settings = {};

async function checkAdminPin() {
  const pin = document.getElementById('admin-pin-input').value;
  const res = await fetch(API + '/api/pin/verify', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ pin })
  });
  const d = await res.json();
  if (d.ok) {
    adminPin = pin;
    document.getElementById('pin-gate').style.display = 'none';
    document.getElementById('admin-content').style.display = 'block';
    loadSettings();
  } else {
    document.getElementById('pin-gate-error').textContent = 'Wrong PIN';
    document.getElementById('admin-pin-input').value = '';
  }
}

async function loadSettings() {
  settings = await fetch(API + '/api/settings').then(r=>r.json());
  document.getElementById('default-preset').value = settings.preset || 'calm';
  document.getElementById('local-port').value = settings.localPort || 8765;
  updateSMBInstructions(settings.localPort || 8765);
}

function updateSMBInstructions(port) {
  document.getElementById('smb-instructions').textContent =
\`# 1. Install CIFS and file server
sudo apt install -y cifs-utils python3

# 2. Create credentials file
sudo nano /etc/smb-pip-creds
  username=YOUR_NAS_USER
  password=YOUR_NAS_PASS
sudo chmod 600 /etc/smb-pip-creds

# 3. Mount the SMB share
sudo mkdir -p /media/videos
sudo mount -t cifs //YOUR-NAS-IP/share/media/pip \\\\
  /media/videos \\\\
  -o credentials=/etc/smb-pip-creds,uid=1000,gid=1000

# 4. Serve it over HTTP on port \${port}
python3 -m http.server \${port} --directory /media/videos &

# 5. In Pip Player, use URL:
http://localhost:\${port}/your-video.mp4

# 6. Auto-mount on boot — add to /etc/fstab:
//YOUR-NAS-IP/share/media/pip /media/videos cifs \\\\
  credentials=/etc/smb-pip-creds,uid=1000,gid=1000,_netdev 0 0\`;
}

async function changePin() {
  const oldPin = document.getElementById('old-pin').value;
  const newPin = document.getElementById('new-pin').value;
  if (!/^\\d{4}$/.test(newPin)) { showMsg('pin-msg','PIN must be 4 digits','err'); return; }
  const res = await fetch(API + '/api/pin/set', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ oldPin, newPin })
  });
  const d = await res.json();
  if (d.ok) {
    adminPin = newPin;
    showMsg('pin-msg','PIN updated!','ok');
    document.getElementById('old-pin').value = '';
    document.getElementById('new-pin').value = '';
  } else {
    showMsg('pin-msg','Wrong current PIN','err');
  }
}

async function saveDefaultPreset() {
  const preset = document.getElementById('default-preset').value;
  const res = await fetch(API + '/api/settings', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ pin: adminPin, settings: { preset } })
  });
  const d = await res.json();
  showMsg('preset-msg', d.ok ? 'Saved!' : 'Error', d.ok ? 'ok' : 'err');
}

async function savePort() {
  const port = parseInt(document.getElementById('local-port').value);
  const res = await fetch(API + '/api/settings', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ pin: adminPin, settings: { localPort: port } })
  });
  const d = await res.json();
  if (d.ok) {
    showMsg('port-msg','Port saved!','ok');
    updateSMBInstructions(port);
  } else {
    showMsg('port-msg','Error saving','err');
  }
}

async function setMode(parentMode) {
  const res = await fetch(API + '/api/mode', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ pin: adminPin, parentMode })
  });
  const d = await res.json();
  showMsg('mode-msg', d.ok ? (parentMode ? 'Parent mode ON' : 'Locked to child mode') : 'Error', d.ok ? 'ok' : 'err');
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + type;
  setTimeout(() => { el.textContent = ''; }, 3000);
}
</script>
</body>
</html>`;
}
