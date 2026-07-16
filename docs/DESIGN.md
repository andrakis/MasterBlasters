# MASTER BLASTERS — Design

A remake of the 2007 Half-Life 2 mod by Grayson "Big D" Deitering, Mark "Fallows"
Fallows, and Daedalus "Julian" Raistlin (this project's owner — level design,
optimization, and the items-falling-from-the-sky mechanic). Sources: the ModDB
profile, the Valve Developer Community page, and the archived masterblastersmod.com.

## The one rule

**Damage never kills.** Health clamps at 0 and exists for one purpose: the less
life you have, the farther you fly when hit. The only way to die is to be knocked
off the platforms into the void. Quake's rockets supply the violence; Smash Bros
supplies the death condition.

## Core loop

- Maps are floating platforms over a bottomless void (`killY`).
- Everyone has a **jetpack**: limited energy, gradually recharging (slower in the
  air, not at all while thrusting). It's your recovery — and the enemy's target.
- Rounds are stock-based: N lives each; fall → lose one, respawn after 1.5 s at
  the spawn farthest from enemies. Survive longest → your team scores the round;
  first to 3 rounds takes the match.

## Modes

| Mode | Rules |
|---|---|
| Last Man Standing | FFA; last player with stock wins the round |
| Masters vs Blasters | Two teams (ninjas vs cowboys), no friendly fire |
| Timed Game | 5:00 clock; most lives at expiry wins; tie → sudden death (next KO) |

## Weapons

| | Rocket Launcher | Lightsaber | Sniper Rifle | Mini Nuke |
|---|---|---|---|---|
| source | loadout, ∞ ammo | loadout, ∞ | sky drop, 3 | sky drop, 1 |
| delivery | 28 m/s projectile, splash r4 | 2.3 m / 110° cone melee | hitscan | 16 m/s lobbed, splash r10 |
| damage | 22 | 8 | 15 | 45 |
| knockback ×| 1.0 | 1.25 **+ drains 30 jet energy** | 1.6 | 1.5 |
| role | bread and butter | anti-recovery finisher | edge-guarding | crowd eraser |

Self-splash: 0.4× damage, **1.0× knockback** — rocket jumping is core mobility and
the fastest recovery tool.

## Knockback formula

```
kb = (3.0 + dmg·0.10) · (1 + 2.5·(1 − hp/100)) · weaponMult · quadMult
```
Applied after damage, from the blast toward the victim, up-biased (dir.y ≥ 0.35),
additive to velocity (juggles work). Ground grip is suppressed 0.35 s after a hit
so victims actually slide off edges. A 0-hp victim flies 3.5× as far as a fresh one.

## The sky provides (Daedalus' mechanic)

Every 10–18 s a pickup falls slowly from the sky onto a map pickup spot, beam of
light announcing it: Health +50 (30%), Energy refill (30%), Sniper (15%), Quad
Damage ×2.5 for 12 s (15%), Mini Nuke (10%). Contesting the drop point is the map's
heartbeat.

## Bots

Three tiers — Greenhorn, Gunslinger, Master — one brain, different parameter rows
(reaction, aim jitter, projectile lead, edge-guard rate, jetpack discipline).
Behaviors: fight (orbit-strafe, lead rockets, splash feet), collect (walk needed
drops), edgeGuard (punish recoveries), recover (feather the jetpack home). Bots are
UserCmd-emitting players; they cheat at nothing.

## Maps (data files; refine from memory)

- **Test Arena** — symmetric tuning cross (center pad, four satellites, top pad)
- **MB Moontop** — the author's map: low gravity, lunar plateau, high perches
- **MB Crusher** — the author's map: sweeper blocks patrol the press floor; ferry
  platforms shuttle along the flanks
- **MB Quake** — sunken pit, corner towers, rim bridges, mega-health perch
- **MB Hyrule** — big temple stage, side pillars, float platform; edge-guard duels

## Presentation

Greybox-plus: flat-shaded platforms with theme palettes per map, procedural
cowboy/ninja capsule bodies (hats vs head wraps), emissive projectiles, expanding
explosion shells, jet flames, drop beams. First-person default; C toggles an
over-shoulder third person. HUD leads with the two meters that decide fights:
**HP%** (your knockback vulnerability) and **jet energy** (your life line).
