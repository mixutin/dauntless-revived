---
title: Linux launcher
parent: Setup
nav_order: 3
description: "Install and run Dauntless Revived on Linux: Ubuntu, Debian, Mint, Pop!_OS, Fedora, openSUSE, Arch, EndeavourOS, CachyOS, Manjaro, NixOS, Gentoo, Void and other x86_64 distributions."
lang: en
ref: setup/linux
---

{% assign friends_page = site.pages | where: "path", "setup/friends.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}

# Linux launcher
{: .no_toc }

Dauntless Revived Launcher runs natively on **x86_64 Linux**. The actual Dauntless 1.4.4 game is still
the original Windows x86_64 build, so the launcher starts it through **Proton or Wine**. You use the
same invite, account and server as a Windows player.

**Steam Deck:** Follow the dedicated [Steam Deck setup, 800p preset, and video compatibility guide](steam-deck.html). Handheld support is still experimental and has not been live-tested on a Deck.

The launcher does not contain game files. It downloads or verifies the same pinned 1.4.4 files as
the Windows build, installs the two pinned DLLs, creates a separate compatibility prefix and sets the
required native `dxgi` override automatically.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Before you start

You need:

- an **x86_64** Linux desktop using glibc;
- working graphics drivers, including Vulkan support for the normal Proton/DXVK path;
- either an existing compatibility runtime (Steam Proton, Proton-GE, Wine, or Lutris Wine) or a desktop that can authorize the launcher's automatic Wine install;
- about 11 GB for the game, plus free space for downloads and the compatibility prefix;
- Tailscale only when your host gave you a private/v1 invite.

ARM64 is not supported by this launcher because the game itself is Windows x86_64. Alpine and other
musl-only systems are not currently advertised as supported because Electron's official Linux build
targets glibc.

Download the newest launcher from
[GitHub Releases](https://github.com/mixutin/dauntless-revived/releases/latest). Every launcher
release has these Linux files:

| File | Best for |
|:--|:--|
| `DauntlessRevivedLauncher-<version>-linux-x86_64.AppImage` | Universal option for most desktop distributions |
| `DauntlessRevivedLauncher-<version>-linux-amd64.deb` | Debian, Ubuntu, Mint, Pop!_OS and derivatives |
| `DauntlessRevivedLauncher-<version>-linux-x86_64.rpm` | Fedora, openSUSE and other conventional RPM systems |
| `DauntlessRevivedLauncher-<version>-linux-x64.tar.gz` | Portable fallback, especially Arch/Gentoo/other glibc distros |
| `DauntlessRevivedLauncher-<version>-linux-x64.zip` | Same portable app in ZIP form |

Also download `SHA256SUMS.txt`. Check your download before running it:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

The output for the file you downloaded should say **OK**.

## Ubuntu, Debian, Linux Mint and Pop!_OS

Use the `.deb` package:

```bash
cd ~/Downloads
sudo apt install ./DauntlessRevivedLauncher-*-linux-amd64.deb
```

Using `apt install ./file.deb` lets APT resolve package dependencies. Ubuntu documents local
`.deb` installation with this command.

For the game runtime, the launcher searches native Steam **and Flatpak Steam** for installed Proton
versions. Wine also works. If no supported runtime exists, packaged Linux builds can ask Polkit for
authorization and install the distro's Wine package automatically when you press **PLAY**. Set
`DAUNTLESS_REVIVED_AUTO_INSTALL=0` before starting the launcher if you prefer to manage dependencies
yourself.

After installation, launch **Dauntless Revived Launcher** from the application menu. The default game
folder is:

```text
~/Games/DauntlessRevived
```

To update, download the newer `.deb` and run the same `apt install ./...` command. To remove only
the launcher:

```bash
sudo apt remove dauntless-revived-launcher
```

Removing the launcher does not intentionally delete the game folder or your launcher user data.

## Fedora, Nobara, Rocky Linux, AlmaLinux and other DNF systems

On a normal mutable Fedora/RHEL-family desktop, use the RPM:

```bash
cd ~/Downloads
sudo dnf install ./DauntlessRevivedLauncher-*-linux-x86_64.rpm
```

Fedora provides Wine as the `wine` meta-package:

```bash
sudo dnf install wine
```

You can instead use Steam Proton. Native Steam installations are auto-detected. On Fedora, Steam is
commonly installed from RPM Fusion; Nobara normally already has gaming-oriented runtime support.

For **Bazzite, Fedora Silverblue, Kinoite and other immutable/Atomic systems**, prefer the AppImage
rather than layering the launcher RPM into the base image:

```bash
chmod +x DauntlessRevivedLauncher-*-linux-x86_64.AppImage
./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

If your Steam installation is a Flatpak, read [Flatpak Steam and Proton](#flatpak-steam-and-proton)
below.

To remove the RPM install:

```bash
sudo dnf remove dauntless-revived-launcher
```

## openSUSE Tumbleweed and Leap

Use the RPM directly with Zypper:

```bash
cd ~/Downloads
sudo zypper install ./DauntlessRevivedLauncher-*-linux-x86_64.rpm
```

openSUSE's Zypper documentation supports installing an RPM by local file path.

Install Wine if you are not using Steam Proton:

```bash
sudo zypper install wine
```

Then launch **Dauntless Revived Launcher** from the desktop menu.

Update by installing the newer RPM with the same `zypper install ./...` command. Remove it with:

```bash
sudo zypper remove dauntless-revived-launcher
```

## Arch Linux, EndeavourOS, CachyOS and Manjaro

Use the AppImage or portable tarball. There is no project-maintained AUR package yet.

AppImage:

```bash
cd ~/Downloads
chmod +x DauntlessRevivedLauncher-*-linux-x86_64.AppImage
./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

Portable tarball:

```bash
mkdir -p ~/.local/opt/dauntless-revived
tar -xzf DauntlessRevivedLauncher-*-linux-x64.tar.gz -C ~/.local/opt/dauntless-revived
~/.local/opt/dauntless-revived/DauntlessRevivedLauncher
```

For Steam Proton on Arch-family systems, enable the `multilib` repository and install Steam:

```bash
sudo pacman -Syu
sudo pacman -S steam
```

ArchWiki documents Steam in `multilib`. Start Steam once and install/enable a Proton version; the
launcher searches native Steam's normal compatibility-tool directories.

Or use Wine:

```bash
sudo pacman -S wine
```

CachyOS/EndeavourOS/Manjaro may provide additional Wine/Proton packages. They are fine too; if a
runtime is installed in a nonstandard directory, use one of the runtime override variables described
under [Choosing Proton or Wine](#choosing-proton-or-wine).

## NixOS

A normal AppImage does not run directly on NixOS because NixOS does not expose the usual FHS library
paths. Use `appimage-run`.

One-off run:

```bash
nix-shell -p appimage-run --run 'appimage-run ./DauntlessRevivedLauncher-*-linux-x86_64.AppImage'
```

For permanent AppImage support, add this to `/etc/nixos/configuration.nix`:

```nix
programs.appimage = {
  enable = true;
  binfmt = true;
};

programs.steam.enable = true;
```

Then rebuild:

```bash
sudo nixos-rebuild switch
```

The official NixOS wiki documents both `appimage-run` and `programs.appimage.binfmt`, and
`programs.steam.enable = true` for Steam/Proton.

If you install GE-Proton declaratively, NixOS also supports:

```nix
programs.steam.extraCompatPackages = with pkgs; [
  proton-ge-bin
];
```

If the launcher does not find that Proton build automatically, point
`DAUNTLESS_REVIVED_PROTON` at its actual `proton` script.

## Gentoo

The portable tarball is the simplest choice:

```bash
mkdir -p ~/.local/opt/dauntless-revived
tar -xzf DauntlessRevivedLauncher-*-linux-x64.tar.gz -C ~/.local/opt/dauntless-revived
~/.local/opt/dauntless-revived/DauntlessRevivedLauncher
```

The AppImage is also usable on an appropriately configured desktop.

Gentoo ships Valve's Wine fork as `app-emulation/wine-proton` on amd64:

```bash
sudo emerge --ask app-emulation/wine-proton
```

If the executable is not exposed under the usual `wine` or `wine64` name in `PATH`, set
`DAUNTLESS_REVIVED_WINE` to the Wine executable before starting the launcher.

## Void Linux

Use the AppImage or portable tarball:

```bash
chmod +x DauntlessRevivedLauncher-*-linux-x86_64.AppImage
./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

or:

```bash
mkdir -p ~/.local/opt/dauntless-revived
tar -xzf DauntlessRevivedLauncher-*-linux-x64.tar.gz -C ~/.local/opt/dauntless-revived
~/.local/opt/dauntless-revived/DauntlessRevivedLauncher
```

Install Wine from the Void repositories if you do not use Steam Proton:

```bash
sudo xbps-install -S wine
```

If your runtime is somewhere unusual, use the override variables below.

## Solus, Mageia, OpenMandriva and other glibc distributions

Start with the **AppImage**. It avoids depending on the distro's package format:

```bash
chmod +x DauntlessRevivedLauncher-*-linux-x86_64.AppImage
./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

If AppImage integration is awkward on that distro, use the portable `.tar.gz` instead.

Mageia/OpenMandriva and other conventional RPM systems can also try the RPM with their normal RPM
package manager. The launcher itself does not require the game to be installed through Steam; it only
needs an accessible Proton or Wine runtime when you press **PLAY**.

## Flatpak Steam and Proton

The launcher automatically searches native Steam locations such as:

```text
~/.local/share/Steam
~/.steam/root
~/.steam/steam
```

Flatpak Steam normally stores its files under:

```text
~/.var/app/com.valvesoftware.Steam/data/Steam
```

That location is searched automatically. Start Flatpak Steam once and install at least one Proton
version; the launcher will find it without a wrapper or environment variable.

You can still use `DAUNTLESS_REVIVED_PROTON` to force one exact Proton script when troubleshooting
or when your Steam library is in a nonstandard location.

## Choosing Proton or Wine

Runtime selection is:

1. `DAUNTLESS_REVIVED_PROTON`, when explicitly set;
2. `DAUNTLESS_REVIVED_WINE`, when explicitly set;
3. Steam Proton / Proton-GE in native Steam's normal directories;
4. Steam Proton / Proton-GE from Flatpak Steam;
5. `wine64` or `wine` from `PATH`;
6. Lutris Wine under `~/.local/share/lutris/runners/wine`;
7. if none exists and automatic dependency installation is enabled, the distro's Wine package is installed through Polkit and detected again.

Examples:

```bash
DAUNTLESS_REVIVED_PROTON="$HOME/.local/share/Steam/compatibilitytools.d/GE-Proton10-1/proton" \
  ./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

```bash
DAUNTLESS_REVIVED_WINE=/usr/bin/wine64 \
  ./DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

The launcher creates its own prefix in its Electron user-data directory. Do not point it at an
existing Steam game's prefix.

## Join and install the game

After the launcher opens, the flow is the same on every Linux distro:

1. Open or paste the host's `dauntless-revived://join?...` invite.
2. Press **JOIN**.
3. Register a username, or import your existing account key.
4. Save the offered key backup somewhere private.
5. Press **INSTALL**. The default game directory is `~/Games/DauntlessRevived`.
6. If you already have the exact 1.4.4 files, use **I already have the game files** and choose that
   Linux folder instead.
7. Press **PLAY**. The launcher creates/prepares its Wine/Proton prefix, writes the game's config and
   starts `Dauntless-Win64-Shipping.exe` through the selected runtime.

For private/v1 invites, install Tailscale on the Linux PC and accept the host's share first. Public/v2
invites do not require Tailscale.

For the rest of the player workflow, see
[Join as a friend]({{ friends_page.url | relative_url }}).

## Common Linux problems

### "Linux needs Proton or Wine"

No supported runtime was found and automatic installation could not provide one. Normally the launcher
offers to install Wine through your distro's package manager when you press **PLAY**. You can also
install Steam + Proton, Wine, or Lutris Wine yourself. If a runtime is in a nonstandard location, set
`DAUNTLESS_REVIVED_PROTON` or `DAUNTLESS_REVIVED_WINE`.

### "The operating system couldn't store your key securely"

Linux account keys use Electron's encrypted desktop secret store. The launcher now repairs missing
desktop D-Bus variables, selects GNOME/libsecret when a GNOME-family keyring is present, and packaged
builds can install `gnome-keyring`/libsecret through Polkit when those dependencies are missing.
The DEB also recommends those packages during installation. If you deliberately disabled automatic
dependency installation, install your desktop's Secret Service/KWallet provider yourself.

### AppImage does not start

First confirm it is executable:

```bash
chmod +x DauntlessRevivedLauncher-*-linux-x86_64.AppImage
```

On NixOS, use `appimage-run`. On another distro where AppImage/FUSE integration is unavailable,
use the portable tarball instead.

### Discord says Dauntless is running, but no game window appears

Update to **launcher 0.1.13 or newer** first. Launcher 0.1.12 could start Proton and set Discord
activity while the game itself remained stuck before Unreal Engine created its window. The injected
`UndauntedInternalServer.dll` was doing Windows console setup during Wine/Proton DLL initialization;
under Proton this could leave `Dauntless-Win64-Shipping.exe` alive with only its initial thread and
no UE log or visible window.

0.1.13 detects Wine/Proton and skips that client debug-console initialization. The launcher still
installs the normal native `dxgi` override and the Revived DLL; do not remove those files as a
permanent workaround.

On GNOME/Wayland, 0.1.13 also preserves the session's `XAUTHORITY` for Proton. If a wrapper or
remote shell strips that variable, the launcher recovers Mutter's `.mutter-Xwaylandauth.*` file
from `XDG_RUNTIME_DIR`. Without a valid XWayland cookie, Wine can reach normal UE/DXVK startup but
fail to present the game window and print `Authorization required, but no authorization protocol
specified`.

A useful diagnosis is:

```bash
pgrep -af Dauntless-Win64-Shipping.exe
```

If the process exists but no window appears, check the launcher version before changing graphics
drivers or the Proton prefix.

### The launcher opens, but PLAY fails

Run it from a terminal once so you can see startup errors, then check the launcher's own log directory
under its Electron user-data folder. Common causes are:

- using launcher 0.1.12 or older with the Proton client-init deadlock above;
- broken/missing Vulkan drivers;
- a Proton/Wine runtime that was moved after the launcher found it;
- a Steam/Flatpak Steam Proton install that is incomplete or was moved;
- permission problems in the selected game folder;
- a game folder that is not the exact pinned 1.4.4 build.

Try a different installed Proton or Wine runtime before modifying the game files.

### Public server starts, but the game never reaches it

Public/v2 invites deliberately do **not** pass the public gateway address straight to the game.
The launcher starts a local relay on `127.0.0.1:61000`, pins the host's TLS certificate there, writes
the game config to use that local endpoint and then forwards the game's HTTP/WebSocket traffic to the
selected public server. Keep the launcher open while playing; closing it stops the relay.

If the launcher log shows `relay listening on 127.0.0.1:61000` followed immediately by
`relay stopped (0 requests, ...)`, the game never reached the networking stage. On Linux, first
rule out the 0.1.12 client-init hang above. If the game window is running, then check the selected
server/invite and certificate instead.

### Private server cannot connect

Check Tailscale first:

```bash
tailscale status
tailscale ping <host-name-or-100.x.y.z>
```

The launcher searches `/usr/bin/tailscale`, `/usr/local/bin/tailscale`, `/snap/bin/tailscale`
and your `PATH`.

More general launcher/server problems are on
[Troubleshooting]({{ trouble_page.url | relative_url }}).

## Updates

Linux does not use the Windows Squirrel auto-update feed. When a newer launcher is released:

- DEB: download it and run `sudo apt install ./new-file.deb`;
- RPM: install the newer RPM with DNF or Zypper;
- AppImage: replace the old AppImage;
- portable ZIP/tar.gz: replace the application folder.

Your downloaded game and launcher user data are separate from the launcher package.
