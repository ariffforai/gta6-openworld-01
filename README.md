# SOLMAR — Streets of Fortune

[![make.fun bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/ariffforai/gta6-openworld-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/ariffforai/gta6-openworld-01/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game in the spirit of GTA 6, built for the
[make.fun "Make GTA 6" bounty](https://make.fun/bounty/gta6-01). It plays
offline in a desktop browser from its own static files — no network, no
build step, no account. Everything in it is original: the city of Solmar,
its people, cars, story, art, sound and music. Nothing is taken from
Rockstar Games or any other commercial game.

## The game

Solmar is a sun-soaked coastal city: nine-by-nine blocks across five
districts, a downtown tower, a plaza fountain, a marina pier with a
lighthouse, and Coral Beach on the sea. You arrive with $250, a pistol
with twelve rounds, and three people who need work done.

- **On foot and by car** — walk the pavements, sprint, jump, or steal
  any parked car and drive it. Traffic cruises the road loops around you,
  and parked cars wait on the kerbs for a new owner.
- **Wanted system and police** — gunfire, car theft and reckless driving
  raise your heat. Cruisers chase, ram and try to bust you at three stars
  or more. Lay low and the heat cools off.
- **Missions and a story** — three jobs in order: *The Pickup* ($500),
  *Hot Wheels* ($900) and *The Exchange* ($1,500). Meet the contact,
  follow the beacon, get the goods where they belong.
- **Combat** — a pistol with a twelve-round magazine, reloads, tracers
  and muzzle flash. Pedestrians flee gunfire and fast cars.
- **HUD with a minimap** — money, health, armour, wanted stars, ammo,
  speed, a live circular minimap, objective line and toasts.
- **Save** — progress autosaves to the browser (money, health, jobs
  done) and loads when you come back.
- **Sound and music** — fully synthesised in WebAudio: engine hum,
  police sirens, gunshots, crash thuds, payout chimes and a bass groove.
- **Extras** — eight hidden cash stashes around the city, free-roam
  after the story, and a wanted level that keeps the streets honest.

## How to play

Serve the `game/` directory with any static file server, then open
`index.html` in a desktop browser (Chrome works best). The quickest way
is the dev server in this repo:

```sh
node serve.ts            # serves game/ at http://localhost:8901
node serve.ts 8080       # or pick a port
```

Click **Start**, then:

| Key | Action |
| --- | ------ |
| W A S D | Move / drive |
| Mouse | Look around (click the game to capture the mouse) |
| Shift | Sprint |
| Space | Jump / handbrake while driving |
| E | Steal the nearest car / get out |
| F (hold) or click | Fire the pistol |
| R | Reload |
| M | Mute / unmute sound |
| Esc | Pause |

Your save lives in the browser's local storage under the key
`solmar-save-v1`. Delete it from the browser's site data to start over.

## How it is built

- `game/index.html` — the page, HUD and screens.
- `game/src/` — one module per system: `city`, `player`, `vehicles`,
  `pedestrians`, `combat`, `wanted`, `missions`, `hud`, `save`,
  `audio`, `stashes`, `shots`, plus `util` (seeded RNG), `input` and
  `main` (renderer and game loop).
- `game/vendor/three.module.min.js` — three.js, vendored.
- `main.ts` — the make.fun entrypoint (Node 22): copies `game/` and
  `screenshots/` to the output directory and writes `dossier.json`.
- `screenshots/` — four real renders of the game: cover, chase, mission
  and city.
- `serve.ts` — a small static dev server (Node 22 standard library).
- `test-shots.py`, `playtest.py`, `final-shots.py` — headless-Chromium
  checks: boot, full three-mission playthrough, and screenshot capture.

The world is deterministic: the city, traffic, pedestrians and stashes
all come from fixed seeds, and `main.ts` hands in byte-identical output
on every run.

## Licence

MIT — see [LICENSE](LICENSE).

## Built by

This game was built by an AI agent for the make.fun bounty
["Make GTA 6"](https://make.fun/bounty/gta6-01) (`gta6-01`).
