# SOLMAR — Streets of Fortune

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ariffforai/gta6-openworld-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ariffforai/gta6-openworld-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game built for [make.fun](https://make.fun/bounty/gta6-01)'s "Make GTA 6" bounty ($1,666). You are **Jules Marek**, a getaway driver back in **Solmar** — a sun-soaked coastal city of palms, towers and one long beach — broke, owed, and one favour away from trouble. Fixer **Nadia Voss** has work for you. The city is yours: steal any car, outrun the Solmar PD, and finish the jobs.

## The city

Solmar is a procedural 3D city (three.js, vendored under `game/vendor/`): a 9×9 street grid across five districts — Old Town, Palm Row, Downtown (with the 110-metre Solmar Tower), Marina Bay and Coral Beach — with traffic, pedestrians, palms, plazas, a pier, a lighthouse and a yacht anchored offshore. Everything is original: the city, characters, vehicles, names, story, art, sounds and music. Nothing is taken from any commercial game.

## How to play

- **WASD** — move / drive · **Mouse** — look / aim (click the game to lock the pointer)
- **E** — enter / steal a car (or step out) · **Click** — shoot the pistol on foot, or drive-by from a car
- **Space** — jump on foot / handbrake while driving · **Shift** — sprint
- **T** — take the next job from Nadia · **C** — camera distance · **M** — mute · **P / Esc** — pause

## The story — four jobs

1. **The Pickup** — collect a package on Palm Row and deliver it to Nadia's garage. $500.
2. **Hot Wheels** — steal the red Coral coupe at the marina and deliver it to the chop shop in Old Town, with the police on your tail. $900.
3. **The Exchange** — meet the Vultures at the Coral Beach pier, settle it, grab the case and reach the safehouse. $1,500.
4. **The Getaway** — pick up a courier in Downtown and get him to the marina yacht in 90 seconds, with the whole force after you. $2,000. Run out of time and the job fails — press T and try again.

After the last job, free roam continues. Progress (money, health, position, jobs done) saves to localStorage automatically after every job and every 20 seconds.

## Systems

- **Driving** — arcade car physics with steering, braking, reversing and handbrake; a chase camera that follows the car. Hard crashes batter your car: it starts smoking, and a wrecked car blows up and throws you out.
- **Traffic & pedestrians** — cars follow the road grid and turn at intersections; parked cars can be stolen; pedestrians stroll the sidewalks and flee from gunfire and speeding cars.
- **Wanted level** — five stars. Stealing cars, hitting pedestrians and shooting raise the heat; the Solmar PD sends cruisers with flashing red-and-blue roof bars that chase and ram you. Lay low out of sight and the heat cools. Get pinned by a cruiser on foot and you are busted.
- **Combat** — pistol with tracers, muzzle flash and hit particles; shoot on foot or from the driver's seat (hold the mouse to look around and fire a drive-by); the marina shootout pits you against four armed Vultures.
- **Cash stashes** — five glowing cases hidden around the city, $150 each, marked as gold diamonds on the minimap. They reset every session, so a fresh day always has five to find.
- **HUD & minimap** — money, health and armour bars, wanted stars, mission objective with distance (and a countdown on timed jobs), speedometer, crosshair, and a circular live minimap showing roads, traffic, police, pedestrians, stashes and the mission marker.
- **Sound** — everything synthesised with WebAudio: engine hum, sirens, gunshots, crashes, pickup chimes and a slow sunset groove. No audio files.
- **Start screen, pause, WASTED / BUSTED screens** — and a save that survives a reload.

## Play it

```sh
node serve.ts   # then open http://localhost:8080
```

`game/` is plain static files — no build step, no network requests. `main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json`.

## Testing it

`playtest.py` drives all four missions end to end in headless Chromium (steal, deliver, shootout, timed getaway) and reports any console or page errors. `test-shots.py` checks every staged screenshot state, and `final-shots.py` takes the four screenshots in `screenshots/`.
