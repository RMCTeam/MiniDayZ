# MiniDayZ (Plus)

###### The Browser (and PC) port of Bohemia Interactive's mobile game

[![Survivor](./survivor.png)](https://nextdev56.github.io/MiniDayZ/)

## Notes
* Current build is **Plus 1.2**
* You can change controls from stick to tap/draw (better for PC)
* Try to F11/Fullscreen before the game loads

___
## This fork (PC friendly)

Additions on top of upstream, targeting the **Plus 1.2** build in [`docs/`](docs):

* **PC Mode** – keyboard + mouse support (`docs/pc-mode.js`). The original game is
  touch-first, so this overlay translates keyboard/mouse input into the same
  pointer events the engine already handles. No game data is modified.
  * `W A S D` / arrows – move (virtual stick)
  * hold **left mouse** – walk toward the cursor
  * `Space` / `J` – attack / use · `F` – interact
  * `E` / `I` / `Tab` – inventory · `R` – reload · `M` – map · `C` – craft · `Esc` – menu
  * `H` – toggle help · `F1` – enable/disable PC Mode
  * Rebind anything from the console via `window.PCMODE_CONFIG`.
  * Tip: set the in-game control mode to **By tap** for the smoothest feel.
* **Loading screen fix** – the canvas is pinned to the viewport and re-fitted on
  load/resize, and the page background matches the MiniDayZ loading sky so the
  loading screen no longer sits in a small box with black bars.
* **`run.sh`** – one-command local launcher (serves the build over HTTP and opens
  your browser, since the game cannot be opened via `file://`).

### Run locally
```bash
./run.sh              # Plus 1.2 (docs/) -> http://localhost:8000
./run.sh original     # Original 1.4.1
./run.sh reloaded     # Reloaded 1.1
./run.sh --app        # fullscreen Chrome/Chromium app window
```

___
## [Original 1.4.1](https://raw.githack.com/NextDev65/MiniDayZ/main/original_docs/index.html) by [Bohemia Interactive](https://minidayz.com/home)
  * https://minidayz.com/blog/mini-dayz-browser-version-will-no-longer-be-supported (bohemia stopped hosting)
## Mods
  * ### [Reloaded 1.1](https://raw.githack.com/NextDev65/MiniDayZ/main/reloaded_docs/index.html) by [Kev3232](https://discord.gg/CSktjeQWtC)
  * ### [Plus 1.2](https://nextdev65.github.io/MiniDayZ/) by [Altero](https://discord.gg/CSktjeQWtC)
    * Exported to apk by [meterpreter](https://github.com/MeterPreter57/)
