# Stock sound credits

These clips play in place of the synthesised sound for the cues they fit (see
`stockFor` in `src/audio/stock.ts`). Every file here is `<clip>-<n>.mp3`, one
variant of a clip set. They were taken from FanSong's stock sounds, which
converted them to mono MP3, trimmed leading and trailing silence and
peak-normalised them; nothing else was changed, except where noted ("edited"
below: layered with another clip, slowed).

They come from free projects, each taken from its Ubuntu 24.04 (noble)
package. Their licences:

- **CC0 1.0** (public domain): no conditions.
- **CC BY 4.0**: free to use with credit, given below.
- **CC BY-SA 3.0**: free to use with credit; the sound files themselves (and
  any edits of them) stay under CC BY-SA 3.0. This does not extend to the rest
  of the game. The licence: https://creativecommons.org/licenses/by-sa/3.0/

## C-Dogs SDL (`cdogs-sdl-data`)

https://cxong.github.io/cdogs-sdl/ — each sound's original author and licence,
as listed in the package's `debian/copyright`:

| Files | Original | Author | Licence |
|---|---|---|---|
| `hit-0`…`hit-8` | hits/knife_flesh — https://freesound.org/people/lmbubec/sounds/118792/, https://freesound.org/people/MrPokephile/sounds/155973/ | lmbubec, MrPokephile | CC0 1.0 |
| `heavy-hit-1`…`heavy-hit-4` | hits/fist_flesh — https://freesound.org/people/CGEffex/sounds/98341/ | CGEffex | CC BY 4.0 |
| `armor-0`…`armor-4` | hits/knife_hard — https://freesound.org/people/geoffbarkman/sounds/53442/ | geoffbarkman | CC BY 4.0 |
| `death-0`…`death-4` | chars/die/man/3–7 — https://freesound.org/people/JohnsonBrandEditing/sounds/173944/ | JohnsonBrandEditing | CC0 1.0 |
| `victory-0` | victory — https://freesound.org/people/chripei/sounds/165491/ | chripei | CC BY 4.0 |

## Lugaru (`lugaru-data`)

https://osslugaru.gitlab.io/ — sounds © 2003, 2010 Wolfire Games, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `swing-0`…`swing-2` | LowWhoosh, MidWhoosh, HighWhoosh |
| `heavy-hit-0` | HeavyImpact |
| `clang-0`…`clang-3` | Clank1–Clank4 |
| `thud-0`…`thud-2` | Thud, Land1, Land2 |
| `parry-0` | SwordStaff |

## MegaGlest (`megaglest-data`)

https://megaglest.org/ — © 2001–2008 The Glest Team, 2008–2017 The MegaGlest
Team, CC BY-SA 3.0.

| Files | Original |
|---|---|
| `arrow-hit-0`…`arrow-hit-4` | techs/megapack/commondata/sounds/arrow_hit1–5 |

## Minetest (`minetest-data`, `minetest-mod-nether`)

https://www.minetest.net/ — Minetest Game's sounds are © 2010–2023 celeron55
(Perttu Ahola) and the Minetest Game contributors (listed in its
`mods/default/license.txt`), CC BY-SA 3.0. The Nether mod's lava bubbles are
© 2019–2021 Treer, CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/).

| Files | Original |
|---|---|
| `lava-0` | mods/default/sounds/default_cool_lava.1 (edited: faded), layered with the Nether mod's nether_lava_bubble and nether_lava_bubble.0 |
