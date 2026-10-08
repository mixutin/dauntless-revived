---
title: Asennus
parent: Dauntless Revived suomeksi
nav_order: 2
has_children: true
has_toc: false
description: "Dauntless Revived Windowsissa, Linuxissa tai OpenBSD:ssa: palvelimen pystytys, kavereiden liittyminen, ryhmäkäyttö ja vianetsintä."
lang: fi
ref: setup/index
locale: fi_FI
---

{% assign host_page = site.pages | where: "path", "fi/setup/host.md" | first %}
{% assign friends_page = site.pages | where: "path", "fi/setup/friends.md" | first %}
{% assign linux_page = site.pages | where: "path", "fi/setup/linux.md" | first %}
{% assign steamdeck_page = site.pages | where: "path", "fi/setup/steam-deck.md" | first %}
{% assign admin_page = site.pages | where: "path", "fi/setup/admin.md" | first %}
{% assign trouble_page = site.pages | where: "path", "fi/setup/troubleshooting.md" | first %}
{% assign winserver_page = site.pages | where: "path", "fi/setup/windows-server.md" | first %}
{% assign linuxserver_page = site.pages | where: "path", "fi/setup/linux-server.md" | first %}
{% assign openbsdserver_page = site.pages | where: "path", "fi/setup/openbsd-server.md" | first %}
{% assign partner_page = site.pages | where: "path", "fi/setup/hosting-partner.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "fi/setup/upgrading.md" | first %}
{% assign verification_page = site.pages | where: "path", "fi/findings/verification.md" | first %}
{% assign legal_page = site.pages | where: "path", "fi/legal.md" | first %}
{% assign reference_page = site.pages | where: "path", "fi/reference/index.md" | first %}

# Asennus

Nämä sivut ovat ohjeita niille, jotka haluavat pystyttää palvelimen tai liittyä kaverin
palvelimelle. Aito **Dauntless 1.4.4** -peliohjelma (lokakuu 2020, UE4, pak v9) keskustelee meidän
muokatun [Undaunted](https://github.com/SyST3MDeV/Undaunted)-versiomme kanssa. Windows on edelleen
pisimmälle oikeassa pelissä testattu palvelinpolku, mutta mukana ovat nyt myös erilliset Linux- ja
OpenBSD-porttaukset. Kaikki tämän osion tieto koskee versiota **1.4.4**. Pelin viimeinen versio 2.1.1
ei toimi tällä kokoonpanolla, koska palvelin-DLL käyttää 1.4.4:n kiinteitä muistiosoitteita.

Tarvitset **oman kopion** 1.4.4-peliohjelmasta. Tällä sivustolla ja lähdekoodissa ei ole
pelitiedostoja eikä linkkejä niiden latauksiin.

**Tilanne (1.10.2026).** Vuokrattu julkinen palvelin käyttää edelleen oikeassa pelissä testattua
[Windows-palvelinpakettia]({{ winserver_page.url | relative_url }}). Erillinen
[Linux-palvelin]({{ linuxserver_page.url | relative_url }}) ajaa ohjauspuolen natiivisti ja on läpäissyt
paikallisen 1.4.4-käynnistyssopimuksen smoke-testin; seuraava etappi on aito Proton/Wine Ramsgate +
metsästys. [OpenBSD-palvelin]({{ openbsdserver_page.url | relative_url }}) rakentuu ja testautuu aidossa
OpenBSD 7.9 -CI-virtuaalikoneessa ja käyttää erillistä Linux/Proton/Wine-pelityöntekijää; seuraava
etappi on täysi kahden koneen pelitesti.

## Sivut {#pages}

| Sivu | Kenelle | Mitä se kattaa |
|---|---|---|
| [Pystytä palvelin]({{ host_page.url | relative_url }}) | Palvelinta pyörittävälle | Version tarkistus, asennus lyhyeen polkuun, kahden DLL-tiedoston asennus kiinnitettyjä tiivisteitä vasten, asetustiedostot, metagamen ja deploy-palvelimen käynnistys, ensimmäisen käynnistyksen tarkistukset, peliohjelman käynnistys ja kaiken pysäyttäminen. Lopussa on yhden sivun käynnistyslista. |
| [Liity kaverina]({{ friends_page.url | relative_url }}) | Kutsutulle pelaajalle | Tailscale, pelitiedostojen tarkistus, kahden DLL-tiedoston kopiointi, rekisteröityminen henkilökohtaista tiliavainta varten, käynnistys ja se, mikä toimii juuri nyt. |
| [Linux-käynnistin]({{ linux_page.url | relative_url }}) | Linux-pelaajalle | Jakelukohtaiset ohjeet Ubuntulle/Debianille/Mintille/Pop!_OS:lle, Fedoralle, openSUSElle, Arch-sukuisille jakeluille, NixOS:lle, Gentoolle, Voidille sekä AppImage- ja tar-paketeille, mukaan lukien Proton/Wine. |
| [Steam Deck]({{ steamdeck_page.url | relative_url }}) | SteamOS-pelaajalle | Natiivi Linux-käynnistin, muu kuin Steam-peli -pikakuvake, 800p-grafiikka ja kokeellinen välivideokorjaus. |
| [Palvelin ryhmälle]({{ admin_page.url | relative_url }}) | Isännälle, kun kokonaisuus toimii jo paikallisesti | Tailscale-jako, Tailscale-liitäntään rajatut palomuurisäännöt, osoitteiden vaihtaminen, kutsukoodit ja tilit, ylläpitorajapinta, kapasiteetti ja tietokannan varmuuskopiot. Tavoitekokoonpano, jota ei ole vielä testattu alusta loppuun. |
| [Windows-palvelin]({{ winserver_page.url | relative_url }}) | Oikeassa pelissä pisimmälle testattuun Windows-polkuun | Yhden komennon Windows Server 2019+ -asennus nykyisine varmuuskopio- ja päivitystyökaluineen. Windows-porttia ei muutettu. |
| [Linux-palvelin]({{ linuxserver_page.url | relative_url }}) | Linux-isännälle | Natiivi Node/SQLite-ohjauspuoli, systemd, nftables sekä Dauntless 1.4.4 -peliprosessit Protonilla/Winellä. Mukana yhden koneen asennus ja erillinen Linux-pelityöntekijä. |
| [OpenBSD-palvelin]({{ openbsdserver_page.url | relative_url }}) | OpenBSD-isännälle + Linux-pelityöntekijälle | Natiivi OpenBSD 7.9 -ohjauspuoli rc.d:llä ja PF:llä. Peliprosessit käynnistetään rajatulla SSH-yhteydellä Linux/Proton/Wine-työntekijällä. |
| [Hosting-kumppani: EU Gamehost]({{ partner_page.url | relative_url }}) | Vuokrattua rautaa haluavalle hostille | Selkeästi merkitty kumppani-/mainossivu, pakettiesimerkit, omiin mittauksiin perustuva kapasiteettiperuste ja suorat pakettilinkit. |
| [Vianetsintä]({{ trouble_page.url | relative_url }}) | Kaikille | Ongelmat, joihin oikeasti törmäsimme, syineen ja korjauksineen. Muutama kohta on peräisin koodin lukemisesta, ja ne on merkitty sellaisiksi. |
| [Päivitysohjeet]({{ upgrade_page.url | relative_url }}) | Isännälle ennen sellaisen palvelimen päivitystä, jolla on jo pelaajia | Mitä kukin päivitys muuttaa pelaajille ja mitä pitää päättää ensin. Nyt: oikea eteneminen on oletuksena päällä, joten aiemmin pelanneet aloittavat Slayer-tasolta 1, ellet pidä heidän maksimitasojaan tai jatka tyngällä. |

## Suositeltu järjestys {#suggested-order}

1. Valitse palvelinalusta: [Windows]({{ winserver_page.url | relative_url }}),
   [Linux]({{ linuxserver_page.url | relative_url }}) tai
   [OpenBSD + Linux-työntekijä]({{ openbsdserver_page.url | relative_url }}). Manuaaliseen yhden koneen
   kehityspolkuun käytä sivua [Pystytä palvelin]({{ host_page.url | relative_url }}).
2. Isäntä: seuraa sivua [Palvelin ryhmälle]({{ admin_page.url | relative_url }}) tilejä, kutsuja ja
   ryhmäkäyttöä varten.
3. Linux-kaveri: asenna käynnistin sivun [Linux-käynnistin]({{ linux_page.url | relative_url }}) mukaan.
4. Jokainen kaveri: seuraa sivua [Liity kaverina]({{ friends_page.url | relative_url }}).

Näiden ohjeiden taustalla olevat tarkat tiedot (jokainen asetus, portti, HTTP-reitti, tiedosto ja
skriptin parametri oletusarvoineen) ovat [Tekninen viite]({{ reference_page.url | relative_url }}) -osiossa.

Sivulla [Pelitiedostojen tarkistaminen]({{ verification_page.url | relative_url }}) kerrotaan
yksityiskohtaisesti, miten tarkistimme, että oma pelikopiomme on aito, täydellinen ja puhdas. Jos
pyörität muokattua versiota muille ihmisille, lue ensin [Kiitokset ja lisenssi]({{ legal_page.url | relative_url }}):
AGPL-lisenssi vaatii, että tarjoat heille lähdekoodin.
