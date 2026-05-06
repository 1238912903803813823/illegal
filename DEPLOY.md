# FindPing Bot - Deployment Guide

---

## What this bot does

- `/findping [user]` — Slash command. Finds the newest message in the current channel where you (or a chosen user) were personally pinged.
- `,findping [@user]` — Prefix command equivalent.
- `,prefix <symbol>` — Change prefix per server. Options: `,` `.` `!` `?`
- `,help` — Full help menu.
- `,cmds` / `,commands` — Short command list.
- `,credits` — Credits.

Personal pings only. @everyone, @here, and @role pings are ignored.

---

## Step 1 — Create a Discord Application & Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" — name it whatever you want.
3. Go to the "Bot" tab on the left.
4. Click "Add Bot" → confirm.
5. Under "Token", click "Reset Token" and copy it. Keep this secret.
6. Scroll down to "Privileged Gateway Intents" and enable ALL THREE:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent  
   ← This is required or the bot cannot read messages.
7. Save changes.

---

## Step 2 — Invite the Bot to Your Server

1. Go to the "OAuth2" tab → "URL Generator".
2. Under "Scopes", check:
   - `bot`
   - `applications.commands`
3. Under "Bot Permissions", check:
   - Read Messages / View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Use Slash Commands
4. Copy the generated URL and open it in your browser.
5. Select your server and authorize.

---

## Step 3 — Set Up the Project Locally

Requirements: Node.js 18 or higher (https://nodejs.org)

```bash
# Clone or download the bot folder, then:
cd findping-bot
npm install

# Create your .env file
cp .env.example .env
```

Open `.env` and paste your bot token:
```
DISCORD_TOKEN=your_token_here
```

---

## Step 4 — Run the Bot

```bash
node index.js
```

You should see:
```
Logged in as YourBot#1234
Slash commands registered globally.
```

Slash commands (`/findping`) can take up to 1 hour to appear globally on Discord after first registration. They appear instantly in the server if you switch to guild-only registration (see Optional below).

---

## Step 5 — Keeping it Online 24/7

Option A — Railway (easiest, free tier available)
1. Push the folder to a GitHub repo (do NOT commit `.env` or `config.json`).
2. Go to https://railway.app and create a new project from your GitHub repo.
3. In the project settings, add an environment variable: `DISCORD_TOKEN` = your token.
4. Railway will auto-detect Node and run `npm start`.

Option B — VPS / DigitalOcean / Hetzner
1. SSH into your server.
2. Install Node 18+, clone your repo.
3. Create the `.env` file manually on the server.
4. Run with PM2 for auto-restart:
```bash
npm install -g pm2
pm2 start index.js --name findping-bot
pm2 save
pm2 startup
```

Option C — Local machine with always-on PC
Just run `node index.js` in a terminal. Bot goes offline when you close it or shut down.

---

## Config File

`config.json` is auto-created when the bot first runs. It stores per-server prefix settings. Do not delete it while the bot is running.

---

## Optional — Guild-Only Slash Commands (instant registration)

Replace in `index.js`:
```js
await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
```
with:
```js
await rest.put(Routes.applicationGuildCommands(client.user.id, 'YOUR_SERVER_ID'), { body: commands });
```

Slash command will appear instantly in that server only.

---

## Permissions Summary

| Permission          | Why it's needed                          |
|---------------------|------------------------------------------|
| Read Messages        | See channel content                      |
| Send Messages        | Reply to commands                        |
| Read Message History | Scan past messages for pings             |
| Embed Links          | Send formatted embed responses           |
| Message Content Intent | Read message text to detect mentions  |
| Server Members Intent  | Resolve user mentions properly         |
