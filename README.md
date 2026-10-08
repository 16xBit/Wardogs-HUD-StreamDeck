# Wardogs HUD - Stream Deck plugin

Reads the Wardogs HUD from the screen (screen capture + OCR) and shows live values on Stream Deck keys
and on the Stream Deck Neo infobar. It only looks at pixels on your screen: it never reads or modifies the
game's memory or files.

> Not affiliated with, endorsed by, or sponsored by the game's developers or publishers. Check the game's rules
> and anti-cheat policy before using any overlay or screen-reading tool. Use at your own risk.

## Keys
| Key | Shows | Only updated while piloting |
|---|---|---|
| SPD | helicopter speed (km/h) | yes |
| AGL | altitude above ground | yes |
| AMMO | ammo count (up to 4 digits) | yes |
| HP | health | no - keeps the last value when the HUD is hidden |
| Team Score | blue / red / green score, press to cycle | no - keeps the last value |
| Team Progress (Neo infobar) | three bars, one per team (0-100) | no |

"Piloting" is detected by the `ALT` label of the helicopter HUD. Keys show `--` when they have no value.

## Requirements
- Windows 10/11 (uses PowerShell and Windows screen capture), Stream Deck app 7.6 or newer, Node.js 20+
- Game in **borderless or windowed-fullscreen** mode on the **primary monitor** (exclusive fullscreen can't be captured)

## Install
```
npm i -g @elgato/cli
cd online.16xbit.wardogs-display.sdPlugin
npm install
streamdeck link .
```
Restart the Stream Deck app, then drag the actions from the "Wardogs HUD" category onto keys.
After editing code or the manifest: `streamdeck restart online.16xbit.wardogs-display`.

## First-time setup: tell the plugin which window is the game
Open `config.json` and fill in `game.processNames` (the "WardogsClient-Win64-Shipping" is used by default but can be changed if developers change the name) and/or
`game.windowTitleContains`. While one of them is set, the plugin only captures the screen when the game is the
active window. While both are empty the check is off and the log says so once.
If you need to find the process name: set `"debugSaveCrops": true`, click into the game, and read the `active process: ...`
line in the plugin log (`%appdata%\Elgato\StreamDeck\Plugins\online.16xbit.wardogs-display.sdPlugin\logs`).

## Other resolutions and monitors
All coordinates in `config.json` are measured on a 3840x2160 reference and are scaled to your screen.
- **Any 16:9 resolution** (3840x2160, 2560x1440, 1920x1080): works with the shipped settings. At low resolutions the
  digits are small, so you may need a higher `scale` for the affected region.
- **Other aspect ratios (ultrawide, 16:10):** regions have an `anchor` (`left`, `center` or `right`) and keep their
  distance from that screen edge, scaled by screen height. This assumes the game's HUD is anchored the same way;
  verify it with `debugSaveCrops` and adjust the regions if not.
- **Not supported without recalibration:** a game window that does not fill the screen, the game on a secondary
  monitor, a non-default HUD scale, a non-English game (change `gate.text`), or a different aircraft HUD.
- If the HUD moves after a game update, adjust `x/y/w/h` of the affected region and check `debug/<name>.png`.

## Configuration (`config.json`, re-read every tick - no restart needed)
- Per region: `anchor`, `valign`, `threshold`, `mode` (`lum|max|sat|otsu`), `scale`, `psm`, `maxDigits`, `maxValue`,
  `maxJump`, `minConfidence`, `confirmReads`, `everyMs`, `gated`, `holdLast`, and `piloting`
  (coordinate overrides while piloting).
- `debugSaveCrops: true` saves what the OCR sees to `debug/` and logs each read. Use it when recalibrating a region,
  then turn it off again.
- A mistake while editing is reported in the log and the last working settings stay active.

## Privacy and security
- Everything runs locally. The plugin makes no network requests: the English OCR model ships in `tessdata/`
  (downloading it is off unless you set `"allowModelDownload": true`).
- It captures only the small HUD regions listed in `config.json`, only while the game is the active window (when
  configured), and keeps them in memory. Images are written to disk only while `debugSaveCrops` is on.
- The capture helper runs as a single PowerShell script at a fixed path with `-ExecutionPolicy Bypass` for that one
  process (needed because files downloaded from GitHub are marked as coming from the internet). Values from
  `config.json` are validated as numbers and are never executed as commands.

## License
MIT - see `LICENSE`. Third-party components: see `THIRD_PARTY_NOTICES.md`.
