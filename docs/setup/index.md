---
title: Setup
nav_order: 2
has_children: true
has_toc: false
description: "How to run Dauntless Revived on Windows, Linux or OpenBSD, let invited friends join, run it for a group, and fix common problems."
lang: en
ref: setup/index
---

{% assign host_page = site.pages | where: "path", "setup/host.md" | first %}
{% assign friends_page = site.pages | where: "path", "setup/friends.md" | first %}
{% assign linux_page = site.pages | where: "path", "setup/linux.md" | first %}
{% assign steamdeck_page = site.pages | where: "path", "setup/steam-deck.md" | first %}
{% assign admin_page = site.pages | where: "path", "setup/admin.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}
{% assign winserver_page = site.pages | where: "path", "setup/windows-server.md" | first %}
{% assign linuxserver_page = site.pages | where: "path", "setup/linux-server.md" | first %}
{% assign openbsdserver_page = site.pages | where: "path", "setup/openbsd-server.md" | first %}
{% assign partner_page = site.pages | where: "path", "setup/hosting-partner.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "setup/upgrading.md" | first %}
{% assign verification_page = site.pages | where: "path", "findings/verification.md" | first %}
{% assign legal_page = site.pages | where: "path", "legal.md" | first %}
{% assign reference_page = site.pages | where: "path", "reference/index.md" | first %}

# Setup

These pages describe how we run Dauntless Revived: the genuine **Dauntless 1.4.4** client (October
2020, UE4, pak v9) against our fork of [Undaunted](https://github.com/SyST3MDeV/Undaunted). The
original and most thoroughly live-tested server path is Windows, but there are now separate Linux
and OpenBSD server ports as well. Everything in this section is about **1.4.4**. The final client,
2.1.1, does not work with this setup, because Undaunted's server DLL hooks fixed addresses inside the
1.4.4 executable.

You need **your own copy** of the 1.4.4 client. This site and the repository contain no game files and
do not link to downloads.

**Status (1 October 2026).** The rented public server still runs the live-tested
[Windows server kit]({{ winserver_page.url | relative_url }}). The separate
[Linux server port]({{ linuxserver_page.url | relative_url }}) builds the control plane natively and
has passed a local end-to-end launch-contract smoke test with the pinned 1.4.4 tree; a real
Proton/Wine Ramsgate + hunt session is the next milestone. The
[OpenBSD server port]({{ openbsdserver_page.url | relative_url }}) builds/tests the Node control plane
inside a real OpenBSD 7.9 CI VM and uses a separate Linux Proton/Wine game worker; its final milestone
is a live two-machine game session.

## Pages

| Page | For | What it covers |
|---|---|---|
| [Host a server]({{ host_page.url | relative_url }}) | The person running the server | Verifying the build, installing it at a short path, placing the two DLLs with pinned hashes, the config files, starting the metagame and deploy server, first-boot checks, launching the client, and stopping everything. Ends with a one-page start checklist. |
| [Join as a friend]({{ friends_page.url | relative_url }}) | An invited player | Tailscale, checking your game files, copying the two DLLs, registering for a personal account key, launching, and what works right now. |
| [Linux launcher]({{ linux_page.url | relative_url }}) | A Linux player | Distro-by-distro launcher install instructions for Ubuntu/Debian/Mint/Pop!_OS, Fedora, openSUSE, Arch-family systems, NixOS, Gentoo, Void and universal AppImage/tarball installs, plus Proton/Wine setup. |
| [Steam Deck]({{ steamdeck_page.url | relative_url }}) | SteamOS handheld player | Native Linux launcher, non-Steam shortcut, balanced 800p preset and experimental Linux cutscene compatibility. |
| [Run it for a group]({{ admin_page.url | relative_url }}) | The host, once the stack runs locally | Tailscale sharing, firewall rules scoped to the Tailscale interface, switching addresses, invite codes and accounts, the admin API, capacity, and database backups. Target configuration, not yet tested end to end. |
| [Windows server kit]({{ winserver_page.url | relative_url }}) | The host, for the live-tested Windows path | One command installs everything on Windows Server 2019+ with the current backup/update tooling. The existing Windows port is unchanged. |
| [Linux server]({{ linuxserver_page.url | relative_url }}) | A Linux host | Native Node/SQLite control plane, systemd, nftables and Dauntless 1.4.4 game processes through Proton/Wine. Includes a one-host install and a separate Linux game-worker mode. |
| [OpenBSD server]({{ openbsdserver_page.url | relative_url }}) | An OpenBSD host plus Linux game worker | Native OpenBSD 7.9 control plane with rc.d + PF. Game-server processes are forwarded to a restricted Linux Proton/Wine worker over SSH. |
| [Hosting partner: EU Gamehost]({{ partner_page.url | relative_url }}) | Hosts who want rented hardware | Clearly labelled partner/advertising content, current example plans, measured capacity rationale and direct plan links. |
| [Troubleshooting]({{ trouble_page.url | relative_url }}) | Everyone | Problems we actually hit, with causes and fixes. A few entries come from reading the code and are marked as such. |
| [Upgrade notes]({{ upgrade_page.url | relative_url }}) | The host, before updating a server that already has players | What each update changes for players and what to decide first. Now: real progression is on by default, so earlier players start at Slayer level 1 unless you keep their max ranks or stay on the stub. |

## Suggested order

1. Pick a server platform: [Windows]({{ winserver_page.url | relative_url }}),
   [Linux]({{ linuxserver_page.url | relative_url }}) or
   [OpenBSD + Linux worker]({{ openbsdserver_page.url | relative_url }}). For the manual single-PC
   development path, use [Host a server]({{ host_page.url | relative_url }}).
2. Host: follow [Run it for a group]({{ admin_page.url | relative_url }}) for accounts, invites and
   group-operation details.
3. Linux friends: install the launcher with [Linux launcher]({{ linux_page.url | relative_url }}).
4. Each friend: follow [Join as a friend]({{ friends_page.url | relative_url }}).

The exact facts behind these guides (every setting, port, HTTP route, file and script parameter,
with its default) are in the [Reference]({{ reference_page.url | relative_url }}) section.

How we checked that our copy of the game is genuine, complete and clean is described in detail on
[Verifying game files]({{ verification_page.url | relative_url }}). If you host a modified version
for other people, read [Credits and license]({{ legal_page.url | relative_url }}) first: the AGPL
requires you to offer them the source.
