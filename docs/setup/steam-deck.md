---
title: Steam Deck
parent: Setup
nav_order: 4
description: "Install the native Dauntless Revived Linux launcher on Steam Deck, enable the balanced 800p preset, and troubleshoot Proton cutscenes."
lang: en
ref: setup/steam-deck
---

# Steam Deck

**Experimental support.** Dauntless Revived launches the original Windows x86_64 Dauntless 1.4.4 client through Proton, but the launcher itself is a native x86_64 Linux app. This path has automated tests, not yet a confirmed real Steam Deck gameplay test. It is not a Steam Deck Verified claim.

## Install from Desktop Mode

1. Switch to **Desktop Mode** and install Steam/Proton from the normal SteamOS installation (do **not** disable SteamOS's read-only root or run a system-wide `pacman` installation).
2. Download the Linux **x64 tar.gz** release and matching `SHA256SUMS.txt` from [GitHub Releases](https://github.com/mixutin/dauntless-revived/releases/latest). The portable build avoids needing AppImage FUSE support. Verify the checksum against the published file.
3. Extract the archive into a permanent location such as `~/.local/opt/dauntless-revived`, then launch `DauntlessRevivedLauncher`. Run the **native Linux** executable, not the Windows installer through Proton.
4. In desktop Steam, select **Games → Add a Non-Steam Game → Browse**, find the Linux launcher executable, and add it to the library. Steam Input can use the right trackpad as a mouse and a trackpad click as the left mouse button. Use the touchscreen or Steam + X for the keyboard if necessary.
5. Return to **Gaming Mode**, start the shortcut, sign in using your existing server invite and account, and download/verify your own game files. Keep the launcher running while Dauntless is open: it relays public-server traffic.

Be aware the game itself still needs an installed Steam Proton or Proton-GE runtime; installing the launcher does not install the proprietary Dauntless game. For runtimes not discovered automatically, start the launcher with `DAUNTLESS_REVIVED_PROTON` pointing to your Proton `proton` script.

## Steam Deck graphics preset

Fresh Steam Deck installs detect SteamOS/Valve handheld hardware and select **Steam Deck · Balanced (800p)**. Existing player graphics preferences are preserved. Any Linux/Windows player can choose this preset manually from **Settings → Graphics**.

| Setting | Preset |
|:--|:--|
| Output | 1280 × 800, 16:10, borderless fullscreen |
| Internal resolution | 85% screen percentage |
| View distance / anti-aliasing / textures | 2 / 2 / 2 |
| Shadows / post effects / effects / shading | 1 / 1 / 1 / 1 |
| Foliage | 0 |
| Texture-streaming pool | 768 MB |
| Exposure | Game default (automatic exposure remains enabled) |

For a steadier frame rate or better battery life, try a 40 FPS limit using the Deck's own performance controls, then lower the in-game settings further if needed. This is a starting preset, **not an FPS guarantee**. If you select the optional **Poet fix / safe window**, that deliberately takes precedence for a 1280×720 window.

## Black cutscenes or missing intro video under Linux

The game bundles a 1080p H.264/AAC `Logo.mp4`, and our Ubuntu Wine/Proton logs showed repeated `dxva_video_decode_accelerator_win.cc` errors. That makes video acceleration a plausible contributor; it does **not** prove every missing cutscene uses this codec or is fixed.

**Settings → Graphics → Linux video compatibility** enables two reversible launch-time workarounds:

- `WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER=1` for the **game process**, a compatibility setting documented by Valve's Proton project for Media Foundation DXGI video issues.
- `-nocefaccelpaint` for the game executable, disabling accelerated CEF painting.

Both are applied by the native Linux launcher on Play. Windows clients are not changed. Restart the **game** after toggling. If playback or performance regresses, turn the switch off. If video is still black, try a current Proton-GE build and record the scene, Proton version, and sanitized log errors for an issue/discussion; do not upload account keys or copyrighted game files.

**Status:** Config generation and launch arguments have automated tests; video playback has not yet been confirmed on actual Steam Deck hardware or in every Dauntless cutscene. See the [Linux launcher guide](linux.html) for general compatibility and package instructions.
