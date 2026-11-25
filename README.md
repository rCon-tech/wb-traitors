# The W.B. Mates Traitors

A Mafia / Traitors game for the pub, where **the server is the moderator**, so every mate gets to play.
Players join from their phones with a 4-letter room code and a name. No accounts, no emails, no installs.

Roles: **Villager, Mafia, Detective, Doctor** (or just Mafia and Villagers in Simple mode). Branded as an Irish pub, with optional Christmas lights.

## Run it

```bash
npm install
npm run dev        # server on :3000, web app on :5173 (open the :5173 address)
```

Production (one process serves the app and the game):

```bash
npm run build
npm start          # http://localhost:3000
```

Requires Node 20+. No database: games live in memory and are snapshotted to `data/games.json`
every 2 seconds, so a restart does not end a game in progress.

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `WBM_MIN_PLAYERS` | `6` | Minimum players to start (never below 4) |
| `WBM_DATA_DIR` | `./data` | Where the snapshot is written |
| `WBM_FAST` | unset | `1` = tiny timers (automated tests), `2` = short timers (rehearsals) |

## Hosting it for the party

The server needs WebSockets and one always-on instance. Any of these work:

- **Render:** New > Blueprint > pick this repo (`render.yaml` is included). Free instances sleep when idle,
  so open the site about 30 minutes before the party to wake it, or use a paid instance.
- **Railway / Fly.io:** use the included `Dockerfile`, or `npm run build` then `npm start`.
- **Docker:** `docker build -t wb-traitors . && docker run -p 3000:3000 wb-traitors`

Then give everyone the address, or put up the QR code from the lobby. Optional: a custom domain such as `traitors.yourdomain.ie`.

## Party night

1. Open the site on your phone, tap **Open a new pub**. You are the host *and* a player.
2. Put the big screen on: open `/tv/ROOMCODE` on a laptop or TV browser and tap **Turn on narration**
   (browsers need one tap before they will speak).
3. Everyone scans the QR code or types the room code and picks a name.
4. Press **Start the game** (6+ players). Hold your card to see your role. Don't let anyone peek.
5. Night: every phone shows the same kind of screen, so nobody can tell roles apart. Everybody picks someone and taps **Lock in**.
6. Day: talk it out in person. Then **Calling Time**: vote. The most votes is barred. A tie, or "No one" matching the top vote, bars nobody.

### Simple mode

For a busy party, the host can tick **Simple mode** in the lobby. It removes the Detective and Doctor, leaving just **Mafia and Villagers**
with a plain kill and vote:

- At night only the Mafia choose a victim. The night ends as soon as every living Mafia member has decided (after the usual short minimum),
  so villagers are never held up and can carry on partying.
- Villagers' screens look the same as before, with an optional tap they can ignore, so nobody can tell who the Mafia are by who is tapping.
- Day, voting, game length, ghosts and everything else work exactly as normal.

### How long a game lasts

In the lobby the host picks a **Game length** (about 1 to 3 hours, 2 hours by default). The app plans roughly one round for every two players
(at least 3) and sizes each day's discussion so that the vote lands on schedule. Night, dawn, the vote and the verdict stay short, since that is where the secret actions happen.

| Players | Rounds planned | Time per round | Discussion before each vote (2 h game) |
| --- | --- | --- | --- |
| 8 | 4 | 30 min | about 27 min |
| 12 | 6 | 20 min | about 17 min |
| 16 | 8 | 15 min | about 12 min |

- It corrects itself: if a day is skipped early, later days get the time back; if the game falls behind, later days are shortened. Pausing does not count as lost time.
- A day is never shorter than 1 minute or longer than 30. Phones buzz and the TV announces "Five minutes until Calling Time" during long days.
- The TV and phones show a game clock ("26 min in, aiming to finish around 2 h").
- A game can end sooner if the Mafia are caught quickly. Choose **Manual** to use a fixed discussion time per day instead.

Host controls (bottom of the screen during a game): pause, +1 minute, skip ahead, remove a player, end game.
If the host's phone is away for a minute, the host role passes to another player automatically.

### Rules

- Mafia win when they equal or outnumber everyone else alive. The village wins when every Mafia member is out.
- **Mafia** choose a victim together (majority; a tie is broken at random). **Doctor** protects one person
  (themself only once, never the same person two nights running). **Detective** learns whether one person is Mafia.
- Villagers also pick someone at night. It does nothing, but it keeps every screen and timing identical.
- If the Doctor protects the Mafia's target, nobody dies and the story says so without naming anyone.
- Dead players become ghosts: they see the whole board but cannot vote or speak into the game.
- Default Mafia count: 6-7 players = 1, 8-11 = 2, 12-15 = 3, 16-20 = 4. The host can change it in the lobby.

## Rehearse with fake players

```bash
# Bots open their own pub and play a whole game
npm run bots -- --url http://localhost:3000 --count 8

# Or add bots to a room you opened, then start it from your phone
npm run bots -- --url http://localhost:3000 --code ABCD --count 10
```

Run the server with `WBM_FAST=2` for a quick rehearsal.

## Make it yours

- **Narration and in-jokes:** `src/shared/narration.ts`. Add lines to any list; no other code changes.
- **Sign year:** set `FOUNDED_YEAR` in `src/client/ui.tsx` to show "EST. 20xx" on the pub sign.
- **Colours and fonts:** CSS variables at the top of `src/client/styles.css`.

## How it is built

```
src/shared/   engine.ts  all the rules as pure functions (no I/O), fully unit tested
              views.ts   builds what each player may see: the only place secrets could leak
              types.ts, narration.ts
src/server/   Express + Socket.IO. Owns all state, the 500 ms clock, snapshots, rate limiting
src/client/   React + Vite. Phone screens and the TV screen
scripts/bots.ts   fake players
```

The server is the only source of truth. Clients send intents ("lock in this person"); the server checks them
against the phase and role, then sends each phone only what that player may know. Reconnection uses a random token
kept in the phone's `localStorage`, so a locked or refreshed phone returns to the same seat.

```bash
npm test            # engine rules, full games over real sockets, privacy checks, restart recovery
npm run typecheck
```
