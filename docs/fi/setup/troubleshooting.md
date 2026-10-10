---
title: Vianetsintä
parent: Asennus
grand_parent: Dauntless Revived suomeksi
nav_order: 5
description: "Dauntless 1.4.4 ja Dauntless Revived -palvelin: ongelmat, joihin törmäsimme, syineen ja korjauksineen. Varatut portit, kirjautuminen, sumea grafiikka, Defender ja git."
lang: fi
ref: setup/troubleshooting
locale: fi_FI
---

{% assign host_page = site.pages | where: "path", "fi/setup/host.md" | first %}
{% assign roadmap_page = site.pages | where: "path", "fi/roadmap.md" | first %}
{% assign crashes_page = site.pages | where: "path", "fi/findings/crashes.md" | first %}
{% assign awakening_page = site.pages | where: "path", "fi/findings/awakening-2-1-1.md" | first %}
{% assign files_page = site.pages | where: "path", "fi/reference/files.md" | first %}
{% assign chat_page = site.pages | where: "path", "fi/findings/chat.md" | first %}
{% assign config_page = site.pages | where: "path", "fi/reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "fi/reference/ports.md" | first %}

# Vianetsintä
{: .no_toc }

Nämä ovat ongelmat, joihin oikeasti törmäsimme Dauntless Revivedia pystyttäessä, syineen ja
korjauksineen. Muutama lopun kohta on peräisin koodin lukemisesta, eivätkä ne ole vielä osuneet
meihin; ne on merkitty. Itse asennus on sivulla [Pystytä palvelin]({{ host_page.url | relative_url }}).
Ellei kohdassa sanota toisin, se koskee peliversiota **1.4.4**. Versiota **2.1.1** koskevat kohdat on
säilytetty, koska samalla koneella on usein molemmat versiot.

Muutama selitys ensin: metagame on taustapalvelu, joka hoitaa tilit ja hahmot. Deploy-palvelin on
ohjelma, joka käynnistää pelipalvelimet. Peliohjelma (client) on pelaajan oma Dauntless-ohjelma.
Portti on numeroitu ”ovi”, jonka kautta ohjelmat ottavat yhteyttä toisiinsa.

<details open markdown="block">
  <summary>Sisältö</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Mistä katsoa ensin {#where-to-look-first}

| Lähde | Mitä se kertoo |
|---|---|
| `C:\dr\data\metagame.log` | Yksi JSON-rivi tapahtumaa kohden. Fork kirjaa jokaisen pyynnön muodossa `METHOD /path gs=0` (peliohjelma) tai `gs=1` (pelipalvelin). Tämä on tärkein mittarimme: kuinka pitkälle peliohjelma pääsi, ja mitä se pyysi viimeksi? |
| `C:\dr\data\deploy.log` | Matchmaking-pyynnöt, `Running Gameserver Watchdog!` 60 sekunnin välein ja `Cleaning up Gameserver on port N`, kun palvelin sulkeutuu. |
| Pelipalvelinten konsoli-ikkunat | Palvelin-DLL:n avaamia; ne näyttävät palvelimen oman tulosteen. Ramsgaten ja Dojon ikkunat näkyvät. Metsästyspalvelimet käynnistetään ikkuna piilotettuna. |
| Peliohjelman konsoli-ikkuna | DLL avaa sen client-tilassa ja pitää sen piilossa. Näet sen, kun otat käynnistimessä käyttöön Asetukset > Vianmääritys > "Näytä lokiruutu" (se antaa pelille `DR_SHOW_CONSOLE=1`). **Kun asetus on käytössä ja konsoli-ikkunaa ei ilmesty peliohjelman käynnistyessä, DLL-tiedostot eivät ole latautuneet.** |
| `%LOCALAPPDATA%\Archon\Saved\Crashes\` | Kaatumisraportit. Niiden lukemisesta kerrotaan sivulla [Kaatumisten tutkiminen]({{ crashes_page.url | relative_url }}). |
| `C:\DauntlessRevived\data\logs\` (Windows-palvelinpaketti) | Samat lokit nimillä `metagame.out.log` ja `deploy.out.log` sekä yhdyskäytävän pääsyloki (`gateway.out.log`) ja valvojan `supervisor.log`. |
| `%APPDATA%\Dauntless Revived Launcher\logs\launcher.log` | Kavereiden käynnistin: liittymiset, yhteysongelmat, lataukset ja pelin komentorivi (avain piilotettuna). |

Jokainen lokitiedosto, sen muoto ja kierrätys: [Tiedostot ja data]({{ files_page.url | relative_url }}#logs).

1.4.4:n shipping-peliohjelma ei kirjoita omaa pelilokitiedostoa. `Saved\Logs` sisältää vain pelin
sisäisen selaimen lokit. Näin luet metagamen lokia tavallisena tekstinä:

```powershell
Get-Content C:\dr\data\metagame.log -Tail 40 | ForEach-Object { try { ($_ | ConvertFrom-Json).msg } catch { $_ } }
```

---

## Portti 60000 on varattu, ja metagame sanoo silti ”Clear Skies” {#port-60000-is-taken-and-the-metagame-says-clear-skies-anyway}

**Oire.** Metagame tulosti kuuntelevansa porttia 60000 ja `Clear Skies, Slayer.`, mutta mikään ei
toiminut. Peliohjelma ja omat HTTP-kutsumme osoitteeseen `127.0.0.1:60000` saivat yhteyden ja
jäivät sitten odottamaan loputtomiin. Pyyntöloki pysyi tyhjänä.

**Syy.** Kaksi ongelmaa yhdessä:

1. `127.0.0.1:60000` kuului **`ShadowUSB`**-palvelulle, joka asentui Shadow-sovelluksen mukana
   (pilvipelaamisen sovellus, asennettuna omalle koneellemme). Se hyväksyy TCP-yhteydet siinä
   portissa eikä koskaan vastaa HTTP:llä.
2. Alkuperäisen koodin `app.listen(PORT, () => { ... })` jättää huomiotta virheen, jonka Express 5
   antaa kuuntelun takaisinkutsulle. Epäonnistunut porttivaraus tulosti silti onnistumisrivit, ja
   sitten prosessi sulkeutui.

**Korjaus.**

- Selvitä, kenen portti on, ennen kuin käytät sitä:

  ```powershell
  Get-NetTCPConnection -LocalPort 60000,61000,61001 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { "{0}:{1} {2}" -f $_.LocalAddress, $_.LocalPort, (Get-Process -Id $_.OwningProcess).ProcessName }
  ```

- Siirryimme portteihin **61000** (metagame) ja **61001** (deploy-palvelin). Muuta metagamen
  `.env`-tiedostossa `PORT`, `QOS_TARGET_URL` ja `DEPLOYSERVER_URL` sekä deploy-palvelimen
  `.env`-tiedostossa `PORT`. Sitten **luo `Game.ini` uudelleen** komennolla
  `make-gameini.ps1 -Metagame 127.0.0.1:61000`
  ([Pystytä palvelin, vaihe 8]({{ host_page.url | relative_url }}#game-ini)).
- Forkimme metagame ja deploy-palvelin pitävät nyt epäonnistunutta porttivarausta vakavana virheenä ja
  sulkeutuvat koodilla 1:

  ```
  Could not listen on 127.0.0.1:60000: listen EADDRINUSE: address already in use 127.0.0.1:60000
  ```

**Jatko-ongelma, johon myös törmäsimme.** Siirron jälkeen kaksi `Game.ini`-tiedoston merkintää oli yhä
portissa 60000. Etsi ja korvaa -toimintomme osui merkkijonoon `:60000/`, mutta `MatchmakingEndpoint`
ja `TrackingEndpoint` ovat pelkkiä `http://host:port`-arvoja ilman polkua, joten matchmaking ja
telemetria (pelin lähettämät käyttötiedot) olisivat jääneet vanhaan porttiin. Haku jäljelle jääneistä
`60000`-merkkijonoista paljasti ne. Kun tiedosto luodaan uudelleen muokkaamisen sijaan, tätä ei tapahdu.

---

## Invoke-RestMethod jumittaa {#invoke-restmethod-hangs}

**Oire.** Windows PowerShell 5.1:ssä komento
`Invoke-RestMethod -Method Post -Uri http://127.0.0.1:60000/undaunted/api/Register ...` ei koskaan
palannut, eikä metagame kirjannut mitään.

**Mitä se oikeasti oli.** Aluksi pidimme sitä PowerShell 5.1:n omituisuutena ja siirryimme käyttämään
Nodea. Todellinen syy oli edellinen kohta: portti kuului `ShadowUSB`-palvelulle, joka hyväksyi
yhteyden eikä koskaan vastannut. `curl.exe -m 5` teki sen selväksi: se sai yhteyden heti, ei saanut
HTTP-vastausta 5 sekunnissa (`http=000`), ja kuuntelevan prosessin tarkistus näytti `ShadowUSB`:n.

**Korjaus ja hyvä tapa.**

- Tarkista, kenen portti on (edellinen kohta), ennen kuin syytät peliohjelmaa.
- Laita aikaraja jokaiseen skriptillä tehtyyn HTTP-kutsuun, jotta väärä kuuntelija epäonnistuu
  nopeasti:

  ```powershell
  curl.exe -s -m 5 http://127.0.0.1:61000/dauntless-status
  Invoke-RestMethod -Uri http://127.0.0.1:61000/dauntless-status -TimeoutSec 10
  node -e "fetch('http://127.0.0.1:61000/dauntless-status', { signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(console.log)"
  ```

Teemme ylläpitokutsut yhä Noden `fetch`-funktiolla ja `AbortSignal.timeout`-aikarajalla, koska sama
yhden rivin komento voi myös päivittää tietokantaa `better-sqlite3`-kirjaston kautta (katso
[Pystytä palvelin, vaihe 10]({{ host_page.url | relative_url }}#admin-account)).

---

## git: ”Filename too long” ja ”'$GIT_DIR' too big” {#git-filename-too-long}

**Oire.** Kun kloonasimme (kopioimme) Undauntedin syvällä sisäkkäisissä kansioissa olevaan
työkansioon, git tulosti `error: unable to create file ...: Filename too long`, jopa tiedostoille kuten
`.git/hooks/fsmonitor-watchman.sample`. Sitten se päättyi näin:

```
fatal: '$GIT_DIR' too big
fatal: remote helper 'https' aborted session
```

**Syy.** Windowsin 260 merkin polkuraja. Työkansion polku oli jo pitkä, ja repositorio lisää jopa 94
merkkiä. Syvimmät nimet ovat kansiossa `UndauntedInternalServer/SDK/`, joka on yli 4 000 tiedoston
generoitu SDK. Gitin omat tiedostot `.git`-kansiossa lisäävät pituutta vielä. Valitsimen
`-c core.longpaths=true` lisääminen **ei** korjannut ongelmaa: `$GIT_DIR`-virhe johtuu siitä, että
itse repositorion sijainnin polku on liian pitkä.

**Korjaus.** Kloonaa lyhyeen polkuun ja pidä `core.longpaths` asetettuna sen sisällä olevia tiedostoja
varten:

```powershell
git -c core.longpaths=true clone <URL of this repository> C:\dr\undaunted
git -C C:\dr\undaunted config core.longpaths true
```

Emme ottaneet käyttöön Windowsin koko järjestelmän pitkien polkujen asetusta. Lyhyt polku teki siitä
tarpeettoman. Sama perustelu koskee peliasennusta (`C:\D144`) ja palvelin-DLL:n myöhempää kääntämistä
MSVC:llä.

---

## Sumea grafiikka {#blurry-graphics}

**Oire.** 1.4.4 näytti pehmeältä ja vähäyksityiskohtaiselta, valitsimmepa asetusvalikosta mitä
tahansa, ja pyöri pienessä ikkunassa.

**Syy.** Omat muistirajoituksemme. 2.1.1:n muistisäikähdyksen jälkeen (seuraava kohta) olimme
kirjoittaneet nämä jaettuun käyttäjän `Engine.ini`-tiedostoon, ja käynnistimme pelin valitsimilla
`-windowed -ResX=1280 -ResY=720`:

```ini
[SystemSettings]
r.Streaming.PoolSize=400
r.Streaming.LimitPoolSizeToVRAM=1
r.Streaming.FullyLoadUsedTextures=0
r.MipMapLODBias=2
r.ScreenPercentage=70
sg.ViewDistanceQuality=0
sg.ShadowQuality=0
sg.PostProcessQuality=0
sg.TextureQuality=0
sg.EffectsQuality=0
sg.FoliageQuality=0
t.MaxFPS=60
gc.TimeBetweenPurgingPendingKillObjects=10
s.ForceGCAfterLevelStreamedOut=1
```

Käyttäjän `Engine.ini`-tiedoston `[SystemSettings]` ohittaa valikon. Niinpä asetusnäkymä näytti yhtä,
kun taas pelimoottori piirsi kuvan 70 prosentin resoluutiolla ja sumennetuilla tekstuuritasoilla.
Lisäksi UE4:n ajallinen reunanpehmennys (temporal anti-aliasing) pehmentää kuvaa hieman millä tahansa
asetuksella.

**Korjaus.** `play.ps1` kirjoittaa nyt `[SystemSettings]`-osion uudelleen jokaisella käynnistyksellä
([Pystytä palvelin, vaiheet 13–14]({{ host_page.url | relative_url }}#graphics)):

- Oletuksena `-Graphics 4` (Cinematic).
- `r.ScreenPercentage=100`, `r.MipMapLODBias=0`, `r.MaxAnisotropy=16`, `r.Tonemapper.Sharpen=0.6`.
- 3000 megatavun tekstuuripooli, rajattuna näytönohjaimen muistiin.
- Sama taso kopioituna `GameUserSettings.ini`-tiedostoon.
- Ei FPS-rajaa eikä pakotettua ikkunaa.

`-Graphics -1` pitää vain muistirivit ja antaa valikon päättää. Cinematic-tasolla ja resoluutiolla
1920x1080 peliohjelma käyttää 1,9–2,3 Gt keskusmuistia (RAM), joten matalia rajoja ei koskaan
tarvittu 1.4.4:ssä.

### Ilmalaiva on tosi pimeä ja ikkunat palavat puhki valkoisiksi {#airship-dark-windows-blown-out}

**Oire.** Metsästysretken valikot näyttävät normaaleilta, mutta ilmalaivan hytti ennen retkeä on lähes
musta ja sen ikkunat täysin valkoiset. Ilmiö voi vaihdella retkestä toiseen, koska aula näyttää retken
kohteen tunnelman.

**Syy.** Dauntless 1.4.4:n automaattinen valotus (histogrammiin perustuva ”silmän sopeutuminen”)
reagoi huonosti ilmalaivan tavallista suurempaan kirkkauserojen määrään nykyisillä näytönohjainten
ajureilla. Kyse on jälkikäsittelystä, ei puuttuvista tekstuureista eikä väärästä retken määrityksestä.

**Tilanne: ei korjattu oletuksena.** Vvoidddd huomasi, että `Engine.ini`-tiedoston rivi
`r.EyeAdaptationQuality=0` (automaattinen valotus pois) korjaa ilmalaivan, ja käynnistimen versio 0.1.0
sekä kaveripaketti asettivat sen. Ensimmäisessä oikeassa testissä (22. syyskuuta 2026) se teki
Ramsgatesta ja kaikista yökohtauksista aivan liian pimeitä, koska ne tarvitsevat automaattista valotusta
kirkastuakseen. Siksi käynnistimen versiosta 0.1.1 alkaen mikään ei laita automaattista valotusta pois,
ja käynnistin poistaa version 0.1.0 kirjoittaman rivin seuraavalla käynnistyskerralla. Ilmalaivan hytti on
lyhyt kohtaus.

**Kokeilu, jota voit kokeilla.** Vvoidddd lisäsi käynnistimeen valinnaisen asetuksen
([#7](https://github.com/mixutin/dauntless-revived/pull/7)): kohdassa Asetukset > Grafiikka
**Automaattinen valotus** tarjoaa vaihtoehdon **Mukautuva perusvalotus (kokeellinen)**. Se
kirjoittaa `Engine.ini`-tiedostoon rivin `r.EyeAdaptation.MethodOverride=2`, jonka 1.4.4:n
peliohjelma (tiivisteellä kiinnitetty `Dauntless-Win64-Shipping.exe`) kuvaa nimellä ”Auto Basic”:
yksinkertaisempi tapa mitata kuvan kirkkautta, ja automaattinen valotus pysyy päällä. Kaikkien
oletus on edelleen **Pelin oletus**. Kokeile perusvalotusta omalla koneellasi ja vertaa samaa
ilmalaivaa, Ramsgatea ja yömetsästystä. Jos jokin näyttää huonommalta, valitse taas Pelin oletus ja
käynnistä peli uudelleen. Rivi jää `Engine.ini`-tiedostoon seuraavaan käynnistykseen asti, kun peli
käynnistetään käynnistimellä tai kaveripaketilla, joka myös kirjoittaa sen osion uudelleen. Kukaan
ei ole vielä tarkistanut tulosta pelissä, joten korjaus, joka ei pimennä muuta peliä, on yhä
[tiekartalla]({{ roadmap_page.url | relative_url }}) kohtana 4.17.

Näin näet, mitä oikeasti pakotetaan:

```powershell
Get-Content "$env:LOCALAPPDATA\Archon\Saved\Config\WindowsClient\Engine.ini" -TotalCount 20
```

---

## Muistipiikit ja rajat {#memory-spikes-and-caps}

**Mitä tapahtui (2.1.1).** Erillinen 2.1.1-peliohjelma, joka käynnistyi suoraan Ramsgateen ilman
rajoituksia, nousi **9 gigatavuun**. Yhdessä kaiken muun käynnissä olleen kanssa se vei 32 gigatavun
koneemme muistin 98 prosenttiin (31,3 / 31,9 Gt). 400 megatavun tekstuuripoolilla, matalilla
laatutasoilla ja kahdella roskienkeruurivillä sama käynnistys nousi enimmillään noin **2,8
gigatavuun**. Lisäsimme myös vahtikoiran, joka lopetti prosessin 6,5 gigatavun yläpuolella.
Yksityiskohdat: [Itsenäinen käynnistys 2.1.1:llä]({{ awakening_page.url | relative_url }}).

**1.4.4 on paljon kevyempi** (mittauksemme, yksi pelaaja):

- Ramsgate-palvelin: noin 1,1 Gt.
- Metsästyspalvelin: noin 0,9 Gt.
- Peliohjelma Cinematic-tasolla: 1,9–2,3 Gt.

Siksi kokoonpano pitää vain ne rajat, jotka eivät heikennä kuvanlaatua: 3000 megatavun pooli rajattuna
näytönohjaimen muistiin (VRAM) sekä `gc.TimeBetweenPurgingPendingKillObjects=10` ja
`s.ForceGCAfterLevelStreamedOut=1`.

**Mitä käytämme nyt.**

- `play.ps1 -Seconds 180 -CapMB 12000` valvoo peliohjelmaa 3 minuuttia. Se tulostaa muistinkäytön
  30 sekunnin välein ja lopettaa ohjelman, jos se ylittää rajan.
- Käsin ajettava palvelintestiskriptimme tekee saman pelipalvelimelle (oletusraja 5000 Mt).
- Sulje raskaat ohjelmat ennen pelikertaa. Jos käytät WSL:ää, `wsl --shutdown` vapauttaa sen
  virtuaalikoneen varaaman muistin (noin 3 Gt meidän koneellamme). Voit myös rajata sen pysyvästi
  tiedostossa `%UserProfile%\.wslconfig`:

  ```ini
  [wsl2]
  memory=4GB
  ```

**Tunnettu puute.** Alkuperäisen projektin deploy-palvelin käynnistää peliprosessit ilman muistirajaa,
ja kuusi samanaikaista metsästystä on mahdollista oletusporttialueella. Palvelinkohtainen muistisuoja
on [tiekartalla]({{ roadmap_page.url | relative_url }}). Siihen asti valvo palvelimia tällä komennolla:

```powershell
Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" | ForEach-Object { "{0,6}  server={1}  {2} MB" -f $_.ProcessId, ($_.CommandLine -match ' -server'), [int]($_.WorkingSetSize/1MB) }
```

---

## Jumiin jääneet EOS-overlay-prosessit (vain 2.1.1) {#stale-eos-overlay-processes}

**Oire (2.1.1).** Kaatuneen ajon jälkeen Epicin kirjautumisikkuna (overlay) ei tullut esiin
seuraavalla käynnistyksellä.

**Syy.** Kaatuneesta ajosta jääneet `EOSOverlayRenderer-Win64-Shipping`-prosessit.

**Korjaus.** Lopeta vain nuo prosessit ennen kuin käynnistät pelin uudelleen. Jätä Epic Games
Launcher rauhaan.

```powershell
Get-Process EOSOverlayRenderer-Win64-Shipping -ErrorAction SilentlyContinue | Stop-Process
```

Tämä ei koske tämän sivuston 1.4.4-kokoonpanoa. 1.4.4 on Epic Online Servicesiä vanhempi, siinä ei ole
EOS-overlayta, ja se kirjautuu avaimella, jonka oma metagamemme on myöntänyt.

---

## Windows Defender ja allekirjoittamattomat DLL-tiedostot {#windows-defender-and-the-unsigned-dlls}

**Tausta.** `dxgi.dll` ja `UndauntedInternalServer.dll` ovat allekirjoittamattomia. Peliin koukkuja
asentava (hook) välittäjä-DLL on juuri sellainen asia, jonka virustorjunnan heuristiikka merkitsee
epäilyttäväksi. Meidän koneellamme Defender **ei ilmoittanut mistään** sen jälkeen, kun kopioimme
tiedostot paikalleen. Tarkistimme sen näin:

```powershell
Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -gt (Get-Date).AddHours(-1) } |
  Select-Object InitialDetectionTime, @{n='Resources';e={$_.Resources -join ';'}}
```

**Jos Defender merkitsee tai poistaa jommankumman:**

- Älä kytke Defenderiä pois päältä, äläkä jätä kokonaisia kansioita tarkistuksen ulkopuolelle.
- Vertaa tiedostoasi kiinnitettyihin tiivisteisiin (tiedoston sormenjälkiin) sivulla
  [Pystytä palvelin, vaihe 5]({{ host_page.url | relative_url }}#dlls). Jos se ei täsmää, poista se ja
  kopioi uudelleen tuoreesta kloonista.
- Jos tiiviste täsmää, havainto on heuristinen ja koskee tavuja, jotka olemme analysoineet. Molempien
  tiedostojen staattisen analyysimme yhteenveto on vaiheessa 5. Palautatko sen yhden tiedoston
  kohdasta **Windowsin suojaus → Suojaushistoria**, on sinun päätöksesi.
- Kloonasimme gitillä, joten emme törmänneet tähän, mutta jos repositorio ladataan zip-tiedostona,
  tiedostot merkitään internetistä tulleiksi. Kun olet tarkistanut tiivisteet, `Unblock-File` kahdelle
  DLL-tiedostolle poistaa tuon merkinnän.

Pysyvä korjaus on kääntää `UndauntedInternalServer.dll` lähdekoodista ja korvata `dxgi.dll` omalla
pienellä välittäjällämme. `dxgi.dll`-tiedoston lähdekoodi ei ole Undauntedin repositoriossa, eikä sitä
tietääksemme ole julkaistu. Molemmat ovat [tiekartalla]({{ roadmap_page.url | relative_url }}).

---

## npm:n allow-scripts-varoitukset {#npm-allow-scripts-warnings}

**Oire.** `npm ci` (npm 11.17, Node 24.19) päättyi molemmissa palvelinkansioissa näin:

```
npm warn allow-scripts   esbuild@0.18.20 (postinstall: node install.js)
npm warn allow-scripts   better-sqlite3@12.11.1 (install: prebuild-install || node-gyp rebuild --release)
npm warn allow-scripts   esbuild@0.25.12 (postinstall: node install.js)
npm warn allow-scripts   esbuild@0.28.1 (postinstall: node install.js)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

**Mitä se tarkoitti meille.** Mikään ei hajonnut:

- `npm run build` (pelkkä `tsc`) onnistui.
- Ainoa palvelinten tarvitsema natiivimoduuli oli paikallaan.
- `esbuild`-työkalua käyttävät vain kehitystyökalut (`tsx`, `drizzle-kit`), eikä `npm start` aja
  niitä.

Tarkista natiivimoduuli:

```powershell
Test-Path C:\dr\undaunted\UndauntedMetagame\node_modules\better-sqlite3\build\Release\better_sqlite3.node
```

**Jos tämä tulostaa `False`,** metagame ei voi avata tietokantaansa. Tarkista ja hyväksy vain se
paketti, kuten npm ehdottaa, ja asenna sitten uudelleen:

```powershell
npm approve-scripts better-sqlite3
npm ci --no-audit --no-fund
```

Paketin asennusskripti lataa valmiiksi käännetyn tiedoston (`prebuild-install`) tai, jos se ei
onnistu, kääntää sellaisen itse (`node-gyp`, joka tarvitsee Visual Studion C++-käännöstyökalut). Emme
ole itse tarvinneet tätä vaihetta. Natiivimoduuli on sidottu Node-versioon, joten aja `npm ci`
uudelleen jokaisen Node-päivityksen jälkeen.

---

## Osoitearvot katkenneet muotoon ”https:” (ini-tiedoston `//`-katkaisu) {#ini-truncation}

**Oire (nähty 2.1.1:ssä).** Käyttäjän `Engine.ini`-tiedoston `[OnlineSubsystemPhoenix]`-lohkon kaikki
163 arvoa olivat pelkästään `https:`, esimerkiksi `AccountInfoEndpoint=https:`. Kaikki `//`-merkeistä
eteenpäin oli poissa.

**Syy.** Pelimoottorin ini-jäsennin tulkitsee `//`-merkit **lainausmerkittömässä** arvossa kommentin
aluksi ja katkaisee arvon siihen. Peli kirjoittaa asetuksensa takaisin levylle, joten katkenneet arvot
korvasivat alkuperäiset. Tuo lohko sattui olemaan vaaraton: `[OnlineSubsystemPhoenix]` kuuluu
`Game.ini`-hierarkiaan, joten `Engine.ini`-tiedostossa sitä ei koskaan luettu, ja 2.1.1:n oikea
liikenne tavoitti yhä täydet osoitteet. Ohituksena `Game.ini`-tiedostossa se olisi rikkonut jokaisen
osoitteen.

**Korjaus.**

- **Laita jokainen osoite lainausmerkkeihin** käyttäjän ini-tiedostossa, kuten Phoenixin mukana
  tulleissa asetuksissa: `AuthEndpoint="http://127.0.0.1:61000/game/login"`.
- Laita osoiteohitukset `Game.ini`-tiedostoon, ei koskaan `Engine.ini`-tiedostoon. Poista kaikki
  `[OnlineSubsystemPhoenix]`-lohkot, joita löydät `Engine.ini`-tiedostosta.
- Luo `Game.ini` skriptillä `make-gameini.ps1`
  ([Pystytä palvelin, vaihe 8]({{ host_page.url | relative_url }}#game-ini)) ja aja sen
  kuntotarkistus. Sen pitäisi ilmoittaa `entries: 167  not fully quoted: 0`.

Versiossa 1.4.4 peli on kirjoittanut lainausmerkein varustetun `Game.ini`-tiedostomme uudelleen monen
pelikerran jälkeen, ja jokainen arvo on ehjä. Emme ole testanneet lainausmerkittömiä arvoja 1.4.4:ssä.

---

## Pelipalvelin katosi, kun ikkuna suljettiin {#server-console-windows}

Jokainen pelipalvelin avaa konsolin (mustan tekstiruudun), koska palvelin-DLL:n konsolilokitus on
oletuksena päällä. Deploy-palvelin näyttää Ramsgaten ja Dojon ikkunat ja käynnistää
metsästyspalvelimet ikkuna piilotettuna. **Konsoli-ikkunan sulkeminen lopettaa sen palvelimen**
kaikilta, jotka ovat siinä. Deploy-palvelin käynnistää Ramsgaten (ja Dojon) uudelleen heti, kun
pelaaja matkustaa sinne, tai sen vahtikoira (watchdog) tekee sen noin minuutissa. Metsästyspalvelinta
ei käynnistetä uudelleen. Jätä ikkunat auki
(pienennä ne). Palvelimen tulosteen kirjoittaminen lokitiedostoihin on
[tiekartalla]({{ roadmap_page.url | relative_url }}).

Ilmoitusikkuna, jossa lukee **”INVALID GAMESERVER ARGS”**, tarkoittaa, että pelipalvelin
käynnistettiin alle kahdeksalla parametrilla exe-tiedoston nimen jälkeen. Vertaa komentoasi käsin
ajettavaan palvelinkomentoon sivulla
[Pystytä palvelin, vaihe 11]({{ host_page.url | relative_url }}#deploy-server).

---

## Lokirivit, jotka näyttävät hälyttäviltä mutta ovat tuttuja {#log-lines-that-look-alarming-but-are-known}

Omasta metagamen lokistamme (1.4.4, yksi pelaaja, yksi ilta opetusjaksoa, Ramsgatea ja Dojoa):

| Rivi | Nähty | Mitä se on |
|---|---|---|
| `Unstubbed route POST /loadout/<account>/<character>/unlock/3` | yli 40 kertaa | Alkuperäisessä projektissa ei ole käsittelijää varustepaikan avaamiselle. Pelipalvelin (`gs=1`) lähettää sen uusintayritysten ryöppyinä, useita muutaman sekunnin sisällä ja sitten taas minuuttien päästä. Vaaraton. Käsitellään siitä lähtien, kun oikeasta etenemisestä tuli oletus (tiekartan kohta 2.4); matalan tason tili ei lähetä sitä lainkaan, joten näet rivin vain asetuksella `PROGRESSION_MODE=stub`. |
| `Failed to update characterId ... due to conflict` | 14 kertaa | Peliohjelma ja pelipalvelin tallentavat kumpikin hahmon versionumeroiden kanssa ja hylkäävät toistensa kirjoitukset. Joka kerta se osapuoli, jonka kirjoitus hylättiin (joskus peliohjelma, joskus pelipalvelin), luki hahmon uudelleen ja kirjoitti uudestaan noin sekunnin sisällä, joten viimeinen kirjoitus päätyi tietokantaan. Ei vielä todistettu häviöttömäksi tilanteessa, jossa molemmat muuttavat samaa arvoa samanaikaisesti; tiekartalla. |
| `Unstubbed route GET /friends/api/public/friends/<account>` ja `.../blocklist/<account>` | 2 kertaa kumpikin | Kaverilistaa ei silloin ollut; peli näytti ”0 ONLINE FRIENDS”. Fork vastaa nyt molempiin reitteihin (kaikki näkyvät yhä offline-tilassa). `MISC_ROUTES=0` palauttaa 404:n. |
| `Unstubbed route GET /account127.0.0.1:61000` | 2 kertaa | Yhdestä osoitteesta, jonka peliohjelma kokoaa DLL:n osoiteohituksesta, puuttuu `/`: metagamen osoite liimataan suoraan `/account`-osan perään (Harmonicin haara huomasi saman ja vastaa siihen tilitiedoilla). Pyynnössä ei ole tunnistetietoja. Metagame vastaa 404; mitään näkyvää ei hajoa. Oikea korjaus kuuluu palvelin-DLL:ään (tiekartan kohta 4.6). |
| `Game server on port 877x (pid ...) exited with code 0` (deploy-loki) | jokaisen metsästyksen jälkeen | Pelipalvelin päättyi normaalisti. Mikä tahansa muu koodi tai `on <signaali>` on varoitus, joka kannattaa katsoa. |
| `Unhandled progression request <METHOD> <polku> from a game server` | harvoin | Peli lähetti etenemispyynnön, johon mikään reitti ei vastaa (se saa silti 404). Kirjaa polku ylös: se voi olla reitti, jota emme ole vielä rakentaneet. |
| `Unstubbed route POST /candidate/player/alive`, `DELETE /candidate` | muutaman kerran | Matchmaking-jonon ylläpitokutsuja. Fork vastaa nyt kutsuun `POST /candidate/player/alive` (`MISC_ROUTES=0` palauttaa 404:n). `DELETE /candidate` saa yhä tarkoituksella 404:n: peliohjelma lähettää sen heti jokaisen jonoon liittymisen jälkeen, ja metsästykset alkavat vain siksi, että se epäonnistuu. `MATCHMAKING_CANCEL=1` ottaa käsittelijän käyttöön kokeiluna. |
| `Unauthenticated POST to /heartbeat which needs metagame auth!` | kerran | Varhainen telemetrian elonmerkki (heartbeat), joka lähetetään kirjautumisen aikana ennen kuin istunto on valmis. Myöhemmät elonmerkit on tunnistettu. |
| `Running Gameserver Watchdog!` (deploy-loki) | 60 sekunnin välein | Normaalia. |
| `Cleaning up Gameserver on port 8775` (deploy-loki) | kun metsästys päättyy | Metsästyspalvelin sulkeutui, ja sen portti palasi vapaiden porttien joukkoon. |

---

## Escalationin, kaupan, Slayer Linksin ja deploy-palvelimen lokirivit {#log-lines-of-the-port}

Nämä tulivat Harmonicin forkin siirron mukana
([Harmonicin työn siirto]({{ '/fi/findings/harmonic-fork.html' | relative_url }})). Rivit ovat
metagamen lokista, ellei toisin mainita.

**Jokaisella käynnistyksellä**

| Rivi | Merkitys |
|:-----|:---------|
| `features: bodyLogPerPath=no-cap escalation=stub ...` | Jokaisen uuden kytkimen arvo. Tarkista se asetuksen muuttamisen jälkeen. |
| `Progression config: bundled, 10 tracks; active Hunt Pass season09b` | Käytössä olevat etenemisradat; asetuksella `PROGRESSION_CONFIG_DIR` myös, mitkä korvattiin tai lisättiin. |
| `The progression config could not be loaded: <syy>` (fatal) | Kausitiedosto tai `ACTIVE_HUNT_PASS` on väärin; metagame pysähtyy ennen kuin se avaa tietokannan. Korjaa syyssä nimetty tiedosto tai poista asetus. |
| `<NIMI>="<arvo>" is not a valid value; using the default (<oletus>)` | Kytkimellä on arvo, jota se ei ymmärrä; käytetään oletusta. |
| `Removed N expired store purchase token(s) that were never redeemed` | Kaupan tunnisteiden siivousta. |
| `Removed N store purchase receipt(s) redeemed more than 30 days ago` | Kaupan kuittien siivousta; annetut tavarat ja oikeudet säilyvät tavaralokissa ja oikeuksissa. |
| `Ramsgate and Dojo liveness check before handing them out: on` (deploy-loki) | `PERSISTENT_WORLD_LIVENESS` on päällä. |
| `Starting the game servers failed: <viesti>` (deploy-loki, fatal) | Ramsgatea ei saatu käyntiin palvelimen käynnistyessä (usein väärä `GAMESERVER_BINARY_PATH`). Deploy-palvelin jatkaa toimintaansa ja yrittää uudelleen seuraavalla Ramsgaten-matkalla; sen paluukoodi on 1, kun se päättyy. |

**Deploy-palvelin** (deploy-loki)

| Rivi | Merkitys |
|:-----|:---------|
| `Ramsgate is not running any more: starting it again before sending anyone there` | Pelaaja matkusti kaatuneeseen Ramsgateen; se käynnistetään ensin (Dojolle samoin). Pelaaja odottaa muutaman sekunnin pidempään. Jos tätä tapahtuu usein, selvitä, miksi Ramsgate kaatuu (suljettu konsoli-ikkuna, muisti). |
| `RAMSGATE HAS FALLEN! Restarting!` | Vahtikoira löysi Ramsgaten kaatuneena ja käynnisti sen (vain jos uudelleenkäynnistys ei ole jo käynnissä). |
| `Game server on port N failed: <virhe> (GAMESERVER_BINARY_PATH is <polku>)` | Peliä ei saatu käyntiin, yleensä väärän polun takia asetuksessa `GAMESERVER_BINARY_PATH`. |
| `Matchmaking for <tila> <metsästys> failed: <viesti>` | Pelipalvelinta ei saatu käyntiin (esimerkiksi `No free ports left!`); pelaajien haku epäonnistuu. |
| `Could not restart the game server on port N: <viesti>` | Vahtikoira ei saanut Ramsgatea tai Dojoa uudelleen käyntiin; seuraava matka sinne yrittää uudelleen. |

**Eteneminen**

| Rivi | Merkitys |
|:-----|:---------|
| `Progression grant for <tili> repeats the grant of N s ago: answered its stored reply, nothing added` | Pelipalvelin lähetti saman myönnön uudelleen alle `PROGRESSION_REPLAY_WINDOW_S` sekunnin kuluttua (uusinta). Tavallista heti verkkohäiriön jälkeen. Jos rivi näkyy usein tavallisessa pelaamisessa, aseta `PROGRESSION_REPLAY_WINDOW_S=0` ja ilmoita siitä. |
| `progression: objective went backwards: ...; stored as sent` | Tavoite saapui tallennettua pienempänä. Tallennettiin silti; kannattaa kirjata ylös, jos se toistuu. |
| `Game server <what> for <tili> carries the token of <toinen tili>: accepted for <tili>, ...` | Pelipalvelin kirjoitti yhden pelaajan puolesta toisen pelaajan tunnisteella. Kirjoitus pidetään osoitteen tilille. Odotettavissa silloin tällöin usean pelaajan metsästyksissä; ilmoita, jos se toistuu saman parin kohdalla. |
| `Balances of <tili> from the inventory of character <tunnus>: ...` | `/balance` tai `/reconcile` kertoi hahmon valuutat. |

**Escalation** (vain asetuksella `ESCALATION_MODE=real`)

| Rivi | Merkitys |
|:-----|:---------|
| `Escalation <kausi> for <tili>: vN level L xp X, ...` | Tallennus tallennettiin. |
| `Escalation <kausi> vN for <tili> replayed` | Sama tallennus saapui uudelleen; mikään ei muuttunut. |
| `Refusing escalation save of <kausi> for <tili> (<tila>): <syy>` | Tallennus rikkoi kovaa sääntöä. `first save carries the old stub values` tai `save over level N carries the old stub values` tarkoittaa, että pelipalvelimella oli yhä vanha tekaistu maksimi: käynnistä pelipalvelimet uudelleen. Satunnainen `stale snapshot` on harmiton. |
| `Escalation save of <kausi> for <tili> breaks a soft rule, stored anyway (ESCALATION_STRICT=0): ...` | Tallennettiin, mutta sääntömallimme voi olla väärä. Pidä `ESCALATION_STRICT` pois päältä ja ilmoita rivistä. |

**Kauppa** (vain asetuksella `STORE=free`)

| Rivi | Merkitys |
|:-----|:---------|
| `Store purchase token for <tarjous> issued to <tili> (character <tunnus>)` | Osta-painiketta painettiin. |
| `Store purchase <tarjous> for <tili> (character <tunnus>): N item(s), M entitlement(s)` | Osto meni läpi. |
| `Store purchase <tarjous> of <tili> was already redeemed; nothing granted again` | Toistettu vahvistus. Harmiton. |
| `Store <what> refused (<tila>): <viesti>` | Torjuttu pyyntö syineen (vanhentunut tunniste, muuttunut tarjous, tili ilman hahmoa, `You already own everything this offer grants`, `Too many purchases`: 60 tunnistetta 10 minuutissa). |
| `Store SKUs requested for unknown tag <tunniste>: an empty list` | Peli pyysi kaupan sivua, jolle meillä ei ole tarjouksia. |

**Slayer Links**

| Rivi | Merkitys |
|:-----|:---------|
| `slayerlink: invite by=<A> to=<B> slot=<n> -> sent id=<tunnus>` | Kutsu lähetettiin. |
| `slayerlink: accept by=<B> other=<A> id=<tunnus> -> accepted (slots X and Y)` | Linkki alkoi (`reject` ja `cancel` kirjataan samoin). |
| `slayerlink: ... refused <tila>: <syy>` | Torjuttu toiminto syineen (ei kavereita, paikka on varattu, kutsu on vanhentunut). `the slot must be 1 to 3` tarkoittaa, että asiakas lähetti paikan, jota 1.4.4-peliohjelmalla ei ole; `too many invites` tarkoittaa yli 20 uutta kutsua yhdeltä pelaajalta 10 minuutissa. |
| `slayerlink: delete link by=<A> ... -> removed <tunnus> (with <B>)` | Linkki päätettiin kummaltakin pelaajalta. |
| `friends: ... (N Slayer Link invite(s) between them cancelled)` | Kaveruuden purku tai esto perui myös odottavat kutsut. |

**Ryhmät ja istunnon tarkistus**

| Rivi | Merkitys |
|:-----|:---------|
| `party: accept by <A> id=<tunnus>: already in P=<ryhmä> size=<n>; answering that party (a repeated accept)` | Peli lähetti saman hyväksynnän kahdesti; se sai ryhmän uudelleen. |
| `GET /account/api/oauth/verify with a bad or expired token: answering the static reply` | Pelin säännöllinen istunnon tarkistus vanhentuneella tunnisteella, enintään kerran minuutissa. Odotettavissa yli 24 tunnin istunnoissa. Jos pelaajat kirjautuvat ulos tai jäävät yhteyssilmukkaan, aseta `VERIFY_STUB_ACCOUNT=1`. |

---

## Kirjautuminen ei etene aloitusruudulta {#login-doesnt-get-past-the-title-screen}

Lue metagamen lokia siitä hetkestä alkaen, kun käynnistit pelin:

- **Riviä `POST /account/api/oauth/token` ei ole lainkaan.** Peliohjelma ei tavoita metagamea.
  Tarkista, että:
  - "Näytä lokiruutu" käytössä, peliohjelman konsoli-ikkuna ilmestyi (jos ei, DLL-tiedostot puuttuvat `Win64`-kansiosta tai eivät
    lataudu);
  - ensimmäinen käynnistysparametri on `127.0.0.1:61000`;
  - metagame kuuntelee (`curl.exe -s -m 5 http://127.0.0.1:61000/dauntless-status`).
- **`Invalid API key auth!`** Parametrina `-AUTH_PASSWORD` annettu avain ei vastaa yhtään tiliä.
  Tarkista `C:\dr\data\owner.key` ja varmista, että käytät oikeaa tietokantatiedostoa (`DB_FILENAME`).
  Palvelin tallentaa jokaisesta avaimesta vain tiivisteen, joten kadonnutta avainta ei voi palauttaa;
  työkalu uuden avaimen antamiseen on tiekartalla.
- **Kirjautuminen toimii, mutta mikään ei lataudu matchmakingin jälkeen.** Etsi `gs=1`-rivejä. Jos
  niitä ei ole, pelipalvelin ei tavoita metagamea:
  - `Game.ini` puuttuu tai on väärä (aja vaiheen 8 kuntotarkistus), tai
  - pelipalvelinavainta ei rekisteröity (metagamen on täytynyt kirjata kerran
    `Registered 1 new Gameserver API Key(s) on boot!`), tai
  - deploy-palvelimen `.env`-tiedoston `METAGAME_API_KEY` eroaa `gameserver.key`-tiedostosta.

---

## Chat sanoo ”Unable to send message”, tai mitään ei tule perille {#chat-not-connected}

Chat on metagamen oma kuuntelija, joka on pois päältä, ellei `CHAT=1`
([Tekstichat]({{ chat_page.url | relative_url }}), [Asetukset]({{ config_page.url | relative_url }}#metagame-chat)).
Metagamen lokissa yksi yhteys näyttää tältä:

```text
chat: listening on 127.0.0.1:61099 (nick check enforce)        käynnistyksessä
chat: connect c=3 from=203.0.113.7 via=gateway
chat: login ok c=3 uid=UID-...
chat: bound c=3 uid=UID-... resource=V2:...:WIN::... domain=prod.ol.epicgames.com sessions=1
chat: join room=City-... uid=UID-... name=<käyttäjänimi> occupants=0
chat: message room=City-... uid=UID-... len=5 to=1
```

- **Ei riviä `chat: listening`:** chat on pois päältä (`CHAT` ei ole `1`) tai ei käynnistynyt; katso
  [Chat-kuuntelija ei käynnisty](#chat-not-started). Paketin palvelimella `Stack.ps1 status` näyttää
  `chat`-rivin.
- **Ei riviä `chat: connect`:** peli ei koskaan tavoittanut kuuntelijaa. Julkisessa tilassa
  yhdyskäytävän lokissa on sille `ws`-reitti; 502 siellä tarkoittaa, ettei metagame kuuntele. Yhdellä
  koneella tarkista, että `Engine.ini` ohjaa chatin osoitteeseen `ws://127.0.0.1:61099`
  ([Portit ja verkko]({{ ports_page.url | relative_url }}#chat-port)).
- **`chat: login refused ... reason=...`:** `expired` tarkoittaa, että pelaajan 24 tunnin istunto on
  päättynyt (käynnistä peli uudelleen); `uid-mismatch`, `bad-token` ja `no-account` tarkoittavat, ettei
  kirjautuminen kuulu olemassa olevalle tilille; `throttled` tarkoittaa, että tiliä tai osoitetta
  pidätetään hetken toistuvien epäonnistumisten, korvatun tai väärinkäyttävän yhteyden tai
  sitoutumatta jääneiden kirjautumisten jälkeen (se poistuu itsestään 60 sekunnissa, osoitteelta 10
  minuutissa). Peli yrittää uudelleen 15-45 sekunnin välein. Miksi yhteys päättyi, kertoo sen
  [`closed`-rivi](#chat-closed).
- `MUC: JoinPublicRoom failed. Not currently connected` pelin konsolissa tarkoittaa vain, ettei
  chat-yhteys ollut sillä hetkellä kirjautuneena; peli liittyy uudelleen, kun se on. Tällä ei ole
  mitään tekemistä nimien kanssa.

Matchmaking-asetusten muuttaminen ei korjaa chat-ongelmaa, ja 61099:n on pysyttävä paikallisena: älä
koskaan avaa sitä palomuurista.

### Nimet näkyvät muodossa `UID-...` tai ”[unknown]” {#chat-uid-names}

Palvelimella on chat-versio ajalta ennen käyttäjänimien korjausta (pull requestin #9 ensimmäinen
kokeiluversio). Päivitä palvelin. Nykyisellä versiolla peli näyttää käyttäjänimet: se lukee ne
nimimerkistä, jolla se liittyi huoneeseen, ja palvelin pitää nimimerkin muuttamattomana. Miksi vanha
versio näytti `UID-...`: [Tekstichat]({{ chat_page.url | relative_url }}#why-uid).

Jos yhden pelaajan rivit muuttuivat muille muotoon `[unknown]` heti sen jälkeen, kun hänen pelinsä
yhdisti uudelleen, palvelin on vanhempi kuin uudelleenyhdistämisen korjaus: vanha yhteys jäi
huoneeseen, ja sen myöhempi poistuminen poisti pelaajan muiden jäsenluettelosta. Päivitä palvelin;
siihen asti pelaaja poistuu huoneesta ja liittyy uudelleen (ryhmächatissa: lähtee ryhmästä ja liittyy
takaisin). Nykyisellä versiolla lokissa on `chat: leave room=... reason=replaced` juuri ennen uuden
yhteyden liittymistä ([miksi]({{ chat_page.url | relative_url }}#rooms)).

### ”Another operation already pending” {#chat-operation-pending}

Peli odottaa omaa huoneen läsnäolotietoaan liittymisen tai poistumisen päättämiseksi, ja siihen asti se
kieltäytyy uudesta liittymisestä samaan huoneeseen. Nykyinen palvelin lähettää sen aina tai hylkää
liittymisen suoraan, minkä peli käsittelee siististi. Jos näet tämän nykyisellä versiolla, kytke
`CHAT_TRACE=1`, käynnistä uudelleen, kun kukaan ei pelaa, toista tilanne kerran ja tallenna huoneen
`chat: trace` -rivit (niissä ei ole viestien tekstiä eikä tunnisteita). Kytke jäljitys sitten pois.

### `chat: join refused ... reason=...` {#chat-join-refused}

| Syy | Merkitys | Mitä tehdä |
|:----|:---------|:-----------|
| `not-member` | `Party-`- tai `Guild-`-huone ryhmästä tai killasta, johon pelaaja ei kuulu. Metagamen uudelleenkäynnistyksen jälkeen ryhmät ovat poissa, joten pelin ensimmäinen liittyminen vanhaan ryhmähuoneeseen hylätään; se siirtyy uuteen ryhmäänsä seuraavalla ryhmäkyselyllä. | Ei mitään, ellei se toistu pelaajalle, joka todella on siinä ryhmässä. |
| `not-allowed` | Huoneen nimi, jota peli ei koskaan rakenna, tai eri verkkotunnus. | Ei mitään: ei oikea peliohjelma. |
| `nick-name` | Nimimerkin nimiosa ei ole tilin käyttäjänimi. Heti kun ylläpitäjä on vaihtanut pelaajan nimen, peli käyttää vielä vanhaa nimeä. | Pelaaja käynnistää pelin uudelleen. |
| `nick-resource`, `nick-format` | Nimimerkissä ei ole pelaajan omaa resurssia, tai siinä on merkkejä, joita peli ei koskaan kirjoita. | Oikean peliohjelman ei pitäisi koskaan saada näitä. Jos saa, aseta `CHAT_NICK_CHECK=log` tiedostoon `metagame.env`, käynnistä uudelleen, kun kukaan ei pelaa, ja raportoi rivi. |
| `nick-account` | Nimimerkissä ei ole pelaajan omaa tilitunnusta, tai siinä on toisen tilin tunnus. | Oikea peliohjelma ei koskaan saa tätä: se rakentaa nimimerkin omasta tunnuksestaan. Se hylätään myös asetuksella `CHAT_NICK_CHECK=log`. |
| `conflict` | Toisen tilin yhteys pitää samaa nimimerkkiä. | Ei pitäisi koskaan tapahtua: nimimerkissä on oma tilitunnus, ja saman tilin uusi yhteys ottaa huoneen vanhalta. |
| `limit` | Liikaa huoneita, pelaajia huoneessa tai liittymisiä lyhyessä ajassa. | Ei mitään, ellei se toistu. |

Hylkäys kirjataan enintään kerran yhteyttä, huonetyyppiä (`City-` ja `Hunt-`, `General`, `Party-`,
`Guild-`, kaikki muu) ja syytä kohden 10 minuutissa, huoneen nimi 80 merkkiin katkaistuna. Jokainen
hylkäys lasketaan pudotusten rajaan, joten peliohjelma, joka lähettää jatkuvasti hylättyjä
liittymisiä, katkaistaan.

### `chat: closed ... reason=...` {#chat-closed}

| Syy | Merkitys | Seuraava kirjautuminen odottaa 60 s |
|:----|:---------|:------------------------------------|
| `close` | Peli kirjautui ulos (lopetus tai sen oma uudelleenyhdistäminen). | ei |
| `socket` | Yhteys katkesi. | ei |
| `ping-timeout` | Pingiin ei vastattu 100 sekunnissa (tai 10 sekunnissa vanhemmalla yhteydellä, kun sama tili yhdisti uudelleen: jäljelle jäänyt yhteys). | ei |
| `replaced` | Saman tilin uudempi yhteys tuli sen tilalle. | kyllä, jos se oli sitoutunut |
| `timeout` | Ei kirjautumista 15 sekunnissa tai ei sitoutumista 10 sekunnissa kirjautumisesta. | kolmen 10 minuutin sisällä jääneen sitoutumisen jälkeen |
| `refused` | Hylätty kirjautuminen tai liian monta kehystä ennen kirjautumista. | ei (epäonnistuneet kirjautumiset lasketaan osoitteen rajaan) |
| `size` | Yli 32 KiB:n kehys. | kyllä |
| `backlog` | Peli lakkasi lukemasta: 256 KiB odotti lähtemättä. | kyllä |
| `abuse` | Yli 100 pudotettua viestiä tai hylättyä liittymistä minuutissa. | kyllä |
| `shutdown` | Metagame pysähtyi. | ei |

### `name=InvalidMCPUser` liittymisrivillä {#chat-invalid-mcp-user}

Pelin oma tilihaku kirjautuessa epäonnistui, joten sen nimi on varanimi `InvalidMCPUser`. Muut pelaajat
näkevät silti oikean käyttäjänimen (he hakevat sen), mutta ”liittyi huoneeseen” -ilmoitus voi näyttää
varanimen. Etsi pelaajan kirjautumisen kohdalta rivi `EOS Account Info for <tunnus> by <tunnus>: found`;
jos se puuttuu tai sanoo `unknown`, peli ei saanut omia tilitietojaan. Pelin uudelleenkäynnistys
yleensä korjaa sen.

### Kuiskaukset eivät näy {#chat-whispers}

Kuiskaus näytetään, kun peli on hakenut lähettäjän nimen reitiltä
`GET /account/api/public/account?accountId=...`; metagame kirjaa rivin
`Account info for 1 account(s) by userId ...`. Chat-rivi
`chat: whisper from=... to=... ... reason=offline` tarkoittaa, ettei toinen pelaaja ollut yhteydessä
chattiin, ja `reason=blocked`, että toinen heistä on estänyt toisen. Kummassakaan tapauksessa
lähettäjälle ei lähetetä mitään takaisin.

### Ramsgaten chat tavoittaa vain ryhmäsi {#chat-ramsgate-party-only}

Toistaiseksi odotettua. Jokainen pelaaja saa oman Ramsgate-istunnon, ja Normal-kanava on
istuntokohtainen, joten kaksi pelaajaa jakaa sen vain, kun he matkustivat Ramsgateen yhdessä ryhmänä.
Käytä sillä välin ryhmächattia. Yhteinen Ramsgate-kanava on tiekartalla (3.10).

### Kavereiden paikalla olo (`chat: presence`) {#chat-presence}

Vain asetuksilla `CHAT=1` ja `CHAT_PRESENCE=1` ([miten se toimii]({{ chat_page.url | relative_url }}#presence)).

| Rivi | Merkitys |
|:-----|:---------|
| `chat: friends' online status off: no presence is sent outside rooms` | Oletus: kukaan ei näy paikalla. |
| `chat: friends' online status on (CHAT_PRESENCE=1): ...` | Päällä. |
| `chat: CHAT_PRESENCE is on but chat is off (CHAT=1 is needed); nobody shows as online` | Aseta myös `CHAT=1` tai poista `CHAT_PRESENCE`. |
| `chat: presence c=<tunnus> uid=<tili> online: told N friend session(s), heard of M` | Pelaajan peli lähetti ensimmäisen läsnäolotietonsa; N kaverille kerrottiin, ja pelaaja kuuli M:stä. |
| `chat: presence c=<tunnus> uid=<tili> offline (<syy>): told N friend session(s)` | Pelaaja poistui (`close`, `socket`, `ping-timeout`, `replaced`, `unavailable`, ...). `; c=<tunnus> is still online` tarkoittaa, että saman tilin toinen istunto on yhä paikalla. |
| `chat: presence: <A> and <B> are friends now: told N and M session(s)` | Hyväksytty kaveripyyntö lähetettiin chatin kautta. |
| `chat: presence: could not read the friends of <tili>; nothing relayed` | Tietokannan luku epäonnistui; pelaajan läsnäolotietoa ei välitetty tällä kertaa. |
| `chat: presence: refused to send c=<tunnus> a stanza from its own account` (virhe) | **Ei saa koskaan näkyä.** Palvelin pysäytti viestin, joka voisi herättää ryhmän automaattisen potkun. Kytke `CHAT_PRESENCE` pois, käynnistä metagame uudelleen ja ilmoita rivistä kellonaikoineen. |

Jos pelaaja potkitaan ryhmästä paikalla olon ollessa päällä (rivi `DELETE /party/member/...` heti sen
jälkeen, kun pelaaja näkyi muille poissa olevana), kytke `CHAT_PRESENCE` pois ja ilmoita siitä.

### Chat-kuuntelija ei käynnisty {#chat-not-started}

Metagame kirjoittaa yhden virherivin ja jatkaa ilman chattia:

- `chat: not started: could not listen on 127.0.0.1:61099 (EADDRINUSE)`: toinen ohjelma pitää porttia.
  Etsi se komennolla `Get-NetTCPConnection -LocalPort 61099 -State Listen` ja pysäytä se.
- `chat: not started: CHAT_BIND_HOST must be 127.0.0.1 in public mode`: korjaa `CHAT_BIND_HOST`
  (paketti kirjoittaa aina `127.0.0.1`).
- `chat: EXPERIMENTAL_CHAT is no longer read; the switch is now CHAT=1` (varoitus): nimeä rivi
  uudelleen.

---

## Vaihtaminen 2.1.1:n ja 1.4.4:n välillä {#switching-between-211-and-144}

Molemmat versiot käyttävät kansiota `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient`. Toisesta
versiosta jääneet asetukset vaikuttavat myös toiseen. Esimerkkejä ovat 2.1.1-kokeiluista jäänyt
`GameDefaultMap`-ohitus tai 1.4.4:n osoiteohitukset `Game.ini`-tiedostossa. Pidämme sen version
kansion, jota emme juuri käytä, uudelleennimettynä (`WindowsClient.211`) ja vaihdamme kansiot ennen
siirtymistä; katso [Pystytä palvelin, vaihe 6]({{ host_page.url | relative_url }}#config-folder). Älä
koskaan kopioi 1.4.4:n DLL-tiedostoja 2.1.1-asennukseen: niiden muistiosoitteet ovat vain 1.4.4:n
exe-tiedostoa varten.

---

## Ei vielä kohdattu, mutta tiedossa koodista {#not-hit-yet-but-known-from-the-code}

Nämä ovat peräisin koodin lukemisesta (ja ensimmäisen kohdalla lisäksi pienestä testistä), eivät
jostakin, mikä olisi mennyt meillä pieleen.

- **Jäljelle jäänyt käsin käynnistetty pelipalvelin.** Deploy-palvelimen käynnistämät palvelimet
  päättyvät sen mukana: se käyttää Noden oletusarvoista (ei irrotettua eli not detached)
  `spawn`-kutsua, ja Windowsissa Node laittaa tällaiset lapsiprosessit työobjektiin (job object), joka
  sulkeutuu Noden sulkeutuessa. Varmistimme sen testiprosessilla, emme pelipalvelimella. Käsin
  käynnistetty palvelin (vaiheen 11 käsin ajettava komento tai testiskriptimme) on tuon työobjektin
  ulkopuolella ja jää käyntiin. Sen jälkeen käynnistetty deploy-palvelin käynnistää heti uuden
  Ramsgaten UDP-porttiin 8777, jota vanha palvelin yhä pitää. Pysäytä ennen deploy-palvelimen
  käynnistämistä kaikki prosessit, joiden komentorivillä on `-server` (tarkistuslistan kohta 2 sivulla
  [Pystytä palvelin]({{ host_page.url | relative_url }}#checklist)).
- **Metsästyspalvelin, joka sulkeutuu ennen kuin hidas pelaaja saapuu.** Porttien 8776 alapuolella
  palvelin-DLL sulkee palvelimen, kun siihen ei ole ollut kukaan yhteydessä yhteensä 50 sekuntiin.
  Pelaaja, jonka kentän lataus kestää kauemmin, voi saapua vasta, kun palvelin on jo poissa.
  Säädettävä tyhjäkäyntiaikaraja on [tiekartalla]({{ roadmap_page.url | relative_url }}).
- **Tallennukset epäonnistuvat hyvin pitkissä pelikerroissa.** Kirjautumistunnisteet vanhenevat 24
  tunnissa. Pelipalvelimen tallennukset kantavat pelaajan tunnistetta, eikä metagamen tarkistuksessa
  ole virheenkäsittelyä vanhentuneelle tunnisteelle, joten 24 tunnin jälkeen nuo tallennukset
  epäonnistuvat palvelinvirheeseen. Kunnes tämä korjataan, sulje peli vähintään kerran päivässä.
  Uusiiko peliohjelma koskaan tunnistettaan itse, on vielä testaamatta.
- **Metsästysportit loppuvat.** Oletusalueella kuusi metsästystä voi olla käynnissä kerralla.
  Seitsemäs pyyntö epäonnistuu deploy-palvelimen sisällä (`Matchmaking for ... failed: No free ports
  left!`, HTTP 500 `{"error": "no_game_server"}` metagamelle). Metagame kirjaa `DeployServer returned status 500` ja merkitsee sen ryhmän haun
  epäonnistuneeksi: pelin tilakysely vastaa `FAILED`. (Alkuperäinen metagame antoi ryhmälle sen sijaan
  tyhjän osoitteen ja portin 0.) Tiekartalla on yhdessä muistisuojan kanssa muutos, jossa ryhmä odottaa,
  kunnes portti vapautuu.
