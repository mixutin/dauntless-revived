---
title: Pelin asetukset
parent: Tekninen viite
grand_parent: Dauntless Revived suomeksi
nav_order: 5
description: "Mitä Dauntless Revived muuttaa 1.4.4-peliohjelmassa ja pelipalvelimissa: ini-tiedostot ja kuka ne kirjoittaa, komentorivit, kaksi DLL-tiedostoa, kiinnitetty versio ja metagamen tarjoama pelidata."
lang: fi
ref: reference/game-settings
locale: fi_FI
---

{% assign host_page = site.pages | where: "path", "fi/setup/host.md" | first %}
{% assign friends_page = site.pages | where: "path", "fi/setup/friends.md" | first %}
{% assign admin_page = site.pages | where: "path", "fi/setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "fi/setup/windows-server.md" | first %}
{% assign trouble_page = site.pages | where: "path", "fi/setup/troubleshooting.md" | first %}
{% assign verification_page = site.pages | where: "path", "fi/findings/verification.md" | first %}
{% assign ci_page = site.pages | where: "path", "fi/findings/client-internals.md" | first %}
{% assign mp_page = site.pages | where: "path", "fi/findings/multiplayer.md" | first %}
{% assign assets_page = site.pages | where: "path", "fi/findings/assets.md" | first %}
{% assign roadmap_page = site.pages | where: "path", "fi/roadmap.md" | first %}
{% assign config_page = site.pages | where: "path", "fi/reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "fi/reference/ports.md" | first %}
{% assign api_page = site.pages | where: "path", "fi/reference/api.md" | first %}
{% assign scripts_page = site.pages | where: "path", "fi/reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "fi/reference/development.md" | first %}

# Pelin asetukset
{: .no_toc }

Dauntless Revived ei koskaan muuta pelin omia tiedostoja. `Dauntless-Win64-Shipping.exe` pysyy
tavu tavulta samana kuin tarkistettu 1.4.4-versio. Kaikki, mitä hanke muuttaa pelin puolella, on
kolmessa paikassa:

1. **Kaksi DLL-tiedostoa** exe-tiedoston vieressä. Windows lataa ne jokaiseen Dauntless-prosessiin.
2. **Käyttäjän ini-tiedostot** Windows-tilin asetuskansiossa. Unreal lukee ne pak-tiedostojen
   sisällä olevien valmiiden (cooked) asetusten päälle.
3. **Komentorivi**, jolla peli käynnistetään.

Sama exe-tiedosto on sekä pelaajan peliohjelma että jokainen pelipalvelin. Toinen DLL-tiedostoista
päättää käynnistyksessä, kumpaa roolia prosessi hoitaa.

Tämä sivu on viiteaineisto: mitä kukin ohjelma tai skripti kirjoittaa mihinkin tiedostoon, tarkat
komentorivit, mitä DLL-tiedostot tekevät ja kiinnitetyn version tiedot. Vaiheittaiset ohjeet ovat
sivuilla [Pystytä palvelin]({{ host_page.url | relative_url }}),
[Liity kaverina]({{ friends_page.url | relative_url }}) ja
[Windows-palvelin]({{ winserver_page.url | relative_url }}). Ympäristömuuttujat ovat
[asetusten viitesivulla]({{ config_page.url | relative_url }}), portit
[porttien viitesivulla]({{ ports_page.url | relative_url }}) ja näitä tiedostoja kirjoittavat skriptit
[skriptien viitesivulla]({{ scripts_page.url | relative_url }}).

<details open markdown="block">
  <summary>Sisältö</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Pikakatsaus {#at-a-glance}

| | Pelaajan peliohjelma | Pelipalvelin |
|:--|:--|:--|
| Exe | `Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe` kiinnitetystä versiosta | Sama exe |
| DLL-tiedostot | `dxgi.dll` ja `UndauntedInternalServer.dll` exen vieressä | Samat kaksi tiedostoa |
| Kuka käynnistää | Käynnistin (`UndauntedLauncher/`), kaveripaketin `play.ps1` tai isännän oma `play.ps1` | Deploy-palvelin (`UndauntedDeployServer/`) |
| Ensimmäinen parametri | Metagamen osoite, `host:port` | Pelipalvelimen avain (salainen) |
| Palvelin-DLL:n tila | Client-tila: vastaa taustapalvelun osoiteavaimiin suoraan muistissa | Palvelintila: komentorivillä on `-server` |
| `Engine.ini` | Muistirivit, valinnainen pakotettu grafiikkataso ja chatin uudelleenohjaus | Muistirivit ja chatin uudelleenohjaus |
| `Game.ini` | Ei tarvita | **Pakollinen**: 167 lainausmerkeissä olevaa osoiteohitusta |
| `GameUserSettings.ini` | `sg.*Quality`-rivit pakotetun tason mukaisiksi, jos taso pakotetaan | Ei kosketa |
| Kenen asetuskansio | Pelaajan Windows-tilin | Deploy-palvelinta ajavan tilin: käsin pystytetyllä isäntäkoneella omistajan tili, paketilla asennetulla palvelimella palvelutili `dauntless` |

---

## Käyttäjän asetuskansio {#config-folder}

```text
%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\
```

Unreal lukee ensin pak-tiedostojen valmiit oletusarvot ja sitten tämän kansion. Täällä asetettu
avain voittaa. Kansio kuuluu sille Windows-tilille, joka ajaa prosessia: toisella tilillä käynnistetty
pelipalvelin lukee sen tilin kansiota, ei sinun. 1.4.4 ja 2.1.1 käyttävät samaa kansiota, koska
kummankin sisäinen nimi on `Archon`. Siirrä toisen version kansio sivuun ennen kuin vaihdat versiota,
kuten sivun [Pystytä palvelin vaiheessa 6]({{ host_page.url | relative_url }}#config-folder) kerrotaan.

| Tiedosto | Kirjoittaako peli sitä? | Mitä tämä hanke laittaa siihen |
|:---------|:------------------------|:-------------------------------|
| `Engine.ini` | Kyllä. Kirjoittaessaan se säilyttää kaksi osiotamme. | `[SystemSettings]` ja `[OnlineSubsystemMcp.XMPP]` |
| `Game.ini` | Kyllä. Lainausmerkeissä olevat arvot säilyvät uudelleenkirjoituksessa. | `[OnlineSubsystemPhoenix]` ja 167 osoiteohitusta, vain pelipalvelimille |
| `GameUserSettings.ini` | Kyllä, asetusvalikosta | Sen olemassa olevat `sg.<ryhmä>Quality`-rivit, vain kun grafiikkataso pakotetaan |
| `Input.ini`, `RuntimeOptions.ini` ja muut | Kyllä | Ei mitään |

Mitä kansiota missäkin käytetään:

| Kokoonpano | Kansio |
|:-----------|:-------|
| Pelaajan kone (käynnistin tai kaveripaketti) | Pelaajan oma `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\`. Jos `LOCALAPPDATA`-muuttujaa ei ole asetettu, käynnistin käyttää sen sijaan polkua `%USERPROFILE%\AppData\Local\Archon\...`. |
| Käsin pystytetty isäntäkone ([Pystytä palvelin]({{ host_page.url | relative_url }})) | Omistajan oma kansio. Peliohjelma ja pelipalvelimet pyörivät samana käyttäjänä ja lukevat samoja tiedostoja. |
| Paketilla asennettu palvelin | Paikallisen tilin `dauntless` kansio. Tämä tili ajaa koko palvelinta: `<dauntless-tilin profiili>\AppData\Local\Archon\Saved\Config\WindowsClient\`. Asennusohjelma luo profiilin, jos sitä ei ole. |
| Paketin `-Sandbox`-asennus | `<InstallRoot>\data\sandbox-profile\AppData\Local\Archon\Saved\Config\WindowsClient\`. Nykyisen käyttäjän omaan kansioon ei kosketa koskaan. |

Käyttäjän asetuskerroksesta, ja siitä, miksi avainten on mentävä niiden osiota vastaavaan tiedostoon,
kerrotaan lisää sivulla [Pelin sisältö ja asetukset]({{ assets_page.url | relative_url }}).

### Kuka kirjoittaa mitäkin {#writers}

| Kirjoittaja | Milloin | `Engine.ini` | `Game.ini` | `GameUserSettings.ini` |
|:------------|:--------|:-------------|:-----------|:-----------------------|
| Käynnistin (`UndauntedLauncher/`) | Jokaisella PELAA-painalluksella ennen kuin peli käynnistyy | Korvaa osiot `[SystemSettings]` ja `[OnlineSubsystemMcp.XMPP]` | Ei koskaan | `sg.<ryhmä>Quality`-rivit, kun taso on valittu ja tiedosto on olemassa |
| Kaveripaketti, `friend-kit/play.ps1` | Jokaisella käynnistyksellä, myös valinnalla `-DryRun` | Samat rivit kuin käynnistin, paitsi käynnistimen valinnainen [automaattisen valotuksen](#auto-exposure) rivi | Ei koskaan | Kuten käynnistin |
| Isännän `C:\dr\tools\play.ps1` (ei repositoriossa; kokonaisuudessaan sivun [Pystytä palvelin vaiheessa 13]({{ host_page.url | relative_url }}#launch-the-client)) | Jokaisella käynnistyksellä | Samat rivit | Ei koskaan | Sama, ja lisäksi `sg.ResolutionQuality=100.000000` |
| Isännän `make-gameini.ps1` (skripti, jonka tallennat sivun [Pystytä palvelin vaiheesta 8]({{ host_page.url | relative_url }}#game-ini); ei repositoriossa) | Kun ajat sen | Ei kosketa | Korvaa koko tiedoston | Ei kosketa |
| Windows-palvelinpaketti, `Install-DauntlessServer.ps1` | Jokaisella asennusohjelman ajokerralla. `Update-DauntlessServer.ps1` **ei** kirjoita näitä tiedostoja uudelleen. | Vain muistirivit ja chatin uudelleenohjaus: ei grafiikkarivejä | Korvaa koko tiedoston | Ei kosketa |
| Peli itse | Käynnissä ollessaan | Kirjoittaa tiedoston uudelleen ja säilyttää osiomme | Kirjoittaa tiedoston uudelleen; lainausmerkeissä olevat arvot säilyvät | Asetusvalikostaan |

Kun tiedostoa ei vielä ole, käynnistin kirjoittaa täsmälleen samat tavut kuin kaveripaketin
`play.ps1`, kunhan automaattinen valotus on asetuksella ”Pelin oletus” (oletus). Käynnistimen testi
tarkistaa tämän tavu tavulta.

### Näin `Engine.ini`-tiedoston uudelleenkirjoitus toimii {#engine-ini-rewrite}

Kaikki neljä kirjoittajaa noudattavat samaa sääntöä:

1. Poista jokainen `[SystemSettings]`- ja `[OnlineSubsystemMcp.XMPP]`-osio otsikkoriviltä seuraavaan
   `[`-merkillä alkavaan riviin asti. Otsikko tunnistetaan vain aivan rivin alusta, isoista ja
   pienistä kirjaimista välittämättä.
2. Kirjoita tiedoston alkuun uusi `[SystemSettings]`-osio, tyhjä rivi, uusi
   `[OnlineSubsystemMcp.XMPP]`-osio ja toinen tyhjä rivi.
3. Säilytä kaikki muut rivit muuttamattomina niiden alapuolella.

Käytännössä tämä tarkoittaa:

- **Rivit, jotka lisäät itse näihin kahteen osioon, katoavat seuraavalla käynnistyksellä.** Tee omat
  säätösi asetusvalikosta tai jossakin toisessa osiossa.
- Kaikki muu `Engine.ini`-tiedostossa säilyy, myös pelin itse kirjoittamat osiot, kuten
  `[Core.System]`.
- Tiedosto luodaan, jos sitä ei ole. Käynnistin, kaveripaketti ja palvelinpaketti luovat myös
  kansion; isännän skripti olettaa, että kansio on jo olemassa (peli luo sen ensimmäisellä
  käynnistyksellään).

Merkistökoodaus:

- Käynnistin kirjoittaa ASCII-tekstiä CRLF-rivinvaihdoin. Jos jollakin säilytetyllä rivillä on muu
  kuin ASCII-merkki, se kirjoittaa sen sijaan UTF-16 LE -muotoa tavujärjestysmerkin (BOM) kanssa, ja
  Unreal lukee sen oikein. Käynnistin lukee sekä tiedostot, joissa on UTF-8- tai UTF-16 LE
  -tavujärjestysmerkki, että tiedostot ilman sitä. Se kirjoittaa ensin tiedostoon `Engine.ini.dr-tmp`
  ja nimeää sen sitten uudelleen, joten kaatuminen ei koskaan jätä jälkeensä puolikasta tiedostoa.
- PowerShell-kirjoittajat (kaveripaketti, isännän skripti ja palvelinpaketti) kirjoittavat aina
  ASCII-tekstiä. Säilytetyn rivin muu kuin ASCII-merkki muuttuu merkiksi `?`.

Käynnistin hylkää chat-palvelimen osoitteen, joka ei ole kelvollinen IPv4-osoite tai DNS-nimi, joten
tiedostoon ei voi päätyä mitään muuta. Kaveripaketti kirjoittaa `-Server`-arvonsa isäntäosan
tarkistamatta sitä.

---

## `Engine.ini`: `[SystemSettings]` {#systemsettings}

Käyttäjän `Engine.ini`-tiedoston `[SystemSettings]` ohittaa pelin asetusvalikon. Siksi pakotettu
grafiikkataso on täällä. Sarake ”Arvo” kertoo, mitä kirjoittajamme laittavat tiedostoon; ilman riviä
pätee pelin valmis oletusarvo.

| Nimi | Arvo | Arvot | Mitä se tekee | Kuka asettaa |
|:-----|:-----|:------|:--------------|:-------------|
| `r.Streaming.PoolSize` | `3000` | Mt | Tekstuurien suoratoistopooli. Rajaa suurinta muistin kuluttajaa heikentämättä laatua. | Kaikki neljä kirjoittajaa, aina |
| `r.Streaming.LimitPoolSizeToVRAM` | `1` | `0` tai `1` | Ei koskaan anna poolin kasvaa näytönohjaimen muistia suuremmaksi. | Kaikki neljä kirjoittajaa, aina |
| `gc.TimeBetweenPurgingPendingKillObjects` | `10` | sekuntia | Siivoaa roskat (vapauttaa käyttämätöntä muistia) useammin. Vaikuttaa muistiin, ei kuvanlaatuun. | Kaikki neljä kirjoittajaa, aina |
| `s.ForceGCAfterLevelStreamedOut` | `1` | `0` tai `1` | Siivoaa roskat aina, kun jokin kentän osa poistuu muistista. Vaikuttaa vain muistiin. | Kaikki neljä kirjoittajaa, aina |
| `sg.ViewDistanceQuality`, `sg.AntiAliasingQuality`, `sg.ShadowQuality`, `sg.PostProcessQuality`, `sg.TextureQuality`, `sg.EffectsQuality`, `sg.FoliageQuality`, `sg.ShadingQuality` | valittu taso | `0`–`4` | Pakottaa saman skaalautuvuustason (laatutason) kaikkiin kahdeksaan ryhmään. Katso [Grafiikkatasot](#graphics-levels). | Peliohjelman kirjoittajat, vain kun valittu taso on 0 tai suurempi |
| `sg.ResolutionQuality` | `100` | prosenttia | Täysi resoluutioskaala. | Peliohjelman kirjoittajat, kun taso on pakotettu |
| `r.ScreenPercentage` | `100` | prosenttia | Piirtää täydellä natiiviresoluutiolla. | Peliohjelman kirjoittajat, kun taso on pakotettu |
| `r.MipMapLODBias` | `0` | kokonaisluku | Täyden resoluution tekstuuritasot (mipit). | Peliohjelman kirjoittajat, kun taso on pakotettu |
| `r.MaxAnisotropy` | `16` | kokonaisluku | 16x anisotrooppinen suodatus: tekstuurit pysyvät terävinä myös vinossa katselukulmassa. | Peliohjelman kirjoittajat, kun taso on pakotettu |
| `r.Tonemapper.Sharpen` | `0.6` | liukuluku | Kevyt terävöinti UE4:n ajallisen reunanpehmennyksen (temporal anti-aliasing) pehmeyttä vastaan. | Peliohjelman kirjoittajat, kun taso on pakotettu |
| `r.EyeAdaptation.MethodOverride` | `2` | `-2` omat asetukset (testaukseen), `-1` ei ohitusta, `1` automaattinen, histogrammiin perustuva, `2` automaattinen, perus, `3` käsin (1.4.4:n ohjelmatiedoston oma ohjeteksti) | Vaihtaa automaattisen valotuksen histogrammista UE4:n perusmittaukseen; valotus pysyy automaattisena. Kokeilu [pimeää ilmalaivaa]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out) vastaan, jota ei ole vielä verrattu pelissä. Aina osion viimeinen rivi. | Vain käynnistin, ja vain kun Asetukset > Grafiikka > Automaattinen valotus on ”Mukautuva perusvalotus (kokeellinen)”. Katso [Automaattinen valotus](#auto-exposure). |

Muistirivit ovat peräisin 2.1.1-työstämme, jossa rajoittamaton peliohjelma nousi 9 gigatavuun.
1.4.4:ssä ne ovat varotoimi; emme ole mitanneet 1.4.4:ää ilman niitä. Aiemmin käyttämämme matalat
rajat aiheuttivat [sumean grafiikan]({{ trouble_page.url | relative_url }}#blurry-graphics).

**Mikään kirjoittaja ei laita automaattista valotusta pois.** Käynnistimen versio 0.1.0 sekä saman
ajan kaveripaketti ja isännän skripti kirjoittivat myös rivin `r.EyeAdaptationQuality=0`. Se korjasi
pimeän ilmalaivan ennen metsästystä, mutta teki Ramsgatesta ja yökohtauksista aivan liian pimeitä.
Siksi käynnistimen versiosta 0.1.1 alkaen mikään kirjoittaja ei aseta sitä, ja seuraavan
käynnistyksen uudelleenkirjoitus poistaa vanhan rivin. Ainoa valotusrivi, jonka mikään kirjoittaja
nyt laittaa tiedostoon, on yllä oleva käynnistimen valinnainen `r.EyeAdaptation.MethodOverride=2`,
joka pitää automaattisen valotuksen päällä. Katso
[Ilmalaiva on tosi pimeä ja ikkunat palavat puhki valkoisiksi]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out).

Käynnistimen oletustasolla (4) käynnistetty peliohjelma saa tämän osion:

```ini
[SystemSettings]
r.Streaming.PoolSize=3000
r.Streaming.LimitPoolSizeToVRAM=1
gc.TimeBetweenPurgingPendingKillObjects=10
s.ForceGCAfterLevelStreamedOut=1
sg.ViewDistanceQuality=4
sg.AntiAliasingQuality=4
sg.ShadowQuality=4
sg.PostProcessQuality=4
sg.TextureQuality=4
sg.EffectsQuality=4
sg.FoliageQuality=4
sg.ShadingQuality=4
sg.ResolutionQuality=100
r.ScreenPercentage=100
r.MipMapLODBias=0
r.MaxAnisotropy=16
r.Tonemapper.Sharpen=0.6
```

Tasolla `-1` osio päättyy riviin `s.ForceGCAfterLevelStreamedOut=1`: siinä on vain neljä
muistiriviä, samat, jotka palvelinpaketti kirjoittaa. Kun automaattinen valotus on asetuksella
”Mukautuva perusvalotus (kokeellinen)”, `r.EyeAdaptation.MethodOverride=2` tulee viimeiseksi riviksi
jokaisella tasolla.

### Grafiikkatasot {#graphics-levels}

Käynnistimen valikkonimet ovat alla suomeksi, ja suluissa on englanninkielisen käyttöliittymän nimi.

| Taso | Nimi | Käynnistin: Asetukset > Grafiikka > Laatu | `play.ps1 -Graphics` |
|:-----|:-----|:------------------------------------------|:---------------------|
| `-1` | Ei pakoteta mitään: asetusvalikko päättää | ”Pelin valikko” (”In-game menu”) | `-1` |
| `0` | Low | ”Matala” (”Low”) | `0` |
| `1` | Medium | ”Keskitaso” (”Medium”) | `1` |
| `2` | High | ”Korkea” (”High”) | `2` |
| `3` | Epic | ”Eeppinen” (”Epic”) | `3` |
| `4` | Cinematic, tämän UE4-version korkein taso | ”Elokuvamainen” (”Cinematic”) | `4` |

| Kirjoittaja | Oletus | Näin muutat sitä |
|:------------|:-------|:-----------------|
| Käynnistin | `4` (Cinematic) | Asetukset > Grafiikka > Laatu. Tallennetaan nimellä `graphics` käynnistimen `settings.json`-tiedostoon; mikä tahansa muu arvo kuin -1–4 palautuu arvoon 4. |
| Kaveripaketin `play.ps1` | `-1` (asetusvalikko päättää) | Lisää päätteessä komennon `Play Dauntless.cmd` perään `-Graphics <n>`. Arvo, joka on suurempi kuin 4, hylätään. |
| Isännän `play.ps1` | `4` | `-Graphics <n>`. Se ei tarkista arvon rajoja. |
| Palvelinpaketti | ei mitään | Ei koske: pelipalvelimet eivät piirrä mitään. |

Tasoilla 0–4 kirjoittaja asettaa myös valikon omat rivit
[`GameUserSettings.ini`-tiedostoon](#gameusersettings), jotta asetusnäyttö näyttää pakotetun tason.
Niin kauan kuin taso on pakotettu, se voittaa sen, mitä asetusvalikossa lukee, ja seuraava käynnistys
kirjoittaa sen taas.

### Automaattinen valotus {#auto-exposure}

Valinnainen kokeilu pimeää ilmalaivaa vastaan ennen metsästystä (tiekartan kohta 4.17). Sen lisäsi
Vvoidddd ([#7](https://github.com/mixutin/dauntless-revived/pull/7)). Se on oletuksena pois päältä.

| Kirjoittaja | Oletus | Näin muutat sitä |
|:------------|:-------|:-----------------|
| Käynnistin | `game` (”Pelin oletus”): ei valotusriviä | Asetukset > Grafiikka > Automaattinen valotus: ”Pelin oletus” tai ”Mukautuva perusvalotus (kokeellinen)”, joka kirjoittaa rivin `r.EyeAdaptation.MethodOverride=2`. Tallennetaan nimellä `exposure` käynnistimen `settings.json`-tiedostoon (`game` tai `basic`); mikä tahansa muu arvo palautuu arvoon `game`. Tulee voimaan seuraavalla PELAA-painalluksella. |
| Kaveripaketin `play.ps1`, isännän `play.ps1` | ei mitään | Ei tarjolla. Kun ne kirjoittavat `[SystemSettings]`-osion uudelleen, käynnistimen kirjoittama rivi poistuu. |
| Palvelinpaketti | ei mitään | Ei koske: pelipalvelimet eivät piirrä mitään. |

Kun valitset taas ”Pelin oletus”, rivi poistuu seuraavalla PELAA-painalluksella, koska käynnistin
kirjoittaa koko osion uudelleen. Siihen asti (esimerkiksi jos poistat käynnistimen) rivi jää
`Engine.ini`-tiedostoon. Siitä ei ole haittaa, koska valotus pysyy automaattisena.

---

## `Engine.ini`: `[OnlineSubsystemMcp.XMPP]` (chat) {#xmpp}

Sellaisenaan 1.4.4:n chat- ja paikallaoloyhteys (XMPP WebSocketin yli) menee Epicin yhä toiminnassa
olevalle palvelimelle `wss://xmpp-service-prod.ol.epicgames.com:443` ja yrittää jatkuvasti muodostaa
yhteyden uudelleen, samalla kun se lähettää tilin tunnisteen (account id) ja kirjautumistunnisteen.
Jokainen kirjoittaja ohjaa sen muualle. Palvelin-DLL:n asetuskoukku ei kata näitä avaimia:
`Mcp`-osioissa se kirjoittaa uudelleen vain avaimet, joiden nimessä on `Protocol`, `Domain` tai
`RedirectUrl`. Ini-ohitus on ainoa asia, joka ohjaa chatin muualle.

| Nimi | Oletus (pelin mukana) | Arvot | Mitä se tekee | Kuka asettaa |
|:-----|:----------------------|:------|:--------------|:-------------|
| `ServerAddr` | Epicin toiminnassa oleva palvelin | `"ws://<osoite>"`, lainausmerkeissä | Chatin WebSocket-palvelimen osoite. Lainausmerkit ovat käyttäjän ini-tiedostossa pakolliset (katso [lainausmerkit](#game-ini-quoting)). | Kaikki neljä kirjoittajaa |
| `ServerPort` | Epicin portti | 1–65535 | Chatin WebSocket-yhteyden portti. | Kaikki neljä kirjoittajaa |
| `bUseSSL` | Epicin asetus | `false` | Salaamaton `ws://`. Julkisessa tilassa käynnistimen välitin lisää TLS-salauksen. | Kaikki neljä kirjoittajaa |

Mitä kukin kirjoittaja laittaa siihen:

| Kirjoittaja ja tila | `ServerAddr` | `ServerPort` |
|:--------------------|:-------------|:-------------|
| Käynnistin, yksityinen tila (Tailscale-kutsu) | `"ws://<kutsun osoite>"` | `61099` |
| Käynnistin, julkinen tila | `"ws://127.0.0.1"` (käynnistimen paikallinen välitin) | Välittimen portti: `61000`, ellei `DAUNTLESS_REVIVED_RELAY_PORT` siirrä sitä |
| Kaveripaketin `play.ps1` | `"ws://<-Server-arvon osoiteosa>"` | `61099` |
| Isännän `play.ps1` | `"ws://127.0.0.1"` | `61099` |
| Palvelinpaketti palvelutilille (myös `-Sandbox`-asennuksessa) | `"ws://127.0.0.1"` | `61099` |

Minne yhteys päätyy:

- **Metagamen chat kuuntelee porttia 61099, kun `CHAT=1`**, palvelimen (tai isäntäkoneen)
  osoitteessa `127.0.0.1`. Toistaiseksi se on oletuksena pois päältä; kun mikään ei kuuntele, yhteys
  epäonnistuu samalla tavalla kuin se jo epäonnistuu Epicin palvelinta vastaan, ja peli jatkaa
  normaalisti. Yksityisessä tilassa chattia ei vielä ole. Katso
  [Tekstichat]({{ '/fi/findings/chat.html' | relative_url }}).
- Julkisessa tilassa käynnistimen välitin välittää WebSocket-yhteyden avauspyynnön (upgrade)
  kiinnitetyn TLS-yhteytensä yli palvelimen yhdyskäytävälle, joka välittää sen edelleen osoitteeseen
  `GATEWAY_WS_URL` (oletus `http://127.0.0.1:61099`; `-Sandbox`-asennus käyttää osoitetta
  `http://127.0.0.1:62099`). Katso [asetusten viitesivu]({{ config_page.url | relative_url }}).
- Varmistettu 21.9.2026: ensimmäisten 90 sekunnin aikana käynnistyksestä peliohjelma ei ottanut
  yhtään yhteyttä koneen ulkopuolelle. Se yritti sen sijaan saman koneen porttia 61099.
- Emme tiedä, avaako valitsimella `-nullrhi` käynnistetty pelipalvelin chat-yhteyttä lainkaan.
  Palvelinpaketti kirjoittaa ohituksen silti. `-Sandbox`-asennuksessa se osoittaa edelleen porttiin
  61099; siitä ei ole haittaa, koska hiekkalaatikkoasennus ei koskaan käynnistä pelipalvelimia.

---

## `Game.ini`: osoiteohitukset pelipalvelimille {#game-ini}

**Miksi pelipalvelimet tarvitsevat sitä.** Client-tilassa palvelin-DLL vastaa taustapalvelun
osoiteavaimiin suoraan muistissa. Palvelintilassa se ei koske asetuksiin lainkaan. Siksi pelipalvelin
lukee taustapalvelun osoitteensa ensin pelin mukana tulleesta (cooked) `DefaultGame.ini`-tiedostosta,
joka osoittaa Phoenixin `*.steelyard.ca`-palvelimiin (poissa 30.5.2025 alkaen), ja sitten
Windows-tilinsä käyttäjän `Game.ini`-tiedostosta. Ilman ohituksia pelipalvelin ei voi ladata eikä
tallentaa kenenkään hahmoa.

Peliohjelma ei välitä näistä avaimista, koska sen DLL-koukku vastaa niihin ensin. Pelaajat eivät
tarvitse `Game.ini`-tiedostoa.

**Muoto.**

```ini
[OnlineSubsystemPhoenix]
AuthEndpoint="http://127.0.0.1:61000/game/login"
AuthAvailableEndpoint="http://127.0.0.1:61000/checkavailable"
AuthTagsEndpoint="http://127.0.0.1:61000/tags"
...
MatchmakingEndpoint="http://127.0.0.1:61000"
TrackingEndpoint="http://127.0.0.1:61000"
...
```

- 167 riviä, yksi kutakin DLL:n osoitetaulukon merkintää kohden tiedostossa
  `UndauntedInternalServer/dllmain.cpp`. Molemmat tiedoston luovat skriptit (paketin asennusohjelma
  ja isännän `make-gameini.ps1`) lukevat tuon tiedoston samalla säännöllisellä lausekkeella ja
  kirjoittavat rivit muodossa `<avain>="http://<metagamen osoite><polku>"`.
- `MatchmakingEndpoint` ja `TrackingEndpoint` ovat pelkkä osoite ilman polkua.
- Molemmat skriptit korvaavat koko tiedoston ja kirjoittavat sen ASCII-muodossa.

{: #game-ini-quoting}
**Laita jokainen arvo lainausmerkkeihin.** Lainausmerkittömässä arvossa pelimoottorin ini-jäsennin
tulkitsee `//`-merkit kommentin aluksi ja katkaisee arvon siihen, ja peli kirjoittaa sen jälkeen
vahingoittuneen tiedoston takaisin levylle. Katso
[Osoitearvot katkenneet muotoon ”https:”]({{ trouble_page.url | relative_url }}#ini-truncation).

**Mihin se osoittaa.** Osoitteen täytyy olla sellainen, jossa metagame kuuntelee (sen `BIND_HOST` ja
`PORT`, katso [asetusten viitesivu]({{ config_page.url | relative_url }})).

| Kokoonpano | Kuka kirjoittaa | Metagamen osoite `Game.ini`-tiedostossa |
|:-----------|:----------------|:----------------------------------------|
| Isäntäkone, vain loopback | `make-gameini.ps1` (oletus `-Metagame 127.0.0.1:61000`) | `127.0.0.1:61000` |
| Isäntäkone yksityisessä tilassa | Kirjoitetaan uudelleen käsin, kuten sivulla [Palvelin ryhmälle]({{ admin_page.url | relative_url }}) neuvotaan | `<isännän Tailscale-osoite>:61000` |
| Paketti, julkinen tila | Asennusohjelma | `127.0.0.1:<metagamen portti>`; portti on 61000, ellei `-MetagamePort` tai aiempi asennus ole asettanut toista |
| Paketti, yksityinen tila | Asennusohjelma | `<palvelimen Tailscale-IPv4-osoite>:<metagamen portti>` |
| Paketti, `-Sandbox` | Asennusohjelma | `127.0.0.1:62000` |

**Milloin se pitää luoda uudelleen.** Aina kun metagamen portti tai kuunteluosoite muuttuu, kun
yksityisen tilan palvelimen Tailscale-osoite muuttuu, ja kun uusi koodiversio muuttaa
`dllmain.cpp`:n osoitetaulukkoa.

- Paketilla asennetulla palvelimella aja `Install-DauntlessServer.ps1` uudelleen (sen voi toistaa
  turvallisesti). `Update-DauntlessServer.ps1` ei kirjoita `Game.ini`- eikä `Engine.ini`-tiedostoa
  uudelleen. Asennusohjelma lukee `dllmain.cpp`:n käännetystä koodista kansiosta
  `<InstallRoot>\app\UndauntedInternalServer\` ja varoittaa, jos merkintöjä on jokin muu määrä kuin
  167.
- Käsin pystytetyllä isäntäkoneella aja `make-gameini.ps1` uudelleen uudella `-Metagame`-arvolla.
  Älä etsi ja korvaa tekstiä: merkkijonon `:61000/` korvaaminen ohittaa ne kaksi avainta, joiden arvo
  on pelkkä osoite.

{: #game-ini-private}
**`Game.ini` on yksityinen: älä koskaan jaa sitä äläkä tallenna sitä versionhallintaan.** DLL:n
taulukko säilyttää Phoenixin vanhan `PhoenixEventsMessageEndpoint`-osoitteen polun. Osoite oli
Slack-webhook, ja sen polussa on webhookin salainen osa. Jokainen luotu `Game.ini` sisältää sen.
Osoite osoittaa omaan metagameesi, joten Slackiin ei lähetetä mitään, mutta älä liitä tiedostoa
issueihin, keskusteluihin tai kuvakaappauksiin.

---

## `GameUserSettings.ini` {#gameusersettings}

Peli kirjoittaa tämän tiedoston itse asetusvalikostaan. Kun grafiikkataso 0–4 pakotetaan, peliohjelman
kirjoittajat asettavat myös valikon omat rivit, jotta asetusnäyttö näyttää pakotetun tason:

- Kahdeksan ryhmän (ViewDistance, AntiAliasing, Shadow, PostProcess, Texture, Effects, Foliage,
  Shading) jokainen olemassa oleva `sg.<ryhmä>Quality=`-rivi korvataan valitulla tasolla.
  Kirjainkoolla ei ole väliä.
- Rivejä ei lisätä, eikä tiedostoa luoda, jos sitä ei vielä ole. Peli luo sen ensimmäisellä
  käynnistyksellään.
- Tasolla `-1` ja pelipalvelimilla tiedostoon ei kosketa.
- Isännän `play.ps1` asettaa lisäksi rivin `sg.ResolutionQuality=100.000000`. Käynnistin ja
  kaveripaketti jättävät sen rivin rauhaan.

Käynnistin kirjoittaa tämän tiedoston samalla merkistösäännöllä ja samalla väliaikaistiedoston
uudelleennimeämisellä kuin `Engine.ini`-tiedoston.

---

## Peliohjelman komentorivi {#client-command-line}

Kaikki kolme peliohjelman käynnistäjää (käynnistin, kaveripaketti ja isännän skripti) käynnistävät
exe-tiedoston suoraan, työhakemistonaan `Archon\Binaries\Win64`. Mikään niistä ei käynnistä
`Dauntless.exe`-tiedostoa eikä EasyAntiCheatin käynnistysohjelmaa, joten EasyAntiCheat ei koskaan
käynnisty.

```text
Dauntless-Win64-Shipping.exe <host>:<port> -AUTH_PASSWORD=<tiliavain> -AUTH_LOGIN=unused
  -AUTH_TYPE=exchangecode -epicapp=appidlol -epicenv=Prod -EpicPortal -epicusername=usernamelol
  -epicuserid=useridlol -epiclocale=en-US -epicsandboxid=sandboxidlol
  -epicdeploymentid=deploymentidlol [-windowed -ResX=1280 -ResY=720]
```

Järjestys ja arvot ovat samat kaikissa kolmessa. Käynnistimen testi kiinnittää tarkan listan.

| Nimi | Oletus | Arvot | Mitä se tekee | Kuka asettaa |
|:-----|:-------|:------|:--------------|:-------------|
| Ensimmäinen parametri, `<host>:<port>` | ei mitään | `host:port`, ilman protokollaa | Metagamen osoite. Palvelin-DLL lukee sen client-tilassa ja muodostaa jokaisen taustapalvelun osoitteen muodossa `http://<host>:<port>/...`. | Katso seuraava taulukko |
| `-AUTH_PASSWORD=` | ei mitään (pakollinen) | Tiliavain. Palvelimen luomat avaimet ovat `UUK_` ja 48 heksamerkkiä; käynnistin hyväksyy 8–128 merkkiä joukosta `A-Z a-z 0-9 _ -`. | Peli lähettää sen ”vaihtokoodina” (exchange code) osoitteeseen `POST /account/api/oauth/token`. Asetuksella `AUTH_MODE=APIKEY` metagame etsii tilin ja palauttaa 24 tuntia voimassa olevan tunnisteen. **Salainen: se on tilin salasana. Älä koskaan jaa sitä äläkä tallenna sitä versionhallintaan.** | Käynnistin: sen salattu avainvarasto. Kaveripaketti: `%APPDATA%\DauntlessRevived\account.key`. Isännän skripti: `-KeyFile`, oletus `C:\dr\data\owner.key`. |
| `-AUTH_TYPE=exchangecode` | aina | kiinteä | Valitsee vaihtokoodikirjautumisen. 1.4.4 tuntee myös tavat `password` ja `developer`; käytämme vain tätä. | Kaikki kolme käynnistäjää |
| `-AUTH_LOGIN=unused` | aina | kiinteä | Paikanpitäjä, joka ei saa olla tyhjä. | Kaikki kolme käynnistäjää |
| `-EpicPortal` | aina | kiinteä | Annetaan samoin kuin alkuperäisen Undauntedin käynnistin sen antaa. 2.1.1 sulkeutuu ilman sitä; 1.4.4:ää ei ole testattu ilman sitä. | Kaikki kolme käynnistäjää |
| `-epicapp=appidlol`, `-epicenv=Prod`, `-epicusername=usernamelol`, `-epicuserid=useridlol`, `-epicsandboxid=sandboxidlol`, `-epicdeploymentid=deploymentidlol` | aina | kiinteät paikanpitäjät | Kopioitu alkuperäisen Undauntedin käynnistimestä. Epic-tiliä ei tarvita, koska 1.4.4 on Epic Online Servicesiä vanhempi. Kukaan ei ole testannut, mitä niistä 1.4.4 oikeasti tarvitsee. | Kaikki kolme käynnistäjää |
| `-epiclocale=en-US` | `en-US` | `en-US`, `de-DE`, `es-ES`, `fr-FR`, `it-IT`, `ja-JP`, `pt-BR`, `ru-RU` | Pelin tekstien kieli. 1.4.4:ssä on tekstit juuri näille kielille (`Archon/Content/Localization/Game/<kieli>`); `es-ES` on varmistettu pelissä. | Käynnistin: Asetukset > Käynnistin > Kieli > Pelin kieli. Oletus "Automaattinen (Windowsin kieli)" käyttää Windowsin kieltä, jos pelissä on sille tekstit (`es-419` antaa `es-ES`, `pt-PT` antaa `pt-BR`), ja muuten `en-US`. Tallennetaan käynnistimen `settings.json`-tiedostoon kenttään `gameLanguage` (`auto` tai jokin kielistä); muu arvo palautuu arvoon `auto`. Tulee voimaan seuraavalla PELAA-painalluksella. Kaveripaketti ja palvelinkoneen skripti: aina `en-US`. |
| `-windowed -ResX=1280 -ResY=720` | pois | kaikki kolme yhdessä | 1280x720-kokoinen ikkuna tallennetun näyttötilan sijaan. | Käynnistin: Asetukset > ”Käynnistä ikkunassa (1280×720)” (`windowed` sen `settings.json`-tiedostossa). Kaveripaketti ja isännän skripti: `-Windowed`. |

Ensimmäinen parametri käynnistäjittäin:

| Käynnistäjä | Ensimmäinen parametri |
|:------------|:----------------------|
| Käynnistin, yksityinen tila | Kutsun `host:port`: yleensä palvelimen Tailscale-osoite ja 61000 |
| Käynnistin, julkinen tila | `127.0.0.1:61000`: käynnistimen paikallinen välitin, joka välittää kaiken kiinnitetyn TLS-yhteyden yli palvelimen yhdyskäytävälle. `DAUNTLESS_REVIVED_RELAY_PORT` siirtää välittimen testejä ja harjoituksia varten; katso [asetusten viitesivu]({{ config_page.url | relative_url }}). |
| Kaveripaketin `play.ps1` | `-Server` tai `Server` tiedostosta `%APPDATA%\DauntlessRevived\settings.json`. Jos porttia ei anneta, perään lisätään `:61000`. |
| Isännän `play.ps1` | `-Backend`, oletus `127.0.0.1:61000` |

**Tiliavain komentorivillä.**

- Muut samana Windows-käyttäjänä ajettavat ohjelmat ja järjestelmänvalvojat voivat lukea prosessin
  komentorivin, joten ne voivat lukea myös avaimen. Alkuperäisen projektin käynnistin toimii samoin.
- Käynnistin kirjoittaa lokiinsa `-AUTH_PASSWORD=<hidden>` eikä koskaan lue muiden prosessien
  komentorivejä itselleen. `play.ps1 -DryRun` tulostaa käynnistysrivin niin, että avain on korvattu.
- Älä koskaan julkaise kuvakaappausta tai prosessilistausta, jossa pelin komentorivi näkyy.

**Muut käynnistyssäännöt.**

- Käynnistin ei suostu PELAA-toimintoon, jos koneella on jo käynnissä toinen Dauntless-peliohjelma.
  Se laskee jokaisen `Dauntless-Win64-Shipping.exe`-prosessin, jonka komentorivillä ei ole erillistä
  `-server`-valitsinta, joten isännän omalla koneella pyörivät pelipalvelimet eivät ole mukana
  laskussa. Kaveripaketti ei tarkista tätä.
- Ennen jokaista käynnistystä käynnistin ja kaveripaketti tarkistavat exe-tiedoston ja molemmat
  DLL-tiedostot kiinnityksiä vasten, ja käynnistin korjaa DLL-tiedostot tarvittaessa. Katso
  [kuka tarkistaa kiinnitykset](#pin-checks).
- Palvelin-DLL avaa konsoli-ikkunan pelin viereen. **Jätä se auki**: sen sulkeminen lopettaa pelin.
  F2 avaa Unrealin konsolin.
- Exe-tiedostossa on Unrealin komentorivivalitsimien sallittujen lista. Sitä, soveltaako 1.4.4 listaa
  ajon aikana, ei ole varmistettu; yllä olevat valitsimet toimivat, myös ikkunatilan valitsimet. Katso
  [Asiakasohjelman sisäosat]({{ ci_page.url | relative_url }}).

---

## Pelipalvelimen komentorivi {#game-server-command-line}

Deploy-palvelin käynnistää jokaisen pelipalvelimen:

```text
Dauntless-Win64-Shipping.exe <pelipalvelimen avain> <UDP-portti> <kenttä> <behemoth tai NO_BEHEMOTH>
  <matchmakerin metsästystunniste tai NO_MM_HUNTID> <uid:huntid,uid:huntid,... tai NO_EXPECTED_PLAYERS>
  <MY_IP>:<UDP-portti> -EpicPortal -server -nullrhi
```

| # | Parametri | Arvot | Mitä se tekee | Kuka asettaa |
|:--|:----------|:------|:--------------|:-------------|
| 1 | Pelipalvelimen avain | Avain; paketti luo 48 heksamerkkiä | Lähetetään `x-undaunted-gameserver-apikey`-otsakkeena jokaisessa palvelimen tekemässä HTTP-pyynnössä. Metagame tallentaa siitä vain SHA-256-tiivisteen ja hyväksyy avaimen vain omalta koneeltaan (tai `GAMESERVER_ALLOW_FROM`-listan osoitteesta), ei koskaan yhdyskäytävän tai muun välityspalvelimen kautta. **Salainen: älä koskaan jaa sitä, älä tallenna sitä versionhallintaan äläkä tulosta `-server`-komentoriviä.** | `METAGAME_API_KEY` deploy-palvelimen asetuksissa |
| 2 | UDP-portti | Kokonaisluku | Portti, jossa palvelin kuuntelee. Portit 8776 ja siitä ylöspäin poistavat lisäksi tyhjäkäyntisulkeutumisen käytöstä (alla). | Ramsgate: `PORT_RANGE_END` (8777). Dojo: `PORT_RANGE_END` miinus 1 (8776). Metsästykset: vapaa portti väliltä `PORT_RANGE_BEGIN` – `PORT_RANGE_END` miinus 2 (8770–8775). |
| 3 | Kenttä | `/Game/...`-kenttäpolku, jonka perässä voi olla `?game=<pelitilan luokka>` | Aloituskenttä. | Ramsgate: `/Game/Maps/ramsgate/ramsgate_01_persistent`. Dojo: `/Game/Maps/islands/dojo/training_dojo_persistent`. Trials: `/Game/Maps/islands/arenas/arena_ramsgate_00`. Metsästys: satunnainen kenttä metsästyksen kenttälistasta, ja lisäksi `?game=`, jos metsästys vaihtaa pelitilan. Opetussaari: kenttä peliohjelman omasta pyynnöstä. |
| 4 | Behemoth | `_C`-päätteinen asset-polku tai `NO_BEHEMOTH` | Lisätään kentän URL-osoitteeseen muodossa `?MonsterClass=`. | Metsästystaulukot, tai opetussaarella peliohjelman pyyntö. Ramsgate ja Dojo antavat arvon `NO_BEHEMOTH`. |
| 5 | Matchmakerin metsästystunniste | Rivin nimi deploy-palvelimen omista metsästystaulukoista (esimerkiksi `CR19_MatchmakerHunt_...`) tai `NO_MM_HUNTID` | Lisätään muodossa `?HuntId=`. | Satunnainen matchmaker-rivi pelaajan metsästykselle. Trials: `Arena_MatchmakerHunt_Hard_NNN` tai `Arena_MatchmakerHunt_Elite_NNN`, jossa NNN on 001–088. Ramsgate, Dojo ja opetussaari antavat arvon `NO_MM_HUNTID`. |
| 6 | Odotetut pelaajat | `uid:huntid,uid:huntid,...` tai `NO_EXPECTED_PLAYERS`. Enintään 16 pelaajaa; kukin uid on enintään 64 merkkiä (kirjaimia, numeroita, `_` ja `-`), metsästystunniste enintään 128 merkkiä (kirjaimia, numeroita, `_` ja `+`). | Lisätään muodossa `?PlayerHuntIds=`: ketkä saavat liittyä ja millä pelaajan metsästyksellä (player hunt). | Matchmaking-pyyntö: pelaajien tilitunnisteet ja metsästys, jota he pyysivät. Ramsgate, Dojo ja opetussaari antavat arvon `NO_EXPECTED_PLAYERS`. |
| 7 | Ilmoitettu osoite | `MY_IP:port` | DLL jäsentää sen mutta ei koskaan käytä sitä. Osoite, johon pelaajat siirtyvät, tulee deploy-palvelimen vastauksesta metagamelle. | `MY_IP` |
| | `-EpicPortal -server -nullrhi` | kiinteä | `-server` laittaa DLL:n palvelintilaan. `-nullrhi` tarkoittaa, ettei mitään piirretä eikä näytönohjainta käytetä. | Aina |

Parametrit asetetaan deploy-palvelimen muuttujilla `PORT_RANGE_BEGIN`, `PORT_RANGE_END`, `MY_IP` ja
`METAGAME_API_KEY`. `GAMESERVER_BINARY_PATH` kertoo, minkä exe-tiedoston deploy-palvelin käynnistää;
sillä ei ole oletusarvoa, ja paketti asettaa siihen oman pelikansionsa kiinnitetyn exe-tiedoston. Katso
[asetusten viitesivu]({{ config_page.url | relative_url }})
ja [porttien viitesivu]({{ ports_page.url | relative_url }}). Parametrit 3–6 tulevat osittain
peliohjelman omasta matchmaking-pyynnöstä. Sekä metagame että deploy-palvelin tarkistavat ne, ennen
kuin ne päätyvät komentoriville; katso [HTTP API]({{ api_page.url | relative_url }}).

**DLL:stä tulevat säännöt.**

- **Exe-tiedoston nimen jälkeen vähintään kahdeksan parametria.** Jos niitä on vähemmän, DLL näyttää
  viestiruudun, jossa lukee `INVALID GAMESERVER ARGS`, ja sulkeutuu.
- **Pelimoottori ei koskaan näe näitä parametreja.** Koukku antaa sille niiden sijaan kiinteän
  komentorivin:
  `Dauntless-Win64-Shipping.exe -server -unattended -nullrhi -nosound -EpicPortal -RepDriverDisable`.
  Pelimoottorin valitsimia ei voi lisätä deploy-palvelimen kautta.
- **Aloituskentän URL** muodostetaan parametreista 3–6, ja jokainen `NO_*`-osa jätetään pois:
  `<kenttä>?MonsterClass=<behemoth>?HuntId=<tunniste>?PlayerHuntIds=<lista>`.
- **Tyhjäkäyntisulkeutuminen.** Palvelin, jonka portti on pienempi kuin 8776, sulkeutuu, kun se on
  ollut ilman yhdistettyä pelaajaa yhteensä 50 sekuntia siitä hetkestä lähtien, kun se alkoi kuunnella.
  Laskuria ei koskaan nollata, eikä vielä liittymässä olevaa pelaajaa lasketa yhdistetyksi. Portit 8776
  ja siitä ylöspäin on vapautettu tästä: asetuksella `PORT_RANGE_END=8777` ne ovat Dojo ja Ramsgate.
  **Jos haluat sallia useamman metsästyksen, laske `PORT_RANGE_BEGIN`-arvoa. Pidä `PORT_RANGE_END`
  arvossa 8777.** Jos nostat sitä, metsästys voi osua vapautettuun porttiin eikä koskaan sulkeudu. Jos
  lasket sitä, Dojo (ja alle 8776:n myös Ramsgate) joutuu tyhjäkäyntisulkeutumisen piiriin.

**Prosessi.**

- Deploy-palvelin käyttää Noden oletusarvoista `spawn`-kutsua ilman omaa työhakemistoa, joten
  pelipalvelin perii deploy-palvelimen työhakemiston. Pelipalvelimet päättyvät yhdessä
  deploy-palvelimen kanssa; katso [Pystytä palvelin, vaihe 15]({{ host_page.url | relative_url }}#stopping).
- Ramsgate käynnistyy yhdessä deploy-palvelimen kanssa. Dojo käynnistyy, kun joku ohjataan sinne
  ensimmäisen kerran, ellei `ENABLE_DOJO=1` käynnistä sitä heti alussa (paketti kirjoittaa
  `ENABLE_DOJO=0`). Metsästyspalvelin käynnistyy jokaista matchmaking-pyyntöä varten.
- Käynnistykset jonotetaan niin, että niiden välissä on `SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP`
  sekuntia (paketti kirjoittaa arvon 10).
- DLL avaa konsoli-ikkunan jokaiselle palvelimelle. Ramsgate ja Dojo käynnistetään ikkuna näkyvissä
  (”Running as a server!”). Metsästyspalvelimet käynnistetään ikkuna piilotettuna, jotta jokaisesta
  metsästyksestä ei välähdä uutta ikkunaa. **Näkyvän konsoli-ikkunan sulkeminen lopettaa sen
  palvelimen** kaikilta, jotka ovat siinä. Deploy-palvelin käynnistää Ramsgaten ja Dojon uudelleen,
  kun pelaaja matkustaa sinne, tai sen vahtikoira (watchdog) tekee sen minuutin sisällä, kumpi ehtii
  ensin.
- Paketilla asennetulla palvelimella kokonaisuus pyörii `dauntless`-tilinä ilman työpöytää
  (Windowsin ”istunto 0”), ellei asennusohjelmaa ajettu valinnalla `-InteractiveSession`.
  Konsoli-ikkunoiden pitäisi toimia sielläkin, mutta sitä ei ole vielä testattu; katso
  [Windows-palvelin]({{ winserver_page.url | relative_url }}#session-0-and--interactivesession).
- Pelipalvelin lukee sen tilin käyttäjän asetuskansiota, joka ajaa deploy-palvelinta. Siksi paketti
  kirjoittaa `Game.ini`- ja `Engine.ini`-tiedostot `dauntless`-tilille.
- Skriptit erottavat pelipalvelimet peliohjelmista komentorivin erillisen `-server`-valitsimen
  perusteella. Älä tulosta näitä komentorivejä: ensimmäinen parametri on pelipalvelimen avain.

---

## Kaksi DLL-tiedostoa {#dlls}

| Tiedosto | Koko | SHA-256 | Mitä se tekee |
|:---------|-----:|:--------|:--------------|
| `dxgi.dll` | 11 264 tavua | `9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F` | Välittäjä (proxy). Windows lataa sen pelikansiosta järjestelmän oman kopion sijaan. Se lataa oikean `System32\dxgi.dll`-tiedoston, välittää eteenpäin funktiot `CreateDXGIFactory`, `CreateDXGIFactory1` ja `CreateDXGIFactory2` ja lataa `UndauntedInternalServer.dll`-tiedoston. Sen lähdekoodia ei ole julkaistu. |
| `UndauntedInternalServer.dll` | 123 392 tavua | `520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933` | Undauntedin palvelin-DLL, versio 0.0.3. Lähdekoodi on kansiossa `UndauntedInternalServer/`. Se kaappaa pelin toimintoja muistissa (hook) joko client-tilassa tai palvelintilassa (alla). Se tarvitsee Visual C++ 2015-2022 x64 -ajonaikaisen kirjaston (`MSVCP140.dll` ja `VCRUNTIME140_1.dll` kansiossa `System32`). |

Molemmat ovat alkuperäisen Undauntedin valmiiksi käännettyjä, allekirjoittamattomia tiedostoja, ja
ne ovat kansiossa `UndauntedLauncher/assets/`. Jokainen palvelin-DLL:n koukkuosoite on sidottu
kiinnitettyyn exe-tiedostoon, joten **älä koskaan kopioi niitä toiseen versioon**; 2.1.1:ssä ne
kaataisivat pelin. Virustorjunta voi merkitä välittäjä-DLL:n epäilyttäväksi; katso
[Windows Defender ja allekirjoittamattomat DLL-tiedostot]({{ trouble_page.url | relative_url }}#windows-defender-and-the-unsigned-dlls).

**Minne ne kuuluvat.** Exe-tiedoston viereen, kansioon `<pelikansio>\Archon\Binaries\Win64\`.
Pelikansio on se kansio, jossa `Archon\` on.

| Asentaja | Pelikansio (oletus) | Mistä kopioidaan | Tarkistukset |
|:---------|:--------------------|:-----------------|:-------------|
| Käynnistin | `%LOCALAPPDATA%\DauntlessRevived\Game`; kohdasta Asetukset > Peli > Pelitiedostot sen voi siirtää | Käynnistimen oma resurssikansio | Tarkistaa tiivisteen käynnistimen kopiosta, väliaikaisesta kopiosta (`<nimi>.new`) ja lopullisesta tiedostosta, ja poistaa ”ladattu internetistä” -merkinnän. Tarkistaa uudelleen ennen jokaista PELAA-painallusta ja korjaa ne tarvittaessa. |
| Kaveripaketti, `setup.ps1` | `-Game`, oletus `C:\D144\Dauntless` | Paketin `dll\`-kansio (repositorion kopiossa `UndauntedLauncher\assets\`) | Tiiviste ennen kopiointia, `Unblock-File` ja tiiviste uudelleen kopioinnin jälkeen. Jo oikeaan DLL-tiedostoon ei kosketa. `play.ps1` tarkistaa molemmat jokaisella käynnistyksellä. |
| Palvelinpaketti, `Install-DauntlessServer.ps1` | `<InstallRoot>\game\Dauntless` (oletus `C:\DauntlessRevived\game\Dauntless`) tai `-GameDir` | `<InstallRoot>\app\UndauntedLauncher\assets` | Tiiviste ennen kopiointia, `Unblock-File` ja tiiviste uudelleen kopioinnin jälkeen. Jo oikeaan DLL-tiedostoon ei kosketa. |
| Käsin | [Pystytä palvelin, vaihe 5]({{ host_page.url | relative_url }}#dlls); [Liity kaverina]({{ friends_page.url | relative_url }}), vaihe 3 | `UndauntedLauncher/assets/` | Kuten siellä kerrotaan |
| `tools/make-friend-kit.ps1` | Ei koske: se pakkaa ne paketin `dll\`-kansioon | `UndauntedLauncher/assets/` | Tiiviste ennen pakkaamista |

Poistaaksesi ne poista nämä kaksi tiedostoa. Mikään muu pelikansiossa ei muutu. Sisältöluettelo
(content manifest) ei listaa niitä, ja käynnistin hylkää luettelon, joka listaa ne.

### Näin palvelin-DLL valitsee tilansa {#dll-mode}

DLL päättää tilansa kerran, käynnistyksessä. Jos prosessin raaka komentorivi sisältää merkkijonon
`-server`, se toimii palvelintilassa, muuten client-tilassa. Testi on kirjainkoon huomioiva
osamerkkijonohaku koko komentoriviltä, ja siihen kuuluvat myös exe-tiedoston oma polku ja ensimmäinen
parametri.

**Pidä `-server` poissa peliohjelman asennuspoluista ja palvelinten isäntänimistä.** Tämä perustuu
koodin lukemiseen; emme ole testanneet sitä. Peliohjelma, jonka asennuskansio (esimerkiksi
`D:\my-server\Dauntless`) tai ensimmäinen parametri sisältää merkkijonon `-server`, käynnistyisi
palvelintilassa, yrittäisi lukea kirjautumisvalitsimiaan pelipalvelimen parametreina ja epäonnistuisi.
Yksi tapa, jolla näin voi käydä: yksityisen tilan kutsu, joka nimeää palvelimen sen MagicDNS-nimellä
(tehty valinnalla `-AdvertiseHost`), kun käytössä on asennusohjelman oletusarvoinen Tailscale-isäntänimi
`dauntless-server`. Tämä ei koske kutsuja, joissa on oletusarvoinen Tailscale-IP-osoite, eikä yhtään
julkisen tilan peliohjelmaa (niiden ensimmäinen parametri on `127.0.0.1:61000`). Käynnistin ja
kaveripaketti eivät tarkista tätä.

### Client-tila {#dll-client-mode}

- Lukee ensimmäisen parametrin metagamen osoitteeksi. Se tekee niin vain, kun exe-tiedoston nimen
  jälkeen on vähintään kaksi parametria, mikä pätee meidän käynnistäjillämme aina.
- Kaappaa pelimoottorin asetushaun (`FConfigCacheIni::GetString`). Se vastaa 167 osoiteavaimeen,
  missä osiossa tahansa niitä kysytään, arvolla `http://<osoite>/...`. Jokaisessa osiossa, jonka
  nimessä on `Mcp`, avaimet, joiden nimessä on `Protocol` tai `protocol`, saavat arvon `http`, ja
  avaimet, joiden nimessä on `Domain` tai `RedirectUrl`, saavat osoitteen. Näin myös Epicin tili- ja
  OAuth-liikenne ohjautuu metagamelle. Chat-avaimia tämä ei kata, ja siksi tarvitaan
  [`Engine.ini`-ohitus](#xmpp).
- Lisäksi: `UConsole` näppäimessä F2, `HasFinishedLoading` pakotettuna todeksi, Arena- ja
  Escalation-metsästykset avattuina (paitsi Escalationit, joiden tunnisteessa on `Mint`) sekä
  konsoli-ikkuna (”Running as a debug-enabled client!”).

### Palvelintila {#dll-server-mode}

- Lukee yllä kuvatut paikkasidonnaiset parametrit.
- Lisää jokaiseen HTTP-pyyntöön `x-undaunted-gameserver-apikey`-otsakkeen, jossa on pelipalvelimen
  avain.
- **Ei** kaappaa asetushakua. Siksi pelipalvelimet tarvitsevat [`Game.ini`-tiedoston](#game-ini).
- Antaa pelimoottorille kiinteän komentorivin, käynnistyy suoraan kentän URL-osoitteeseen, alkaa
  kuunnella kolme sekuntia sen jälkeen, kun maailma on olemassa, hoitaa itse aktorien replikoinnin ja
  soveltaa tyhjäkäyntisulkeutumista.

Palvelintilan toiminta pelimoottorin sisällä kerrotaan sivulla
[Näin moninpeli toimii]({{ mp_page.url | relative_url }}).

### Sisäänrakennetut vakiot {#dll-constants}

Mitään näistä ei voi säätää asetuksilla. Minkä tahansa muuttaminen tarkoittaa DLL:n kääntämistä
uudelleen, mikä muuttaa sen kiinnitettyä tiivistettä. Kääntäminen lähdekoodista on
[tiekartalla]({{ roadmap_page.url | relative_url }}).

| Vakio | Arvo | Tila |
|:------|:-----|:-----|
| DLL:n versio | `0.0.3` (`UndauntedInternalServer/constants.h`), tulostetaan konsoli-ikkunaan | Molemmat |
| Tilan valinta | `-server` missä tahansa raa'assa komentorivissä, kirjainkoko huomioiden | Molemmat |
| Konsoli-ikkuna | Avataan aina | Molemmat |
| Metagamen osoite | Ensimmäinen parametri, luetaan, kun exen jälkeen on vähintään kaksi parametria | Client |
| Osoitetaulukko | 167 avainta, myös `Game.ini`-tiedoston lähde | Client |
| Konsolinäppäin | F2 | Client |
| Parametrien vähimmäismäärä | 8 exe-tiedoston nimen jälkeen | Palvelin |
| Pelimoottorin komentorivi | `Dauntless-Win64-Shipping.exe -server -unattended -nullrhi -nosound -EpicPortal -RepDriverDisable` | Palvelin |
| Avainotsake | `x-undaunted-gameserver-apikey` | Palvelin |
| Kuuntelun alku | 3 sekuntia sen jälkeen, kun maailma on olemassa | Palvelin |
| Tyhjäkäyntisulkeutuminen | Yhteensä 50 sekuntia ilman yhdistettyä pelaajaa | Palvelin |
| Ei tyhjäkäyntisulkeutumista | Portit 8776 ja siitä ylöspäin | Palvelin |

---

## Kiinnitetyn version tiedot {#pinned-build}

Kaikki tällä sivulla riippuu yhdestä tarkasta versiosta. Jokainen palvelin-DLL:n koukkuosoite ja
tavupaikkaus on siirtymä kiinnitetyn exe-tiedoston sisällä, joten juuri exen tiiviste pitää DLL:n
lataamisen turvallisena.

| Tieto | Arvo |
|:------|:-----|
| Versiomerkkijono (`Version.txt` pelikansiossa) | `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827`. Tiedosto päättyy välilyöntiin ja rivinvaihtoon (58 tavua), joten vertaa tekstiä, josta tyhjät merkit on poistettu alusta ja lopusta. |
| Muutoslista (changelist) | `239827`. Palvelinpaketti kirjoittaa sen metagamen asetuksiin nimellä `TARGET_CHANGELIST`, ja metagame ilmoittaa koontiversion tunnisteen `239827_1.4.4_shipping`, kun se lähettää pelaajan pelipalvelimelle. `TARGET_CHANGELIST`-muuttujalla ei ole oletusarvoa: jos sitä ei ole asetettu, tunnisteeksi tulee `undefined_1.4.4_shipping`. |
| Pelimoottori | Unreal Engine `4.25.3-239827+++dauntless+rel-1.4.4`, versio, josta DLL:n SDK-otsaketiedostot on generoitu |
| Exe | `Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe`, SHA-256 `D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4`, 103 673 520 tavua |
| Pelin zip | `BaseGame144.zip`, SHA-256 `556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D`, 10 479 214 119 tavua. Sen ylin kansio on `Dauntless\`, jonka sisällä on `Archon\`. |
| Sisältöluettelo | `UndauntedContent/data/dauntless-1.4.4.json`: 410 tiedostoa, 10 893 512 875 tavua, ja `build`-kenttä, joka on sama kuin versiomerkkijono. Se ei listaa ini-tiedostoja (pelin mukana tulleet asetukset ovat pak-tiedostojen sisällä, ja käyttäjän asetukset ovat pelikansion ulkopuolella) eikä kahta DLL-tiedostoa. Luotu työkalulla `tools/make-game-manifest.js`. |
| Phoenixin oma luettelo | `Manifest.bin.json` pelikansiossa: 406 merkintää. Meidän 410 tiedostoamme ovat nämä sekä itse `Manifest.bin.json`, `Manifest.bin` ja kaksi tyhjää `debug.log`-tiedostoa. Miten tarkistimme sen, kerrotaan sivun [Pystytä palvelin vaiheessa 2]({{ host_page.url | relative_url }}#verify-the-build) ja sivulla [Pelitiedostojen tarkistaminen]({{ verification_page.url | relative_url }}). |

### Kuka tarkistaa kiinnitykset {#pin-checks}

| Tarkistus | Käynnistin | Kaveripaketti | Palvelinpaketin asennusohjelma | Muualla |
|:----------|:-----------|:--------------|:-------------------------------|:--------|
| Pelin zipin SHA-256 | Ei koske: se lataa yksittäisiä tiedostoja, ei zipiä | `setup.ps1 -Zip` | Jatkettava lataus tarkistetaan sitä vasten; zipin tiiviste lasketaan uudelleen ennen purkamista | `tools/make-game-manifest.js` hylkää minkä tahansa muun zipin, ellei sitä ajeta valinnalla `--zip-sha256` tai `--skip-zip-hash`; silloinkin se hylkää zipin, jonka `Version.txt` tai exe poikkeaa kiinnityksistä |
| Exen SHA-256 | Ennen jokaista PELAA-painallusta | `setup.ps1`, ja `play.ps1` jokaisella käynnistyksellä | Ennen kuin pelikansiosta ajetaan mitään; pysähtyy, jos tiiviste on väärä (ei pakoteta `-Sandbox`-asennuksessa) | `tools/make-game-manifest.js` |
| DLL-tiedostojen SHA-256 | Asennuksessa ja ennen jokaista PELAA-painallusta (korjaa ne) | `setup.ps1` ennen kopiointia ja sen jälkeen; `play.ps1` jokaisella käynnistyksellä | Ennen kopiointia ja sen jälkeen | `tools/make-friend-kit.ps1` ennen pakkaamista |
| Versiomerkkijono | Käynnistimeen käännetyssä sisältöluettelossa on oltava se, tai käynnistin hylkää luettelon | Ei tarkisteta | Varoittaa, jos `Version.txt` nimeää toisen version | `tools/make-game-manifest.js` tarkistaa zipin sisällä olevan `Version.txt`-tiedoston; sisältöpalvelin vain kirjaa varoituksen, jos luettelossa on toinen versio |
| Jokainen pelitiedosto | Jokainen lataus tarkistetaan käynnistimeen käännettyä sisältöluetteloa vasten; Korjaa-toiminto laskee jokaisen tiedoston tiivisteen uudelleen | Ei tarkisteta | `lib/verify-game.js` tarkistaa jokaisen tiedoston tiivisteen luetteloa vasten | Sisältöpalvelin tarkistaa koot käynnistyessään ja jakaa vain luettelossa olevia tiedostoja |

### Missä kiinnitykset ovat {#pin-locations}

Yhtä totuuden lähdettä ei ole: samat arvot on kirjoitettu useaan tiedostoon. Muuta niitä yhdessä, ja
vain samalla kertaa niiden tiedostojen kanssa, joita ne kuvaavat.

| Arvo | Tiedostot |
|:-----|:----------|
| Exen SHA-256 | `UndauntedLauncher/src/main/constants.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `friend-kit/play.ps1`, `friend-kit/setup.ps1`, `tools/make-game-manifest.js`, `UndauntedContent/data/dauntless-1.4.4.json` (ja sen testi) |
| Exen koko | `UndauntedLauncher/src/main/constants.ts` ja `UndauntedContent/data/dauntless-1.4.4.json` (ja sen testi). Muut tiedostot tarkistavat vain tiivisteen. |
| DLL-tiedostojen SHA-256:t | `UndauntedLauncher/src/main/constants.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `friend-kit/play.ps1`, `friend-kit/setup.ps1`, `tools/make-friend-kit.ps1` |
| Zipin SHA-256 | `deploy/windows-server/DauntlessServer.Common.ps1` (tavumäärän kanssa), `friend-kit/setup.ps1`, `tools/make-game-manifest.js` |
| Versiomerkkijono | `UndauntedLauncher/src/main/manifest.ts`, `UndauntedContent/src/manifest.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `tools/make-game-manifest.js`, sisältöluettelon JSON-tiedosto |
| Muutoslista | `deploy/windows-server/DauntlessServer.Common.ps1`, joka kirjoittaa metagamen `TARGET_CHANGELIST`-arvon |

---

## Metagamen tarjoama pelidata {#server-data}

Osa siitä, mitä peli näyttää, tulee metagamen omista datatiedostoista eikä pelin pak-tiedostoista:
etenemisradat (Hunt Pass -kaudet ja mestaruus), kaupan tarjoukset ja Escalation-kaudet. Ne ovat
kansiossa `UndauntedMetagame/src/vendor/`, ja käännös kopioi ne kansioon `dist/vendor/`. Niissä on
1.4.4-peliohjelmasta luettuja tunnisteita ja viritysarvoja eikä lainkaan pelin sisältöä (grafiikkaa
tai muuta).

### Hunt Pass -kaudet ja mestaruusradat {#hunt-pass-seasons}

`vendor/progression_config.json` (alkuperäisestä projektista) sisältää 10 rataa: Hunt Passin
`season09b`, `MasteryTrack_PlayerLevel` (Slayer-taso), `MasteryTrack_Behemoth` ja seitsemän
`MasteryTrack_Weapon_*`-rataa. Metagame tarjoaa sen osoitteessa `GET /progression/config`, ja sama
data ohjaa sen tasolaskentaa, joten peli ja palvelin ovat aina samaa mieltä.

**`PROGRESSION_CONFIG_DIR`** (oletuksena asettamaton) osoittaa kansioon, jossa on omia
`.json`-tiedostojasi, jotka korvaavat ratoja tai lisäävät niitä ilman, että mukana tulevaa tiedostoa
muokataan:

- Jokaisessa tiedostossa on yksi rata-olio (samanmuotoinen kuin mukana tulevan tiedoston
  `payload.paths`-merkintä), niiden luettelo tai kokonainen asetustiedosto `{"payload": {"paths": [...]}}`.
  Tiedostot luetaan nimijärjestyksessä.
- Rata, jonka `progression_id` on jo mukana tulevassa tiedostossa, korvaa sen samalla paikalla
  (peliohjelma näkee saman järjestyksen); uusi tunnus lisätään loppuun.
- Jokainen rata tarvitsee kentän `progression_id` ja ei-tyhjän `requirements`-luettelon
  `{"rank_id", "xp_required"}`-kokonaislukupareja nousevassa `rank_id`-järjestyksessä. `free_rewards`
  ja `premium_rewards` ovat luetteloita, jos ne ovat mukana; `premium_gating_entitlement` on merkkijono
  (Elite-passin oikeus); `prestige`, jos se on mukana, sisältää kokonaisluvun `xp_per_level`, joka on
  yli 0. Jokaisella palkintoluettelossa käytetyllä `rank_id`-arvolla on oltava vaatimuksensa, tai
  peliohjelma valittaa ([Taustapalvelun rajapinta]({{ '/fi/findings/backend-contract.html' | relative_url }}#progression-progression-prod)).
- Sama tunnus kahdesti kansiossa, virheellinen JSON, puuttuva kansio tai kansio ilman `.json`-tiedostoja
  pysäyttää metagamen käynnistyksessä rivillä, joka nimeää tiedoston (`The progression config could not
  be loaded: ...`). Käynnistysrivi on silloin esimerkiksi `Progression config: 10 tracks, from
  C:/dr/seasons: season09b replaced; active Hunt Pass season09b`.
- Kansio luetaan kerran; käynnistä metagame uudelleen muutoksen jälkeen.

**`ACTIVE_HUNT_PASS`** (oletus `season09b`) on Hunt Pass, joka tilillä on, kunnes sille on tallennettu
jokin muu. Sen on oltava ladattu rata, tai metagame pysähtyy käynnistyksessä.

**Älä koskaan muuta kauden tasoja paikallaan, kun pelaajilla on siinä etenemistä.** Pelaajien
tallennettu XP muutetaan tasoiksi uusien vaatimusten mukaan seuraavalla lukukerralla, joten tasot
voisivat hypätä tai pudota. Itse tasopalkinnot maksaa pelipalvelin peliohjelman omista
palkintotaulukoista ([miksi]({{ '/fi/findings/backend-contract.html' | relative_url }}#progression-on-our-server)).

### Kaupan valikoima {#store-catalogue}

Käytössä vain asetuksella `STORE=free` ([Pelin kauppa]({{ '/fi/findings/store.html' | relative_url }})):

| Tiedosto | Mitä siinä on |
|:---------|:--------------|
| `vendor/store_catalog.json` | Tarjoukset sen tunnisteen alla, jota peliohjelma pyytää: 200 tunnisteen `webstore` alla, Elite-passi tunnisteen `season09b_pass` alla sekä tyhjät `season09b_rank`, `loadout_slots` ja `fountain_daily_free_bundle`. Jokaisella tarjouksella on peliohjelman litteät hintakentät (kaikki 0), `items` (tavaran tunnus ja määrä) ja `entitlements` (nimi ja kesto) sekä luokkatunnisteet, jotka ratkaisevat sen välilehden. Metagame myy vain tarjouksia, joiden `platinumPrice` on 0. |
| `vendor/store_item_kinds.json` | Jokaiselle kaupan 211 tavarasta: `stacked` tai `instanced`, peliohjelman tavaraluettelon pinottavuusmerkintä. Tavaraa, jolla ei ole merkintää, ei koskaan anneta. |
| `test/data/store_art_skus.json` | Ne 994 tarjoustunnusta, joiden kaupparuudun kuva on 2:1. Vain testi lukee sitä: jokaisen kaupan tarjouksen on oltava yksi niistä, tai sen ruutu näyttää varakuvan tai venytetyn kuvan. |

Muuta valikoimaa vain yhdessä testin (`npm test` kansiossa `UndauntedMetagame`) ja kaupan
välilehtien pelissä tehdyn tarkistuksen kanssa: tyhjä välilehti täytetyn edellä siirtää kaikkien
myöhempien välilehtien sisällön. Toistettavasti ostettava palkkiotehtävien tunnisteiden paketti
(`bundle_currency_bounty_small`) näkyy vain asetuksella `STORE_REPEATABLE_TOKENS=1`.

### Escalation-kaudet {#escalation-seasons}

Käytössä vain asetuksella `ESCALATION_MODE=real` ([Escalation]({{ '/fi/findings/escalation.html' | relative_url }})):
`vendor/escalation/seasons.json` luettelee 1.4.4-peliohjelman viisi kautta (`ESC_SEASON_1`–`ESC_SEASON_5`;
viides, Frost, on pois käytöstä), kullakin 25 tason hinnat, 18 kykyä (portaan raja ja asteiden hinnat)
ja 6 palkintoa (taso ja sisältö). Se vietiin vain lukien peliohjelman omista taulukoista, ja sen
`source`-osa nimeää pelitiedostot, joista se luettiin, niiden SHA-256-tiivisteillä. Metagame tarkistaa
sen käynnistyksessä ja käyttää sitä vain tallennusten tarkistamiseen; pelipalvelin tekee laskut. Älä
muokkaa sitä: väärä arvo torjuu oikeita tallennuksia (tai pehmeissä säännöissä varoittaa niistä).

---

## Pelin asetusten muuttaminen {#changing}

Kehittäjille. `Engine.ini`-rivit ovat neljänä kopiona, joiden on pysyttävä samoina:

- `UndauntedLauncher/src/main/engineini.ts`
- `friend-kit/play.ps1`
- isännän `play.ps1` ja sen listaus sivun
  [Pystytä palvelin vaiheessa 13]({{ host_page.url | relative_url }}#launch-the-client)
- `Write-DRGameUserConfig` tiedostossa `deploy/windows-server/DauntlessServer.Common.ps1` (vain
  muistirivit ja chat)

Käynnistysparametrit ovat tiedostoissa `UndauntedLauncher/src/main/launch.ts` ja `friend-kit/play.ps1`
sekä isännän `play.ps1`-skriptissä.

Niitä kattavat testit: `UndauntedLauncher/test/engineini-launch.test.ts` tarkistaa käynnistimen
`Engine.ini`-tiedoston tavu tavulta ja kiinnittää tarkan parametrilistan, ja
`deploy/windows-server/tests/Test-Sandbox.ps1` tarkistaa, että hiekkalaatikkoasennus kirjoittaa 167
`Game.ini`-riviä, jotka osoittavat osoitteeseen `127.0.0.1:62000`. Mikään ei testaa paketin
`Engine.ini`-tiedostoa. Paketin `Game.ini`-generaattori olettaa, että jokainen `dllmain.cpp`:n
osoitetaulukon merkintä pysyy yhdellä rivillä nykyisessä muodossaan. Kun taulukkoa muutetaan, aja
asennusohjelma uudelleen jokaisella palvelimella. Testien ajaminen kerrotaan
[kehittäjän oppaassa]({{ dev_page.url | relative_url }}).
