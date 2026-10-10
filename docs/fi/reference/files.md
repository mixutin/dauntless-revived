---
title: Tiedostot ja data
parent: Tekninen viite
grand_parent: Dauntless Revived suomeksi
nav_order: 4
description: "Missä Dauntless Revived pitää tiedostonsa: repositorio, käsin pystytetyn palvelinkoneen kansiot, palvelinpaketin asennuskansio, SQLite-tietokanta, lokit, varmuuskopiot ja käynnistin."
lang: fi
ref: reference/files
locale: fi_FI
---

{% assign config_page = site.pages | where: "path", "fi/reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "fi/reference/ports.md" | first %}
{% assign api_page = site.pages | where: "path", "fi/reference/api.md" | first %}
{% assign gamesettings_page = site.pages | where: "path", "fi/reference/game-settings.md" | first %}
{% assign scripts_page = site.pages | where: "path", "fi/reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "fi/reference/development.md" | first %}
{% assign host_page = site.pages | where: "path", "fi/setup/host.md" | first %}
{% assign admin_page = site.pages | where: "path", "fi/setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "fi/setup/windows-server.md" | first %}
{% assign friends_page = site.pages | where: "path", "fi/setup/friends.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "fi/setup/upgrading.md" | first %}
{% assign trouble_page = site.pages | where: "path", "fi/setup/troubleshooting.md" | first %}

# Tiedostot ja data
{: .no_toc }

Tälle sivulle on koottu, missä Dauntless Revivedin jokainen tiedosto on: repositorio ja mitä siitä
käännetään minnekin, kehityskoneen tai käsin pystytetyn palvelinkoneen kansiot, Windows-palvelinpaketin
asennuskansio ja se, kuka saa lukea ja kirjoittaa mitäkin kansiota, SQLite-tietokanta taulu taululta,
lokitiedostot ja niiden muodot, varmuuskopiot sekä se, mitä käynnistin säilyttää kaverin koneella.

Mitä asetustiedostoihin *kirjoitetaan*, kerrotaan sivulla [Asetukset]({{ config_page.url | relative_url }});
skriptit, jotka luovat ja käyttävät näitä tiedostoja, ovat sivulla
[Skriptit ja parametrit]({{ scripts_page.url | relative_url }}).

<details open markdown="block">
  <summary>Sisältö</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Salaisuuksia sisältävät tiedostot {#files-that-hold-secrets}

Jokainen tämän taulukon tiedosto on **salainen: älä koskaan jaa sitä, älä koskaan committoi sitä äläkä
koskaan liitä sen sisältöä issueen, chattiin tai kuvakaappaukseen.** Säilytä niistä kopioita vain
salatuissa varmuuskopioissa (tai pelaajan oman avaimen tapauksessa salasanojen hallinnassa).
Repositorion `.gitignore` pitää jo gitin ulkopuolella `.env`-tiedostot, `*.key`- ja `*.db`-tiedostot
(myös `-wal`- ja `-shm`-tiedostot) sekä juuren `data/`-kansion.

| Tiedosto | Missä | Mikä tekee siitä salaisen |
|:---------|:------|:--------------------------|
| Metagamen asetukset | `UndauntedMetagame\.env` (kehityskone tai käsin pystytetty palvelinkone); `C:\DauntlessRevived\data\config\metagame.env` (palvelinpaketti) | Yksityinen avain, jolla istuntotunnisteet allekirjoitetaan: sen haltija voi kirjautua sisään minä tahansa tilinä. Julkisessa tilassa myös yhdyskäytävän salaisuus. |
| Deploy-palvelimen asetukset | `UndauntedDeployServer\.env`; paketti: `data\config\deployserver.env` | Pelipalvelinavain. |
| Yhdyskäytävän ja sallittujen listan asetukset | `UndauntedGateway\.env` (kehityskone); paketti: `data\config\gateway.env`, `data\config\allowlist.env` | Yhdyskäytävän salaisuus ja sallittujen listan salaisuus. |
| `owner.key` | `C:\dr\data\owner.key` (käsin pystytetty palvelinkone); paketti: `data\keys\owner.key` | Ylläpitäjätilin avain. Se on sellaisen tilin salasana, joka voi luoda kutsuja ja käyttää jokaista ylläpitoreittiä. |
| `gameserver.key` | `C:\dr\data\gameserver.key`; paketti: `data\keys\gameserver.key` | Avain, jolla pelipalvelimet kirjoittavat tallennuksia, etenemistä ja palkintoja. |
| `gateway-key.pem` | paketti: `data\tls\gateway-key.pem` (julkinen tila) | Yhdyskäytävän varmenteen yksityinen avain. Jokainen kutsu on kiinnitetty tähän varmenteeseen. |
| SSH-avain palvelimelle | `C:\dr\data\ssh\dauntless_deploy` (`Deploy-Remote.ps1`:n oletus) | Ylläpitäjän SSH-pääsy vuokraamallesi palvelimelle. |
| Avaimenvaihdon tulos | `C:\dr\data\rekey-<UserId>.txt` | Pelaajan uusi tiliavain selväkielisenä. Poista tiedosto, kun olet antanut avaimen pelaajalle. |
| Varmuuskopiot | paketti: `C:\DauntlessRevived\backups\`; käsin pystytetty palvelinkone: missä ikinä niitä säilytätkin | Niissä on kaikki yllä luetellut sekä tietokanta. |
| Käynnistimen avaintiedostot | kaverin kone: `%APPDATA%\Dauntless Revived Launcher\keys\*.key` | Pelaajan tiliavain, salattuna kyseiselle Windows-käyttäjälle. |
| Avaimen varmuuskopio ja kaveripaketin avain | kaverin kone: tallennettu `Dauntless Revived key - <käyttäjänimi>.txt`; kaveripaketin `%APPDATA%\DauntlessRevived\account.key` | Pelaajan tiliavain selväkielisenä. |

Yksityisiä mutta eivät samalla tavalla salaisia ovat tietokanta (käyttäjänimet, tallennukset, avainten
SHA-256-tiivisteet ja hetken aikaa myös selväkieliset avaimet, katso [Tilit ja avaimet](#accounts-and-keys)),
`bodies.log` ja jokainen lokitiedosto (tilien tunnisteet, käyttäjänimet ja julkisessa tilassa pelaajien
IP-osoitteet). Paketin `server.json` ei sisällä salaisuuksia, mutta siihen on kirjattu osoitteet,
joilta sallit etätyöpöydän, joten älä julkaise sitäkään.

## Repositorio {#the-repository}

Repositorio on [Undauntedin](https://github.com/SyST3MDeV/Undaunted) fork, ja työhaara on
`dauntless-revived`. Osien kansiot ovat säilyttäneet alkuperäisen projektin `Undaunted...`-nimet;
niiden npm-pakettien nimet ovat muotoa `dauntless-revived-*` (esimerkiksi `dauntless-revived-metagame`).

| Kansio | Mitä siinä on | Käännöstulos (gitin ohittama) |
|:-------|:--------------|:------------------------------|
| `UndauntedMetagame/` | Taustapalvelu, jonka kanssa peli keskustelee (TypeScript, Express): tilit, tallennukset, eteneminen, matchmaking, ryhmät, kaverit, killat, `/undaunted/api`-ylläpitorajapinta ja pelin tekstichat (`src/realtime/`, XMPP-kuuntelija samassa prosessissa, päällä kun `CHAT=1`). `src/db/schema.ts` määrittelee tietokannan, `src/drizzle/` sisältää sen migraatiot ja `src/vendor/` pelin `progression_config.json`-tiedoston, generoidun `hunt_titles.json`-tiedoston sekä Harmonicin 1.4.4-forkin datan: `escalation/seasons.json` (Escalationin kausiluettelo), `store_catalog.json` (ilmaisen kaupan tarjoukset) ja `store_item_kinds.json` (miten kukin kaupan tavara annetaan). `test/data/store_art_skus.json` luettelee testiä varten kaupan tarjoustunnukset, joiden ruutukuva on 2:1. Käännös kopioi kansion `src/vendor/` kansioon `dist/vendor/`. Kansiossa `scripts/` ovat `write-build-info.js` ja `make-hunt-titles.js`. | `dist/` (jossa `dist/build-info.json`), `build/` (testit), `node_modules/` |
| `UndauntedDeployServer/` | Käynnistää ja valvoo pelipalvelinprosesseja (Ramsgate, Training Dojo, metsästykset). `src/vendor/` sisältää metsästystaulukot. | `dist/`, `build/` |
| `UndauntedGateway/` | Vain julkinen tila: TLS-yhdyskäytävä (`dist/server.js`) ja sallittujen listan apuri (`dist/allowlist/server.js`). `tools/make-cert.js` tekee yhdyskäytävän varmenteen. | `dist/`, `build/` |
| `UndauntedContent/` | Sisältöpalvelin: pelitiedostot, uutiset ja kuvapaketti rekisteröityneille käynnistimille. `data/dauntless-1.4.4.json` on pelin tiedostoluettelo (manifest, 410 tiedostoa), joka käännetään myös käynnistimen sisään. | `dist/`, `build/` |
| `UndauntedLauncher/` | Tämän forkin käynnistin kavereille (Electron). `assets/` sisältää kuvakkeet (kopiot kansiosta `brand/launcher/`) ja kaksi kiinnitettyä valmiiksi käännettyä DLL-tiedostoa, `dxgi.dll` ja `UndauntedInternalServer.dll`, jotka jokainen asennustapa asentaa (palvelinkone, palvelinpaketti, kaveripaketti ja käynnistin). Kansiossa `src/renderer/brand/` ovat kopiot ikkunassa näkyvistä logo- ja tunnuskuvista. Kansiossa `scripts/` ovat testien ajaja, brändikuvien kopioija (`make-icon.mjs`) ja `collect-release.ps1`. | `.vite/` (`npm start`), `out/` (`npm run package` ja `npm run make`), `.test-build/` (testit), `release/` (julkaisutiedostot, jotka `scripts/collect-release.ps1` kokoaa komennon `npm run make` jälkeen: asennusohjelma, Squirrelin päivitystiedostot, zip ja `SHA256SUMS.txt`). |
| `UndauntedInternalServer/` | Palvelin-DLL:n C++-lähdekoodi: Visual Studio -ratkaisu, `dllmain.cpp` (jossa on osoitetaulukko, josta `Game.ini` generoidaan), pelimoottorin otsaketiedostot kansiossa `SDK/` sekä `MinHook/`. Mikään tämän repositorion skripti tai työnkulku ei käännä sitä; kaikki käyttävät valmiiksi käännettyjä DLL-tiedostoja kansiosta `UndauntedLauncher/assets/`. MinHookin include-korjauksesta (syyskuu 2026) alkaen se kääntyy Visual Studio 2022 Build Toolsilla (Release, x64), mutta täällä käännettyä DLL:ää ei jaeta. | Visual Studion tuotokset (`x64/`, `*.dll` ja vastaavat) |
| `deploy/windows-server/` | Windows-palvelinpaketti: skriptit, `lib/` (Node-apurit `dr-db.js`, `dr-keys.js` ja `verify-game.js`) ja `tests/`. | ei mitään |
| `friend-kit/` | Kutsuttujen kavereiden asennus- ja pelaamisskriptit, vain Tailscalen kautta pelaamiseen. | `tools/make-friend-kit.ps1` rakentaa zip-tiedoston repositorion ulkopuolelle |
| `tools/` | `build-llms.js`, `sync-roadmap.js`, `make-friend-kit.ps1`, `make-game-manifest.js` sekä kansiossa `ci/` CI:n käyttämät `check-repo.js` (repositorion tarkistus) ja `launcher-version.js` (käynnistimen versiosäännöt). | ei mitään |
| `docs/` | Tämä sivusto (GitHub Pages, Jekyll). `docs/fi/` sisältää suomenkieliset sivut, `docs/_data/faq_en.yml` ja `faq_fi.yml` usein kysytyt kysymykset. | ei mitään |
| `.github/` | Issue- ja pull request -pohjat, jakokuvat (social images), `dependabot.yml` sekä työnkulut `workflows/ci.yml` ja `workflows/launcher-release.yml`. | ei mitään |

Juuressa ovat `README.md` ja `README.fi.md`, `ROADMAP.md` (päivittyvä tarkistuslista),
`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE.txt` (AGPL-3.0), `.gitignore` ja
`.gitattributes`. Paketin `*.ps1`-, `*.vbs`- ja `*.md`-tiedostot sekä kaveripaketin `*.ps1`- ja
`*.cmd`-tiedostot saavat aina CRLF-rivinvaihdot, jokaisessa checkoutissa ja myös `git archive`
-paketissa (sen `Deploy-Remote.ps1` lähettää palvelimelle).

`git pull` ei käännä mitään uudelleen: aja hakemisen jälkeen `npm run build` jokaisen käyttämäsi osan
kansiossa. Kunkin osan kääntäminen ja testaaminen neuvotaan sivulla [Kehittäjän opas]({{ dev_page.url | relative_url }}).

### Generoidut tiedostot {#generated-files}

Nämä tiedostot on committoitu, mutta ne tuottaa työkalu. Älä muokkaa niitä käsin, vaan muuta lähdettä
ja aja työkalu uudelleen.

| Tiedosto | Tekijä | Lähde | Aja uudelleen, kun |
|:---------|:-------|:------|:-------------------|
| `docs/roadmap.md` | `node tools/sync-roadmap.js` | `ROADMAP.md` | muutat `ROADMAP.md`-tiedostoa. Suomenkielinen `docs/fi/roadmap.md` on käsin kirjoitettu tiivistelmä, ei generoitu. |
| `docs/llms.txt`, `docs/llms-full.txt` | `node tools/build-llms.js` (`sync-roadmap.js`-ajon jälkeen) | Dokumentaatiosivujen front matter ja teksti sekä `docs/_data/faq_*.yml` | lisäät sivun, muutat otsikkoa tai kuvausta tai muutat englanninkielisen sivun tekstiä (`llms-full.txt` sisältää jokaisen englanninkielisen sivun kokonaan). |
| `UndauntedMetagame/src/vendor/hunt_titles.json` | `node scripts/make-hunt-titles.js` kansiossa `UndauntedMetagame` | Deploy-palvelimen `player_hunts_table.json` ja `matchmaker_hunts_table.json` | deploy-palvelimen metsästystaulukot muuttuvat. |
| `UndauntedContent/data/dauntless-1.4.4.json` | `node tools/make-game-manifest.js --zip <BaseGame144.zip>` | Tarkistettu pelin zip-tiedosto | käytännössä ei koskaan: versio on kiinnitetty. Jos se muuttuu, käännä myös käynnistin uudelleen, sillä sen sisään käännetään sama tiedosto. |
| `UndauntedMetagame/src/drizzle/*.sql` ja `meta/` | `npm run db:generate` kansiossa `UndauntedMetagame` | `src/db/schema.ts` | muutat skeemaa. Committoi uusi migraatio samaan committiin skeeman muutoksen kanssa. |

Myös `UndauntedMetagame/dist/build-info.json` on generoitu (`npm run build` kirjaa siihen commitin,
jonka perässä on `-dirty`, jos `UndauntedMetagame`-kansiossa on committoimattomia muutoksia, sekä
version ja käännösajan), mutta sitä ei committoida.

## Kehityskone tai käsin pystytetty palvelinkone {#a-developer-or-hand-built-host}

Asennusohjeet käyttävät lyhyitä polkuja kansion `C:\dr` alla ja alla olevaa rakennetta. Mikään ei
pakota näihin polkuihin: niitä käyttävät vain ohjeet ja muutaman skriptin oletusarvot.

| Polku | Mikä se on |
|:------|:-----------|
| `C:\dr\undaunted\` | Repositorion kopio ([Pystytä palvelin, vaihe 4]({{ host_page.url | relative_url }}#fork)). Asetukset ovat tiedostoissa `UndauntedMetagame\.env` ja `UndauntedDeployServer\.env`, jotka git ohittaa. **Salaisuuksia: älä koskaan jaa niitä äläkä committoi niitä.** Käynnistä jokainen palvelin sen oman kansion sisältä: metagame löytää migraationsa suhteellisella polulla `./src/drizzle`. |
| `C:\dr\data\` | Ajonaikainen data repositorion ulkopuolella: `undaunted.db` (`DB_FILENAME=C:/dr/data/undaunted.db`), `owner.key` ja `gameserver.key` (**salaisuuksia: älä koskaan jaa niitä äläkä committoi niitä**), lokit `metagame.log`, `metagame.err`, `deploy.log` ja `deploy.err` sekä pid-tiedostot `metagame.pid`, `deploy.pid` ja `client.pid`. Lokit korvautuvat jokaisella käynnistyksellä, koska ohje käynnistää palvelimet komennolla `Start-Process -RedirectStandardOutput`. |
| `C:\dr\data\rekey-<UserId>.txt` | Uusi tiliavain, jonka sivun [Palvelin ryhmälle]({{ admin_page.url | relative_url }}) avaimenvaihtoskripti on tehnyt. **Salaisuus**: anna se pelaajalle kahden kesken ja poista tiedosto sitten. |
| `C:\dr\data\ssh\` | `dauntless_deploy` (vuokrapalvelimen SSH-avain) ja `known_hosts`, `Deploy-Remote.ps1`:n oletukset. **Avain on salaisuus: älä koskaan jaa sitä äläkä committoi sitä.** |
| `C:\dr\backups\` | Tietokannan kopiot, jotka sivun [Palvelin ryhmälle]({{ admin_page.url | relative_url }}#back-up-the-database) varmuuskopioskripti ottaa käynnissä olevasta tietokannasta (`undaunted-YYYYMMDDHHMM.db`). |
| `C:\dr\tools\` | Palvelinkoneen omat apuskriptit, jotka ohjeet näyttävät kokonaan mutta joita ei ole repositoriossa: `make-gameini.ps1`, `play.ps1` ja meidän koneellamme `stack.ps1`. |
| `C:\D144\Dauntless\` | Tarkistettu 1.4.4-peli ja kaksi DLL-tiedostoa sen kansiossa `Archon\Binaries\Win64\` ([Pystytä palvelin, vaihe 3]({{ host_page.url | relative_url }}#short-install-path)). |
| `C:\dr\dist\` | Skriptin `tools\make-friend-kit.ps1` oletustulostekansio. |
| `C:\dr\sandbox-ws2019\` | Paketin `Test-Sandbox.ps1`-skriptin oletuskansio. |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | Tämän Windows-käyttäjän pelin käyttäjäasetukset: `Engine.ini`, `Game.ini` ja `GameUserSettings.ini`. Katso [Pelin asetukset]({{ gamesettings_page.url | relative_url }}). |

Kun `LOG_BODIES=1` on asetettu mutta `BODY_LOG_FILE` ei ole, metagame kirjoittaa `bodies.log`-tiedoston
työhakemistoonsa, joka on `C:\dr\undaunted\UndauntedMetagame`. **Mikään `.gitignore`-sääntö ei kata
tätä tiedostoa.** Aseta `BODY_LOG_FILE=C:/dr/data/bodies.log` tai poista tiedosto ennen kuin committoit.
Metagamen yksikkötestit käyttävät jokaiselle testitiedostolle uutta tietokantaa väliaikaisessa
`undaunted-test-*`-kansiossa ja poistavat sen lopuksi.

Kun yhdyskäytävä tai sallittujen listan apuri ajetaan repositorion kopiosta (`npm start`,
`npm run start:allowlist`), ne lukevat tiedoston `UndauntedGateway\.env`, jossa ovat yhdyskäytävän ja
sallittujen listan salaisuudet (**salaisuus: älä koskaan jaa sitä äläkä committoi sitä**; git ohittaa
sen). Ilman asetuksia `ALLOWLIST_AUDIT_LOG` ja `ALLOWLIST_STATE_FILE` apuri kirjoittaa tiedostot
`allowlist-audit.log` ja `allowlist-state.json` työhakemistoonsa; yhdyskäytävän `.gitignore` kattaa
molemmat. Sisältöpalvelimen `UndauntedContent\.env` ei sisällä salaisuuksia.

## Windows-palvelinpaketti: `C:\DauntlessRevived` {#kit-install-root}

Paketti asentaa kaiken yhden juurikansion alle. Se on `C:\DauntlessRevived`, ellei `-InstallRoot` määrää
toisin. Kansioon `<juuri>\bin` asennetut skriptit löytävät juuren itse (`bin`-kansion yläkansio, kun
siellä on `data\config\server.json`); muualta ajettuina ne käyttävät kansiota `C:\DauntlessRevived` tai
`-Root`-parametria. Asentaminen, päivittäminen ja poistaminen neuvotaan sivulla
[Windows-palvelin]({{ winserver_page.url | relative_url }}).

### Kuka saa lukea ja kirjoittaa mitäkin {#who-may-read-and-write-what}

Asennusohjelma korvaa koko hakemistopuun käyttöoikeudet: **Administrators-ryhmällä ja SYSTEM-tilillä on
täydet oikeudet, vähäoikeuksinen palvelutili `dauntless` saa taulukon mukaiset oikeudet, eikä millään
muulla tilillä (ei edes paikallisella Users-ryhmällä) ole mitään pääsyä.** Palvelutili ajaa
palvelinkokonaisuuden ja tunnin välein otettavan varmuuskopion; sallittujen listan apuri pyörii
SYSTEM-tilillä. Palvelutili voi lukea ajamansa koodin ja skriptit mutta ei voi muuttaa niitä, joten
murrettu pelipalvelin ei voi muuttaa sitä, mitä ylläpitäjä seuraavaksi ajaa.

| Polku | Mitä siinä on | `dauntless` saa | Kirjoittaja |
|:------|:--------------|:----------------|:------------|
| `C:\DauntlessRevived\` | Juuri. Kaikki sen alla perii sen käyttöoikeudet, ellei toisin mainita. | lukea | asennusohjelma |
| `bin\` | Kopio paketista: `*.ps1`, `*.vbs`, `*.md` ja `lib\*.js`. Ajastetut tehtävät ajavat täältä tiedostot `Stack.ps1` ja `backup-hidden.vbs`. | lukea | asennusohjelma; `Update-DauntlessServer.ps1` päivittää sen uudesta koodista |
| `app\` | Käännetty palvelinkoodi: repositorio ilman `.git`-kansiota, `node_modules`-kansioita, käännöstuloksia, `.env`-tiedostoja, avaimia, varmenteita, tietokantoja, lokeja, DLL:n pelimoottorin otsaketiedostoja ja MinHookia, minkä jälkeen `npm ci` ja `npm run build` ajetaan kansioissa UndauntedMetagame, UndauntedDeployServer, UndauntedContent ja UndauntedGateway. `app\VERSION.json` kirjaa commitin, refin, lähteen, lähdekoodin osoitteen ja asennusajan. Jokainen osa pyörii oma kansionsa työhakemistonaan. | lukea | asennusohjelma ja päivitysohjelma |
| `app.new\` | Keskeneräinen käännös. Jos jokin päivityksen vaihe epäonnistuu, uusi käännös jää tähän. | lukea | asennusohjelma ja päivitysohjelma |
| `app.prev\` | Edellinen käännös komentoa `Update-DauntlessServer.ps1 -Rollback` varten. | lukea | asennusohjelma ja päivitysohjelma |
| `app.failed\` | Käännös, joka ei läpäissyt päivitysohjelman toimintatarkistusta ja jonka päivitysohjelma perui automaattisesti. | lukea | päivitysohjelma |
| `app.rolledback\` | Käännös, josta palasit käsin `-Rollback`-valinnalla. | lukea | päivitysohjelma |
| `game\Dauntless\` | Tarkistettu 1.4.4-peli ja kaksi kiinnitettyä DLL-tiedostoa sen kansiossa `Archon\Binaries\Win64\`. Deploy-palvelin käynnistää pelipalvelimet siitä, ja sisältöpalvelin jakaa sen käynnistimille. Zip-tiedostoa purettaessa tiedostot menevät kansioon `<juuri>\game.partial\`, joka nimetään valmistuttuaan `game\`-kansioksi. `-GameDir`-parametrilla peli jää omaan kansioosi, joka säilyttää omat käyttöoikeutensa ja saa lisäksi lukuoikeuden `dauntless`-tilille. | lukea | asennusohjelma |
| `data\` | Kaikki, mikä muuttuu palvelimen pyöriessä (alla). | muokata | |
| `data\config\` | [`server.json`](#server-json) (paketin oma tila; ei salaisuuksia), `.env`-tiedostot `metagame.env`, `deployserver.env` ja `content.env`, julkisessa tilassa myös `gateway.env` ja `allowlist.env`, sekä käynnistimen uutiset sisältävä `news.json`, joka luodaan tyhjänä listana, jos se puuttuu, eikä sitä koskaan kirjoiteta yli. **`.env`-tiedostot `content.env`-tiedostoa lukuun ottamatta sisältävät salaisuuksia: älä koskaan jaa niitä äläkä committoi niitä.** | lukea (myös jokaista tiedostoa) | asennusohjelma; päivitysohjelma muuttaa vain commit-kentät ja `GIT_COMMIT`-arvon; `New-Invite.ps1 -SaveShareUrl` tallentaa Tailscalen jakolinkin |
| `data\config\allowlist.env` | Sallittujen listan apurin asetukset ja sallittujen listan salaisuus. | ei pääsyä | asennusohjelma |
| `data\keys\` | `owner.key` (ylläpitäjätilin avain) ja `gameserver.key` sekä muut varmuuskopiosta palautetut `*.key`-tiedostot. `signing.tmp` ja `tailscale-authkey.tmp` ovat olemassa vain asennusvaiheen ajan; jos asennus keskeytetään väkisin siinä kohdassa, poista ne. **Salaisuuksia: älä koskaan jaa niitä äläkä committoi niitä.** | lukea | asennusohjelma |
| `data\tls\` | Julkinen tila: `gateway-cert.pem` ja `gateway-key.pem` (avain on **salaisuus: älä koskaan jaa sitä äläkä committoi sitä**). `*.new`-tiedostot ovat olemassa vain uutta varmennetta tehtäessä. | lukea | asennusohjelma |
| `data\undaunted.db` | [Tietokanta](#the-database). | muokata | metagame |
| `data\logs\` | Osien lokit, `supervisor.log`, `bodies.log`, varmuuskopion tietokantaloki, `install\` (katso [Lokit](#logs)) ja `performance\`, [suorituskykyloki](#performance-log). | muokata | `Stack.ps1` (myös suorituskykyloki), varmuuskopio, asennusohjelma |
| `data\run\` | `<osa>.pid` metagamelle, sisältöpalvelimelle, deploy-palvelimelle ja yhdyskäytävälle sekä `stopped.flag`. Niin kauan kuin `stopped.flag` on olemassa (`Stack.ps1 stop` luo sen, `start` ja `restart` poistavat sen), palvelinkokonaisuuden valvoja ei käynnistä mitään uudelleen. | muokata | `Stack.ps1` |
| `data\branding\` | Kuvapaketti, jonka sisältöpalvelin antaa käynnistimille: kuvat ja valinnainen `branding.json` (katso [Uutiset ja kuvapaketti](#news-and-art-pack)). Tyhjä asennuksen jälkeen. | muokata | sinä |
| `data\allowlist\` | Julkinen tila: sallittujen listan apurin `audit.log`, `state.json` (osoitteet, jotka on tällä hetkellä päästetty sisään), `allowlist.pid`, apurin lokit ja sen valvojan `supervisor.log`. | lukea | sallittujen listan apuri (SYSTEM) |
| `data\sandbox-profile\` | Vain `-Sandbox`-valinnalla: palvelutilin profiilin korvike. | | asennusohjelma |
| `backups\` | Yksi kansio varmuuskopiota kohden ja `backup.log` (katso [Varmuuskopiot](#backups)). **Salaisuuksia: älä koskaan jaa niitä äläkä committoi niitä.** | muokata | varmuuskopioskripti |
| `downloads\` | Asennusohjelman lataamat tiedostot: Node.js-MSI, VC++- ja DirectX-ajonaikaiset kirjastot (ja `dxredist\`), yksityisessä tilassa Tailscale-MSI, lähdekoodin zip-tiedostot GitHubista (`source-<commit>.zip`, purettuna kansioon `source-<12 hex>\`), lähetetty lähdekoodin zip-tiedosto purettuna kansioon `source-upload\` sekä `-GameZipUrl`-parametrilla `BaseGame144.zip` (latauksen ajan `.partial`). | lukea | asennusohjelma ja päivitysohjelma |
| `staging\` | Mitä `Deploy-Remote.ps1` lähettää: `kit\` (paketti, josta se ajetaan), `source\source-<12 hex>.zip` (palvelinkoodi) ja `upload\` (pelin zip-tiedoston jatkettavissa oleva lähetys: `upload.json`, `partNNNNN`-tiedostot `.ok`-merkintöineen, jotka poistetaan sitä mukaa kuin osat yhdistetään, ja valmis `BaseGame144.zip` `.ok`-merkintöineen, joka jää korjauksia varten). | lukea | `Deploy-Remote.ps1`, SSH:lla ylläpitäjänä |
| `staging\restore\` | `-RestoreFrom`-valintaa varten lähetetty varmuuskopio. Lähetetty kopio poistetaan onnistuneen asennuksen jälkeen. **Sisältää avaimia niin kauan kuin se on siellä.** | ei pääsyä | `Deploy-Remote.ps1` |

`-Sandbox`-asennus antaa hiekkalaatikon käyttäjälle täydet oikeudet kaikkialla, jotta testi voi poistaa
kaiken.

### `server.json` {#server-json}

`data\config\server.json` on paketin oma tila: JSON-muotoinen, UTF-8 ilman BOM-merkkiä (byte order
mark). Asennusohjelma kirjoittaa sen kokonaan joka ajokerralla ja säilyttää arvot `InstalledAt`,
`FirewallChanges`, `ServiceUser` ja `PerformanceLog` sekä Tailscalen jakolinkin; päivitysohjelma muuttaa vain arvot
`Commit`, `Ref`, `Source` ja `UpdatedAt`, ja `New-Invite.ps1 -SaveShareUrl` vain arvon
`TailscaleShareUrl`. Muut skriptit lukevat sitä, ja puuttuva tai tyhjä arvo tarkoittaa ”käytä koodin
oletusta”. Siinä ei ole salaisuuksia, mutta `AdminIp` sisältää oman
osoitteesi. Osien omat asetukset ovat `.env`-tiedostoissa; katso
[Asetukset]({{ config_page.url | relative_url }}).

| Avain | Mitä siinä on | Lukijat |
|:------|:--------------|:--------|
| `Version` | `2`. | ei vielä mikään |
| `Mode` | `Public` tai `Private`. Julkista tilaa vanhempi asennus, jossa ei ole `Mode`-arvoa, lasketaan `Private`-tilaksi. | `Stack.ps1`, `New-Invite.ps1`, päivitysohjelma, `Get-ServerStatus.ps1`, `Deploy-Remote.ps1`, asennusohjelman uudelleenajot |
| `ServerName` | Nimi kutsuissa ja tilatulosteessa. | `New-Invite.ps1`, `Stack.ps1`, `Deploy-Remote.ps1` |
| `Sandbox` | `true` `-Sandbox`-testiasennuksessa. | `Stack.ps1`, `Update-DauntlessServer.ps1`, `New-Invite.ps1` |
| `BindAddress` | Osoite, jossa metagame ja sisältöpalvelin kuuntelevat: julkisessa tilassa `127.0.0.1`, yksityisessä tilassa Tailscale-IPv4-osoite. | `Stack.ps1`, `New-Invite.ps1`, päivitysohjelma, `Get-ServerStatus.ps1` |
| `PublicHost` | Julkinen tila: kutsuissa oleva osoite. Tyhjä yksityisessä tilassa. | `New-Invite.ps1`, `Stack.ps1` (tilatuloste), `Deploy-Remote.ps1`, asennusohjelman uudelleenajot |
| `PublicIp` | Julkinen tila: osoitteen `PublicHost` IPv4-osoite. Tyhjä yksityisessä tilassa. | ei mikään (tiedoksi) |
| `GatewayBind` | Yhdyskäytävän kuunteluosoite: `0.0.0.0` (hiekkalaatikossa `127.0.0.1`). Tyhjä yksityisessä tilassa. | `Stack.ps1` |
| `CertFingerprint` | Yhdyskäytävän varmenteen SHA-256, 64 heksamerkkiä. Se on jokaisessa kutsussa, joten se on julkinen. | `New-Invite.ps1`, `Stack.ps1`, päivitysohjelma, `Get-ServerStatus.ps1` |
| `AdminIp` | Osoitteet, joilta etätyöpöytä sallitaan. | asennusohjelman uudelleenajot |
| `AdvertiseHost`, `TailscaleShareUrl` | Yksityinen tila: kutsuissa oleva palvelimen nimi ja jakolinkki, joka kulkee v1-kutsuissa. | `New-Invite.ps1`; `AdvertiseHost` myös asennusohjelman uudelleenajot |
| `MagicDnsName` | Yksityinen tila: palvelimen Tailscale-DNS-nimi. Kutsut käyttävät sitä vain, jos kirjoitat sen arvoksi `AdvertiseHost` (tai annat parametrin `-AdvertiseHost`). | ei mikään (tiedoksi) |
| `Ports` | Metagamen, deploy-palvelimen, sisältöpalvelimen, yhdyskäytävän ja sallittujen listan apurin TCP-portit. Ensimmäisen asennuksen jälkeen portit tulevat täältä; katso [Portit ja verkko]({{ ports_page.url | relative_url }}). | `Stack.ps1`, `New-Invite.ps1`, päivitysohjelma, `Get-ServerStatus.ps1`, `Deploy-Remote.ps1`, asennusohjelman uudelleenajot |
| `UdpPortBegin`, `UdpPortEnd` | Pelipalvelinten UDP-alue, aina 8770-8777. `Stack.ps1` olettaa Ramsgaten olevan portissa `UdpPortEnd` ja Dojon yhtä porttia alempana. | `Stack.ps1` (vain `UdpPortEnd`; `UdpPortBegin`-arvoa ei lue mikään) |
| `Components` | Osat, joita tämä asennus ajaa: julkisessa tilassa `allowlist` ja `gateway`, `metagame`, `content`, jos se käännettiin, ja `deploy` muualla kuin hiekkalaatikossa. Jos arvo puuttuu: metagame, content ja deploy. | `Stack.ps1`, päivitysohjelma |
| `AllowlistDryRun` | `true`: sallittujen listan apuri vain kirjaa lokiin palomuurimuutokset, jotka se tekisi. | `Stack.ps1` |
| `GameDir` | Pelikansio, se jossa `Archon\` on. | `Stack.ps1`, päivitysohjelma, asennusohjelman uudelleenajot |
| `NodePath` | `node.exe`, joka ajaa kaiken. | `Stack.ps1`, päivitysohjelma, varmuuskopio |
| `ServiceUser` | Palvelutili (`dauntless`; hiekkalaatikossa tyhjä). | `Stack.ps1`, asennusohjelma |
| `ServiceProfile` | Palvelutilin profiilikansio, jonka alla sen `Game.ini` ja `Engine.ini` ovat. | ei mikään (tiedoksi) |
| `InteractiveSession` | Käytettiinkö `-InteractiveSession`-valintaa. | `Stack.ps1`, vihjettä varten |
| `PerformanceLog` | `true` (oletus, myös kun arvo puuttuu): kokonaisuuden valvoja kirjoittaa [suorituskykylokia](#performance-log) minuutin välein. `false` laittaa sen pois seuraavasta `Stack.ps1 restart` -komennosta alkaen. Asennusohjelman uusi ajo säilyttää arvosi. | `Stack.ps1` |
| `StackTask`, `AllowlistTask`, `BackupTask` | Ajastettujen tehtävien nimet (`AllowlistTask` on yksityisessä tilassa tyhjä). | `Stack.ps1` |
| `Source`, `Ref`, `Commit`, `SourceUrl` | Mistä käynnissä oleva koodi tuli. | päivitysohjelma, `Stack.ps1`, `Deploy-Remote.ps1` |
| `FirewallChanges` | Jokainen asennusohjelman tekemä järjestelmän palomuurimuutos vanhoine arvoineen, jotta voit perua ne käsin, kun poistat asennuksen. | asennusohjelma |
| `Root`, `InstalledAt`, `UpdatedAt` | Asennuskansio ja kaksi aikaleimaa, tiedoksi. | ei mikään |

### Uutiset ja kuvapaketti {#news-and-art-pack}

Sisältöpalvelin antaa molemmat käynnistimelle ja lukee ne uudelleen pyöriessään, joten
uudelleenkäynnistystä ei tarvita. Se jakaa ne kysymättä tiliavainta (vain pelitiedostot vaativat
avaimen), joten pidä molempia julkisina: julkisessa tilassa kuka tahansa internetissä voi lukea ne
yhdyskäytävän kautta. Paketin palvelimella ne ovat tiedostossa `data\config\news.json` ja kansiossa
`data\branding\`, muualla siellä, mihin `CONTENT_NEWS_FILE` ja `CONTENT_BRANDING_DIR` osoittavat
([Asetukset]({{ config_page.url | relative_url }}#content-server)).

- **Uutiset** (`news.json`, muutokset tarkistetaan enintään 5 sekunnin välein): `{ "items": [ { "date":
  "2026-09-21", "title": "...", "body": "..." } ] }` tai pelkkä lista. Jokaisella uutisella on oltava
  päivämäärä ja otsikko; leipäteksti (`body`) on pelkkää tekstiä ja säilyttää rivinvaihtonsa. Uutiset
  jaetaan uusin ensin, ja niistä jaetaan vain 50 uusinta; otsikot katkaistaan 200 merkin ja leipätekstit
  10 000 merkin kohdalta, eikä yli 1 Mt:n tiedostoa lueta. Jos muokkaus rikkoo tiedoston, viimeisin
  toimiva versio jaetaan edelleen ja lokiin kirjataan varoitus.
- **Kuvapaketti** (kansio, joka käydään läpi uudelleen enintään 10 sekunnin välein): `.jpg`-, `.jpeg`-,
  `.png`- tai `.webp`-kuvat, joiden ensimmäiset tavut vastaavat tiedostopäätettä (nimi alkaa kirjaimella
  tai numerolla, ja siinä on vain kirjaimia, numeroita, `_`, `-` ja pisteitä, enintään 100 merkkiä;
  kukin kuva enintään 25 Mt) ja valinnaisesti `branding.json`: `{ "accent": "#c8a24a", "backgrounds":
  [ { "file": "harbour-dusk.jpg", "credit": "..." }, "second-image.webp" ] }`. Ilman
  `backgrounds`-kenttää käytetään kansion jokaista kuvaa nimijärjestyksessä. Palvelin tarjoaa enintään
  50 kuvaa; käynnistin näyttää niistä 8 ensimmäistä, kunkin enintään 15 MiB, ja käyttää korostusväriä
  vain kuusinumeroisessa muodossa `#rrggbb`. Repositoriossa ei ole kuvapakettia: ilman sitä käynnistin
  näyttää oman taustansa, logon tyyliin piirretyn yömaiseman.

Juuren ulkopuolelle paketti kirjoittaa lisäksi:

- palvelutilin pelin asetukset, `Game.ini` ja `Engine.ini`, kansioon
  `<dauntless-tilin profiili>\AppData\Local\Archon\Saved\Config\WindowsClient\` (profiilin polku on
  `server.json`-tiedoston `ServiceProfile`); katso [Pelin asetukset]({{ gamesettings_page.url | relative_url }});
- Node.js:n (kiinnitetty MSI) sen oletuskansioon, joka kirjataan `server.json`-tiedostoon arvoksi `NodePath`;
- ajastetut tehtävät, palomuurisäännöt ja muutaman järjestelmäasetuksen, jotka on lueteltu sivuilla
  [Skriptit ja parametrit]({{ scripts_page.url | relative_url }}) ja
  [Portit ja verkko]({{ ports_page.url | relative_url }}).

## Tietokanta {#the-database}

Kaikki pysyvä on yhdessä SQLite-tiedostossa, metagamen `DB_FILENAME`-asetuksen osoittamassa:

| Kokoonpano | Tiedosto |
|:-----------|:---------|
| Käsin pystytetty palvelinkone (ohjeiden mukaan) | `C:\dr\data\undaunted.db`, asetettuna `DB_FILENAME=C:/dr/data/undaunted.db` |
| Windows-palvelinpaketti | `C:\DauntlessRevived\data\undaunted.db` |
| `DB_FILENAME` puuttuu tai on tyhjä | Väliaikainen tietokanta, joka **poistetaan, kun metagame sulkeutuu**: jokainen tili ja tallennus menetetään. |
| Suhteellinen polku | Tulkitaan suhteessa metagamen työhakemistoon. Kansion on oltava olemassa. |

Tiedosto käyttää SQLiten oletusarvoista rollback journal -lokia, joten pysäytetty metagame jättää
jälkeensä yhden itsenäisen `undaunted.db`-tiedoston (`undaunted.db-journal` ilmestyy vain kirjoituksen
ajaksi). Asetuksella `DB_WAL=1` se käyttää sen sijaan WAL-tilaa, jolloin tuoreet kirjoitukset voivat
olla sen vieressä tiedostossa `undaunted.db-wal`; pelkkä pysäytetyn tiedoston kopio jää silloin niistä
paitsi. WAL-tilaan jäänyt tiedosto palautetaan tavalliseen tilaan seuraavassa käynnistyksessä, jos
`DB_WAL=1` ei ole asetettu. [Asetukset]({{ config_page.url | relative_url }}) selittää molemmat asetukset.

### Migraatiot {#migrations}

Metagame ajaa jokaisella käynnistyksellä kaikki odottavat migraatiot kansiosta `src/drizzle/`, ennen
kuin se vastaa mihinkään. Polku on suhteellinen sen työhakemistoon, joten käynnistä se
`UndauntedMetagame`-kansiosta (paketti tekee niin). Kaikki odottavat migraatiot ajetaan yhdessä
transaktiossa: jos yksi epäonnistuu, yhtäkään ei tehdä eikä metagame käynnisty. drizzle kirjaa
ajamansa migraatiot omaan tauluunsa `__drizzle_migrations`; älä koskaan muokkaa sitä, koska drizzle
päättää sen perusteella, mitkä migraatiot on vielä ajettava. **Metagame ei ota varmuuskopiota ennen
migraatioita.** Paketti ottaa varmuuskopion ennen jokaista käynnistystä ja jokaista päivitystä; käsin
pystytetyllä palvelinkoneella ota varmuuskopio itse ennen kuin haet uutta koodia.

| Migraatio | Mitä se tekee |
|:----------|:--------------|
| `0000_natural_korg` | Luo taulut `users`, `characters` ja `inventories`. |
| `0001_slow_storm` | Luo taulun `loadouts`. |
| `0002_gorgeous_saracen` | Luo taulut `gameserverapikeys` ja `gameserverapikeystoregister`. |
| `0003_slippery_blackheart` | Luo taulun `breadcrumbs`. |
| `0004_silky_lady_mastermind` | Lisää sarakkeen `loadouts.persistent`. |
| `0005_mighty_zeigeist` | Luo taulun `encounteredcontent`. |
| `0006_woozy_slipstream` | Luo taulut `userapikeys` ja `userapikeystoregister`. |
| `0007_last_maximus` | Luo taulun `invitecodes`. |
| `0008_vengeful_spirit` | Lisää sarakkeen `users.isAdmin`. |
| `0009_nice_dazzler` | Rakentaa `users`-taulun uudelleen samoilla sarakkeilla. |
| `0010_save_history_and_item_log` | Luo taulut `characterhistory`, `loadouthistory` ja `inventorytransactions` sekä taulun `inventorylog` ja triggerit, jotka sallivat siihen vain lisäyksiä. |
| `0011_real_progression` | Luo taulut `progress_tracks`, `objectives`, `huntpassselection`, `entitlements`, `cooldowns`, `bounties`, `bountydraft` ja `loadoutslots` sekä taulun `progression_events` ja triggerit, jotka sallivat siihen vain lisäyksiä. |
| `0012_friends_and_blocks` | Luo taulut `friendships` ja `blocks`. |
| `0013_guilds` | Luo taulut `guilds`, `guildmembers` ja `guildinvites`. Lisää vain tauluja. |
| `0014_escalation` | Luo taulut `escalationprogression`, `escalationtalents` ja `escalationunlocks`. Lisää vain tauluja. |
| `0015_store_purchases` | Luo taulun `storepurchases` ja sen indeksin sarakkeelle `accountId`. Lisää vain tauluja. |
| `0016_slayer_links` | Luo taulut `slayerlinkinvites` ja `slayerlinks` indekseineen. Lisää vain tauluja. |

Migraatiot 0014–0016 tulivat Harmonicin forkin siirron mukana. Yksikään niistä ei muuta, kopioi tai
muunna olemassa olevaa taulua; niitä edeltävä versio käynnistyy yhä muutetulla tietokannalla ja jättää
uudet taulut huomiotta ([Päivitysohjeet]({{ upgrade_page.url | relative_url }}#harmonic-port)).

Kun haluat lisätä migraation, muuta tiedostoa `src/db/schema.ts` ja aja `npm run db:generate`; katso
[Kehittäjän opas]({{ dev_page.url | relative_url }}).

### Tilit ja avaimet {#accounts-and-keys}

| Taulu | Mitä siihen tallennetaan |
|:------|:-------------------------|
| `users` | Yksi rivi tiliä kohden: `userId` (`UID-` ja UUID), `name` (käyttäjänimi), `notes` (tilin Notes-valuutan saldo, rekisteröityessä 0; tämän `/balance` ilmoittaa) ja `isAdmin`. Uudet käyttäjänimet ovat 3-16 kirjainta, numeroa tai `_`-merkkiä ja yksilöllisiä kirjainkoosta riippumatta; tämän tarkistaa metagame, yksilöivää indeksiä ei ole. Vain `lib/dr-db.js make-admin` tai käsin ajettu SQL-päivitys asettaa `isAdmin`-arvon. |
| `userapikeys` | Yksi tiliavain käyttäjää kohden, tallennettuna SHA-256-tiivisteenä. Itse avain (`UUK_` ja 48 heksamerkkiä) näytetään kerran, rekisteröitymisen yhteydessä, eikä sitä koskaan tallenneta. |
| `userapikeystoregister` | Jono **selväkielisiä** tiliavaimia: seuraavassa käynnistyksessä metagame tallentaa niiden tiivisteet tauluun `userapikeys` ja tyhjentää jonon. Käytä sitä vain tilille, jolla ei vielä ole avainta; kadonneen avaimen korvaamiseen noudata sivun [Palvelin ryhmälle]({{ admin_page.url | relative_url }}) ohjetta. |
| `gameserverapikeys` | Pelipalvelinavainten SHA-256-tiivisteet. |
| `gameserverapikeystoregister` | Jono **selväkielisiä** pelipalvelinavaimia, joiden tiivisteet tallennetaan seuraavassa käynnistyksessä tauluun `gameserverapikeys`, minkä jälkeen jono tyhjennetään. Sivun [Pystytä palvelin]({{ host_page.url | relative_url }}#metagame) käsin tehty asennus käyttää sitä; paketti kirjoittaa tiivisteen suoraan komennolla `lib/dr-db.js gs-key`. |
| `invitecodes` | Kutsukoodit: koodi, jäljellä olevat käyttökerrat ja se, onko käyttökertoja rajattomasti. Käyttökerta kuluu vasta, kun käyttäjänimi on hyväksytty. |

Seuraavaan käynnistykseen asti kaksi jonotaulua sisältävät avaimia selväkielisinä: käynnistä metagame
uudelleen heti, kun olet lisännyt sellaiseen avaimen.

### Tallennukset {#saves}

Jokaisella tilillä on yksi hahmo, joka luodaan tilin ensimmäisellä kirjautumisella ja nimetään
käyttäjänimen mukaan. Kaikki tallennusdata säilytetään JSON-tekstinä täsmälleen sellaisena kuin peli sen
lähettää.

| Taulu | Mitä siihen tallennetaan |
|:------|:-------------------------|
| `characters` | Hahmoa kohden: omistaja, luonti- ja muokkauspäivä, nimi, `updateVersion` (tallennus, joka ei ole tallessa olevaa versiota uudempi, hylätään) ja `data`, pelin tallennusdata (blob). |
| `inventories` | Hahmoa kohden: yksilölliset tavarat ja pinottavat tavarat kahtena JSON-taulukkona. |
| `loadouts` | Hahmoa kohden: varustesetit ja `persistent`-lohko sellaisina kuin peli ne lähettää. |
| `breadcrumbs` | Hahmoa kohden: ”uusi”-merkinnät, joilla on oma `updateVersion`. |
| `encounteredcontent` | Hahmoa kohden: mitä hahmo on jo nähnyt, sisältötyypeittäin (”nähty”-merkinnät). |

### Tallennusten suojaus ja historia {#save-protection-and-history}

| Taulu | Mitä siihen tallennetaan | Säilytys |
|:------|:-------------------------|:---------|
| `inventorytransactions` | Jokaisen toteutetun tavaratapahtuman (inventory transaction) tallennettu vastaus hahmon, tapahtuman tunnisteen ja pyynnön tiivisteen mukaan, jotta uudelleen lähetetty pyyntö saa saman vastauksen eikä tule suoritetuksi kahdesti. | 30 päivää; vanhemmat rivit poistetaan aina, kun uusi tapahtuma tallennetaan. |
| `inventorylog` | **Vain lisäyksiä** (append-only): jokainen tavaramuutos, ja siitä aika, tili, hahmo, tapahtuma, kutsuja, operaatio, tavara, muutos ja määrä muutoksen jälkeen. Triggerit hylkäävät `UPDATE`- ja `DELETE`-komennot. | Ikuisesti. |
| `characterhistory` | Kunkin hahmon tallennusdatan aiemmat versiot ja syy, miksi ne tallennettiin. Ylläpitoreitit `SaveHistory` ja `RollbackCharacter` käyttävät niitä ([HTTP-rajapinta]({{ api_page.url | relative_url }})). | Karsitaan jokaisella tallennuksella: `SAVE_HISTORY_KEEP` uusinta versiota (100), sitten kunkin tunnin viimeinen versio `SAVE_HISTORY_HOURLY` tunnin ajalta (48) ja kunkin päivän viimeinen versio `SAVE_HISTORY_DAILY` päivän ajalta (30). Koodin arvion mukaan tämä tekee oletusarvoilla noin 3,5 Mt hahmoa kohden. |
| `loadouthistory` | Sama varustesetille (`RollbackLoadout`), hahmokohtaisella versiolaskurilla. | Kuten `characterhistory`. |

### Eteneminen {#progression}

Oikea eteneminen on oletus: jokainen tili lukee ja kirjoittaa näitä tauluja. Asetuksella
`PROGRESSION_MODE=stub` niin tekevät vain asetuksessa `PROGRESSION_REAL_ACCOUNTS` luetellut tilit;
kaikki muut saavat alkuperäisen projektin kiinteät vastaukset (taso 50 ja maksimitasot), eikä heille
tallenneta mitään. Näiden kahden välillä ei siirretä mitään: tilillä, jolla on pelattu tynkätilassa, ei
ole rivejä näissä tauluissa, ja se aloittaa Slayer-tasolta 1. Kun oikea eteneminen on käytössä
kaikille tileille ja tällaisia tilejä on (pelaajat, joilla on hahmo mutta ei tallennettua etenemisrataa
eikä yhtään etenemistapahtumaa), metagame kirjaa käynnistyessään lokiin varoituksen niiden määrästä.
[Päivitysohjeet]({{ upgrade_page.url | relative_url }}) selittävät vaihtoehdot.

| Taulu | Mitä siihen tallennetaan |
|:------|:-------------------------|
| `progress_tracks` | Tiliä ja rataa kohden (Slayer-taso, hirviöiden ja aseiden mestaruus, Hunt Pass): kokonais-XP sekä jo vahvistetut ilmaisen ja maksullisen (Elite) radan tasot. Ansaitut tasot lasketaan `progression_config.json`-tiedostosta samalla tavalla kuin peli tekee. Puuttuva rivi tarkoittaa 0. |
| `objectives` | Tiliä kohden: kunkin mestaruustavoitteen edistyminen ja suorituskerrat sellaisina kuin pelipalvelin ne viimeksi lähetti. |
| `huntpassselection` | Tiliä kohden: valittu Hunt Pass. Puuttuva rivi tarkoittaa asetusta `ACTIVE_HUNT_PASS` (oletus `season09b`). |
| `entitlements` | Tiliä kohden: oikeudet (entitlements), kuten Elite Hunt Pass, sekä aktivointipäivä, kesto tunteina (0 = pysyvä), lähde (`default`, `gameserver`, `admin:<id>`, kaupan ostolle `store:<tarjous>` tai asetuksella `PROGRESSION_CONFIRM_ENTITLEMENTS=1` `confirm:<rata>:<taso>`) ja peruutuspäivä. Oletusoikeudet (`ENTITLEMENTS_DEFAULT`) lisätään kerran tiliä kohden. Peruttu rivi säilytetään, joten perutua oletusoikeutta ei anneta uudelleen. |
| `cooldowns` | Tiliä kohden: kunkin päivittäisen tai viikoittaisen rajoituksen alkamisaika sellaisena kuin pelipalvelin sen lähetti. Yli 24 tuntia vanhat keräilyn (harvest) odotusajat poistetaan, kun pelipalvelin seuraavan kerran aloittaa yksittäisen odotusajan kyseiselle tilille. |
| `bounties`, `bountydraft` | Tiliä kohden: kunkin palkkiotehtävän JSON paikkoineen ja nykyinen palkkiotehtävävalikoima (draft). |
| `loadoutslots` | Hahmoa kohden: avatut hahmokohtaiset varustesettipaikat (enintään 5) ja aktiivinen yhdistetty paikka. Yhden tilipaikan kanssa asiakas näkee enintään 6 paikkaa. Puuttuva rivi tarkoittaa yhtä hahmopaikkaa ja aktiivista paikkaa 0. |
| `progression_events` | **Vain lisäyksiä** (append-only): kirjanpito jokaisesta kirjoituksesta, jonka pelipalvelin, pelaajan peli tai ylläpitäjä tekee yllä oleviin tauluihin ja Escalation-tauluihin, myös hylätyistä (oletusoikeudet lisätään ilman merkintää): aika, tili, kutsuja (`gameserver`, `client` tai `admin`), reitti, pyynnön raaka runko, tila, vastaus ja huomautus (esimerkiksi `retry of event <id> within 10 s: its reply, nothing added` tai Escalation-tallennuksen `season <id>`). Triggerit hylkäävät `UPDATE`- ja `DELETE`-komennot. Säilytetään ikuisesti. |

Ylläpitoreitit `Progression`, `SeedProgression`, `GrantEntitlement` ja `RevokeEntitlement` lukevat ja
muuttavat näitä tauluja; katso [HTTP-rajapinta]({{ api_page.url | relative_url }}).

### Escalation- ja kauppataulut {#escalation-and-store-tables}

Lisätty migraatioilla `0014_escalation` ja `0015_store_purchases`. Päivämäärät ovat ISO-tekstiä.

| Taulu | Mitä se tallentaa |
|:------|:------------------|
| `escalationprogression` | Vain asetuksella `ESCALATION_MODE=real`: tiliä ja kautta kohden Escalation-taso, XP seuraavaa tasoa kohti, viimeksi tallennettu `updateVersion`, tallennetun sisällön tiiviste (uusinnan tunnistamiseen) ja tallennusaika. Puuttuva rivi tarkoittaa tasoa 0 ja versiota 0. [Escalation]({{ '/fi/findings/escalation.html' | relative_url }}). |
| `escalationtalents` | Tiliä, kautta ja kykyä kohden: aste. Jokainen tallennus korvaa ne kokonaan (kykyjen nollaus laskee asteita). |
| `escalationunlocks` | Tiliä, kautta ja palkintoa kohden: milloin se kerättiin. Kerättyä palkintoa ei koskaan poisteta. |
| `storepurchases` | Vain asetuksella `STORE=free`: yksi rivi ostotunnistetta kohden. Tunnisteen SHA-256-tiiviste (itse tunnistetta ei koskaan tallenneta), tili, hahmo jolle osto menee, tarjous, tiiviste tarjouksesta tunnisteen antohetkellä, luonti- ja vanhenemisaika (10 minuuttia) sekä lunastusaika. Lunastamattomat, vanhentuneet rivit poistetaan jokaisella käynnistyksellä, sen jälkeen enintään kerran tunnissa ja tililtä aina, kun se saa tunnisteen; lunastetut rivit säilytetään kuitteina 30 päivää. Raja 60 tunnistetta tiliä kohden 10 minuutissa lasketaan tästä taulusta. Oston antamat tavarat ja oikeudet ovat tauluissa `inventories` ja `entitlements`, kirjattuina tauluihin `inventorylog` (kutsuja `store`) ja `inventorytransactions`. [Pelin kauppa]({{ '/fi/findings/store.html' | relative_url }}). |

### Kaverit {#friends}

| Taulu | Mitä siihen tallennetaan |
|:------|:-------------------------|
| `friendships` | Yksi rivi tiliparia kohden (kahden tilin tunnisteet järjestettyinä): kuka lähetti pyynnön, `PENDING` tai `ACCEPTED` sekä ajat millisekunteina. Enintään 200 tiliä kohden. |
| `blocks` | Kuka esti kenet ja milloin. Esto poistaa kaveruuden ja kahden pelaajan väliset odottavat ryhmä- ja kiltakutsut sekä estää kaveripyynnöt, ryhmäkutsut ja kiltakutsut kumpaankin suuntaan. Enintään 200 tiliä kohden. |

### Killat {#guilds}

| Taulu | Mitä siihen tallennetaan |
|:------|:-------------------------|
| `guilds` | Yksi rivi kiltaa kohden: `guildId` (satunnainen UUID), `name`, `nameplate` (nimikyltti, voi olla tyhjä), pienaakkosiset kopiot `nameKey` ja `nameplateKey` yksilöivillä indekseillä (nimet ja kyltit ovat siis ainutlaatuisia kirjainkoosta riippumatta; tyhjä kyltti tallennetaan siihen NULL-arvona), `leaderId` sekä ajat millisekunteina. |
| `guildmembers` | Yksi rivi jäsentä kohden tilin mukaan (yksi kilta tiliä kohden): `guildId`, `rank` (`Leader`, `Officer` tai `Member`) ja ajat. Johtajan rivi vastaa aina kenttää `guilds.leaderId`. |
| `guildinvites` | Avoimet kutsut: `inviteId` (satunnainen UUID, jolla peliohjelma hyväksyy tai hylkää kutsun), `guildId`, kutsuttu ja kutsuja sekä milloin kutsu tehtiin ja milloin se vanhenee. Yksi kiltaa ja kutsuttua kohden. Vanhentuneet rivit ohitetaan ja poistetaan enintään kerran minuutissa. Esto poistaa kahden pelaajan väliset rivit, ja upseerin rivit poistetaan, kun hänet alennetaan jäseneksi, erotetaan tai hän lähtee; toisensa estäneiden pelaajien väliset rivit ja rivit, joiden kutsuja ei enää saa kutsua, ohitetaan ja poistetaan hyväksyttäessä. |

Killan lakkauttaminen poistaa sen rivit kaikista kolmesta taulusta. Ylläpitoreitit `Guilds` ja
`DisbandGuild` listaavat ja poistavat kiltoja; katso [HTTP-rajapinta]({{ api_page.url | relative_url }}#guilds).

### Slayer Links {#slayer-links}

Lisätty migraatiolla `0016_slayer_links`. Ajat ovat millisekunteja, kuten kavereiden tauluissa.

| Taulu | Mitä se tallentaa |
|:------|:------------------|
| `slayerlinkinvites` | Yksi rivi kutsua kohden: `inviteId` (peliohjelman näkemä `link_id`), lähettäjä, kutsuttu, lähettäjän paikka (1–3, peliohjelman numerot), luonti- ja vanhenemisaika sekä `status` (`PENDING`, `ACCEPTED`, `DECLINED`, `CANCELED` tai `EXPIRED`). Parilla voi olla enintään yksi odottava kutsu (osittainen yksilöllinen indeksi). Kaveruuden purku tai esto asettaa parin odottavat kutsut tilaan `CANCELED`. |
| `slayerlinks` | Yksi rivi käynnissä olevaa linkkiä kohden (molemmat pelaajat jakavat sen): `linkId` (hyväksytyn kutsun tunnus), kaksi pelaajaa, kummankin paikka (1–3) sekä alkamis- ja päättymisaika (168 tuntia myöhemmin). Poisto poistaa rivin kummaltakin. |

Hylätyt, perutut ja vanhentuneet kutsut poistetaan, kun niiden 24 tuntia on kulunut, hyväksytyt kutsut
ja päättyneet linkit 30 päivän kuluttua, kun seuraava uusi kutsu tehdään. Kutsuraja (20 uutta kutsua
pelaajaa kohden 10 minuutissa) lasketaan tästä taulusta. [Kaverit, ryhmät ja killat]({{ '/fi/findings/social.html' | relative_url }}#slayer-links)
kertoo säännöt.

### Vain muistissa {#kept-only-in-memory}

Nämä **katoavat, kun metagame käynnistyy uudelleen**:

- matchmaking-jonot ja -tulokset (kuka odottaa mitäkin metsästystä ja mihin yhdistetään);
- ryhmät, ryhmäkutsut ja ryhmähaut;
- kaveripyyntöjen tahtiraja, kiltojen nimitarkistukset (15 minuuttia, viisi viimeisintä pelaajaa
  kohden), kiltojen perustamisen ja kutsujen tahtirajat, 24 tunnin tauko ennen kuin kilta voi kutsua
  uudelleen pelaajan, joka hylkäsi sen kutsun, sekä ryhmäkutsujen rajat (20 lähettäjää kohden 10
  minuutissa, 2 minuutin tauko hylkäyksen jälkeen);
- kuka on paikalla ja missä (pelaaja lasketaan paikalla olevaksi 90 sekunnin ajan pelinsä viimeisestä
  elonmerkistä);
- reitin `POST /undaunted/api/RegistrationStatus` kautta muutettu rekisteröintitila: uudelleenkäynnistyksen
  jälkeen asetustiedoston `REGISTRATION_MODE` on taas voimassa;
- lyhytaikaiset välimuistit (palvelimen tila, käännöstiedot).

Kirjautumiset säilyvät uudelleenkäynnistyksen yli: istuntotunnisteet on allekirjoitettu, ne ovat
voimassa 24 tuntia, eikä palvelin pidä niistä listaa. Ne lakkaavat toimimasta vain, jos
allekirjoitusavaimet vaihtuvat.

### Kasvu {#growth}

Tietokanta on aluksi pieni, mutta tallennushistoria kasvaa jokaisen hahmon myötä säilytysrajaansa asti,
ja `inventorylog` ja `progression_events` vain kasvavat. Mikään ei karsi vain lisäyksiä sallivia
tauluja; seuraa tiedoston kokoa pitkään pyörivällä palvelimella.

## Lokit {#logs}

Mikään osa ei poista lokeja niiden iän perusteella, paitsi paketin suorituskykyloki (30 päivää). Avaimet ja istuntotunnisteet pidetään poissa
jokaisesta lokista: metagame kirjaa jokaisesta pyynnöstä vain polun (polkujen tunnisteet muuttuvat
muotoon `<token>` tai `<redacted>`), ei koskaan otsakkeita tai kyselymerkkijonoja (query string)
(`bodies.log` kirjaa päällä ollessaan myös kyselymerkkijonon ja rungon, tunnisteet poistettuina), ja
käynnistin korvaa avaimet merkinnällä `<hidden>`. Lokeissa on kuitenkin tilien tunnisteita,
käyttäjänimiä ja julkisessa tilassa pelaajien IP-osoitteita, joten lue loki ennen kuin jaat sen.

### Muodot {#formats}

| Kirjoittaja | Muoto |
|:------------|:------|
| Metagame, deploy-palvelin | pino. Asetuksella `NODE_ENV=production` (paketissa aina päällä) yksi JSON-objekti riviä kohden: `level` (30 info, 40 warn, 50 error, 60 fatal), `time` (millisekunteja vuoden 1970 alusta), `pid`, `hostname`, `msg`. Kaikki tasot menevät vakiotulosteeseen (standard output). Ilman `production`-arvoa rivit ovat luettavia ja värillisiä. Metagamen pyyntörivit ovat muotoa `METHOD /path gs=0` (pelaaja) tai `gs=1` (pelipalvelin), ja yhdyskäytävän takana perässä on lisäksi ` via=gateway ip=<pelaajan osoite>`. `LOG_LEVEL` ja `LOG_REQUESTS` ovat sivulla [Asetukset]({{ config_page.url | relative_url }}). |
| Yhdyskäytävä, sallittujen listan apuri, sisältöpalvelin | Yksi JSON-objekti riviä kohden: `t` (ISO-aika), `level` (`debug`, `info`, `warn` tai `error`), `msg` ja lisäkentät. Varoitukset ja virheet menevät virhetulosteeseen (standard error), muut vakiotulosteeseen. Yhdyskäytävän `request`-rivit ovat sen pääsyloki; kentät on kuvattu [yhdyskäytävän README-tiedostossa]({{ site.github.repository_url }}/blob/dauntless-revived/UndauntedGateway/README.md#access-log) (englanniksi). |
| Pelipalvelimet, peliohjelma | Ei lokitiedostoa. Pelipalvelin tulostaa vain omaan konsoli-ikkunaansa (Ramsgaten ja Training Dojon ikkunat jäävät näkyviin; deploy-palvelin käynnistää metsästysten pelipalvelimet ikkuna piilotettuna). Peliohjelma kirjoittaa vain kaatumisraportteja kansioon `%LOCALAPPDATA%\Archon\Saved\Crashes\` (katso [Vianetsintä]({{ trouble_page.url | relative_url }})). |
| Käynnistin | Tekstirivejä: ISO-aika, `INFO`, `WARN` tai `ERROR` ja viesti. |

### Windows-palvelinpaketti {#windows-server-kit}

| Tiedosto | Mikä se on | Kierrätys |
|:---------|:-----------|:----------|
| `data\logs\metagame.out.log`, `metagame.err.log` | Metagamen vakiotuloste ja virhetuloste. `.err.log`-tiedostoon päätyy vain se, minkä Node tulostaa itse, kuten kaatumisen pinojälki (stack trace). | Aina kun osa käynnistyy, `Stack.ps1` siirtää ei-tyhjät tiedostot nimelle `data\logs\old\metagame.<yyyyMMdd-HHmmss>.out.log` (tai `.err.log`) ja säilyttää niistä 40 uusinta (molemmat lajit yhteensä). |
| `data\logs\deploy.*.log`, `content.*.log`, `gateway.*.log` | Samat deploy-palvelimelle, sisältöpalvelimelle ja yhdyskäytävälle. `gateway.out.log` on pääsyloki. | Kuten metagamen. |
| `data\allowlist\allowlist.out.log`, `allowlist.err.log` | Sallittujen listan apurin tuloste. | Kuten metagamen, mutta kansioon `data\allowlist\old\`. |
| `data\allowlist\audit.log` | Sallittujen listan apurin tarkastusloki, yksi JSON-objekti riviä kohden (`t`, `event` ja kentät): sisään päästetyt ja vanhentuneet osoitteet, hylkäykset, palomuurisääntöjen muutokset, koeajotilassa tarkka skripti, joka ajettaisiin, sekä epäonnistuneet salaisuustarkistukset. Ei koskaan itse salaisuutta. | Ei kierrätetä koskaan. |
| `data\logs\supervisor.log` | Palvelinkokonaisuuden valvojan PowerShell-transkripti: käynnistykset, kaatumiset, uudelleenkäynnistykset ja luovutukset. | Siirretään nimelle `supervisor.log.1`, kun valvoja käynnistyy ja tiedosto on yli 5 Mt. |
| `data\allowlist\supervisor.log` | Sama sallittujen listan apurin valvojalle (SYSTEM). | Kuten yllä. |
| `data\logs\bodies.log` | Vain asetuksella `LOG_BODIES=1`: yksi JSON-objekti riviä kohden, `t` (saapuminen), `method`, `url`, `gs`, `body`, `status` ja `ms` (sekä `"aborted": true`, jos yhteys katkesi ensin), kirjoitettuna kun vastaus on valmis, kiinteälle joukolle reittejä (eteneminen, Hunt Pass, palkkiotehtävät, odotusajat, Escalation, oikeudet, varustesettipaikkojen avaukset, kauppa (`/product`, `/token`, `/notification`), saldo ja `/reconcile`, Slayer Links, tavarat, matchmaking-ehdokkaat, ryhmät, kaverit ja tilihaut). Rungot katkaistaan 8 kt:n kohdalta (tavaroilla 64 kt), tunnisteet ja tiliavaimet poistetaan, ja kun `BODY_LOG_PER_PATH` on asetettu, polkua kohden kirjoitetaan enintään niin monta riviä. Paketti pakottaa julkisessa tilassa `LOG_BODIES=0`. Yksityistä tietoa: se kirjaa, mitä pelaajien pelit lähettävät. | Ei kierrätetä koskaan. |
| `data\logs\backup-db.out.log`, `backup-db.err.log` | Viimeisimmän varmuuskopion tietokantakopioinnin tuloste (`db ok, <n> users`). | Jokainen varmuuskopio kirjoittaa ne yli. |
| `data\logs\install\<vaihe>.out.log`, `.err.log` | Jokaisen asennus- ja päivitysvaiheen tuloste: lähdekoodin kopiointi, `npm ci` ja `npm run build` osa kerrallaan, Node.js:n, ajonaikaisten kirjastojen ja Tailscalen asennukset, pelin purku ja tarkistus, varmenne, avaimet ja ylläpitäjätili. | Kirjoitetaan yli, kun vaihe ajetaan uudelleen. |
| `backups\backup.log` | Yksi rivi varmuuskopiota kohden: aika, kansio, koko, tietokannan tarkistus ja säilytettyjen varmuuskopioiden määrä. | Siirretään nimelle `backup.log.1`, kun se on yli 5 Mt. |
| `data\logs\performance\performance-<yyyy-MM-dd>.csv` | [Suorituskykyloki](#performance-log): kokonaisuuden valvojan mittaus minuutin välein sekä jokainen `Write-PerformanceLog.ps1`-ajo. Vain lukuja. | Uusi tiedosto joka UTC-päivä; yli 30 päivää vanhat tiedostot poistetaan. |

### Suorituskykyloki {#performance-log}

Tiekartan kohta 4.12; pohjana on Vvoidddd:n ensimmäinen mittari
([#6](https://github.com/mixutin/dauntless-revived/pull/6)). CSV-tiedosto otsikkorivillä, ASCII,
CRLF-rivinvaihdot, jokaisessa luvussa desimaalipiste (Windowsin kielestä riippumatta) ja ajat
UTC-aikana muodossa `yyyy-MM-ddTHH:mm:ssZ`. Mittaus on yksi `host`-rivi ja yksi rivi prosessia
kohden, kaikilla sama `timestamp_utc`. Solu, joka ei koske riviä tai jota ei pystytty lukemaan, on
tyhjä. **Vain lukuja:** ei pelaajien nimiä, tilitunnuksia, avaimia eikä komentorivejä. Siitä näkee
silti, milloin palvelimella on kiireistä, joten pidä se omana tietonasi. Miten luvut saadaan:
[Write-PerformanceLog.ps1]({{ scripts_page.url | relative_url }}#write-performancelogps1).

| Sarake | Rivit | Mitä siinä on |
|:-------|:------|:--------------|
| `timestamp_utc` | kaikki | Milloin mittaus otettiin. |
| `role` | kaikki | `host`; osa: `metagame`, `content`, `gateway`, `deploy`, `allowlist` (palvelutilillä pyörivä valvoja ei näe SYSTEM-tilillä pyörivää sallittujen listan apuria); tai pelipalvelin: `ramsgate`, `dojo`, `hunt`, `tutorial`, tai `unknown`, kun sillä ei vielä ole UDP-porttia. |
| `pid` | prosessit | Prosessin tunniste. |
| `udp_port` | pelipalvelimet | Sen UDP-portti. |
| `started_utc` | prosessit | Milloin prosessi käynnistyi. |
| `players` | pelipalvelimet | Pelaajat, jotka metagame sijoittaa sille (viimeisten 90 sekunnin sydämenlyönnit). Tyhjä, jos metagame ei vastannut omistajan avaimella. |
| `cpu_core_percent` | prosessit | Suoritinaika edellisen mittauksen jälkeen prosentteina yhdestä ytimestä: 100 on yksi täysin kuormitettu ydin. Tyhjä käynnistyksen ensimmäisessä mittauksessa ja uudella prosessilla. |
| `working_set_mb`, `private_mb` | prosessit | Working set ja yksityinen (varattu) muisti megatavuina. |
| `host_cpu_percent` | host | Koko koneen suoritinkäyttö edellisen mittauksen jälkeen, 0-100. |
| `logical_cpus` | host | Loogiset suorittimet; `host_cpu_percent` kertaa tämä jaettuna sadalla on kuormitettujen ytimien määrä. |
| `ram_total_mb`, `ram_free_mb` | host | Keskusmuisti megatavuina. |
| `disk_free_gb` | host | Asennuskansion aseman vapaa tila gigatavuina. |
| `net_in_kbit_s`, `net_out_kbit_s` | host | Verkkosovittimien liikenne edellisen mittauksen jälkeen kilobitteinä sekunnissa (ilman loopbackia, VPN-tunneleita ja virtuaalikytkimiä). |
| `game_servers` | host | Montako tämän asennuksen pelipalvelinta on käynnissä. |
| `players_online` | host | Metagamen laskema paikalla olevien pelaajien määrä. Tyhjä ilman omistajan avainta, ei koskaan virheellinen 0. |

### Käsin pystytetty palvelinkone ja käynnistin {#hand-built-host-and-launcher}

- `C:\dr\data\metagame.log` ja `metagame.err` sekä `deploy.log` ja `deploy.err`: ohjeen
  `Start-Process`-uudelleenohjaus, uusi tiedosto jokaisella käynnistyksellä.
  [Vianetsintä]({{ trouble_page.url | relative_url }}) näyttää, miten ne luetaan tavallisena tekstinä.
- `npm start` tai `npm run dev` päätteessä: tuloste jää päätteeseen.
- Käynnistin: `%APPDATA%\Dauntless Revived Launcher\logs\launcher.log`, joka nimetään uudelleen
  `launcher.old.log`-tiedostoksi, kun se ylittää 2 MiB (yksi vanha tiedosto säilytetään).

## Varmuuskopiot {#backups}

### Windows-palvelinpaketti {#windows-server-kit-1}

`Backup-DauntlessServer.ps1` tekee jokaisesta varmuuskopiosta oman kansion, `backups\yyyy-MM-dd_HHmmss\`.
Kansioiden nimet järjestyvät aikajärjestykseen. **Varmuuskopio sisältää palvelimen kaikki salaisuudet:
älä koskaan jaa sitä, älä koskaan committoi sitä, ja kopioi se palvelimelta pois vain salattuna.**

| Varmuuskopiokansiossa | Mikä se on |
|:----------------------|:-----------|
| `undaunted.db` | Tietokanta, kopioituna SQLiten online backup -rajapinnalla (turvallinen metagamen pyöriessä) ja sen jälkeen tarkistettuna `integrity_check`-tarkistuksella. Jos tarkistus epäonnistuu, kansio poistetaan ja varmuuskopiointi epäonnistuu. |
| `server.json` | Paketin tila. |
| `news.json` | Käynnistimen uutiset. |
| `secrets\metagame.env`, `deployserver.env`, `content.env`, `gateway.env` | Asetukset, joissa ovat istuntotunnisteiden allekirjoitusavaimet, pelipalvelinavain ja yhdyskäytävän salaisuudet. |
| `secrets\*.key` | Jokainen `data\keys`-kansion avaintiedosto (`owner.key`, `gameserver.key`). |
| `secrets\tls\gateway-cert.pem`, `gateway-key.pem` | Yhdyskäytävän varmenne ja avain. Kun ne palautetaan, sormenjälki pysyy samana, joten jo jaetut kutsut toimivat edelleen. |

Varmuuskopiossa ei ole: `allowlist.env` (vain Administrators ja SYSTEM voivat lukea sen, ja asennus
tekee uuden), `data\allowlist\`, lokit, **kuvapaketti kansiossa `data\branding\`** (pidä siitä oma
kopio), pelitiedostot, käännetty koodi eikä palvelutilin `Game.ini`- ja `Engine.ini`-tiedostot
(asennusohjelma kirjoittaa ne uudelleen).

**Milloin.** Tunnin välein (ajastettu tehtävä ”Dauntless Revived backup” palvelutilinä, kello 00.05
alkaen); ennen kuin metagame käynnistyy (`Stack.ps1` kieltäytyy käynnistämästä sitä ilman
varmuuskopiota, ellet anna valintaa `-NoBackup`, ja valvojan tekemä uudelleenkäynnistys jättää
varmuuskopion väliin, jos uusin varmuuskopio on alle 10 minuuttia vanha); pysäytyksen jälkeen; ennen
kuin päivitys vaihtaa käännöksen; ja kerran asennuksen lopussa.

**Säilytys.** Jokainen ajo säilyttää 48 uusinta varmuuskopiota (tunnin välein otetut sekä käynnistysten
ja pysäytysten yhteydessä otetut yhteensä) sekä uusimman varmuuskopion kultakin niistä 30 viimeisimmästä
päivästä, joilta varmuuskopio löytyy, ja poistaa loput. `Backup-DauntlessServer.ps1 -Hourly <n> -Daily <n>`
käyttää muita lukuja kyseisellä ajokerralla; ajastettu tehtävä käyttää aina oletuksia.

**Palautus.** `Install-DauntlessServer.ps1 -RestoreFrom <varmuuskopiokansio>` (tai omalta koneeltasi
`Deploy-Remote.ps1 -RestoreFrom`). Kansiossa on oltava `undaunted.db`, `secrets\metagame.env` ja
`secrets\deployserver.env`. Olemassa olevaa `data\undaunted.db`-tiedostoa ei kirjoiteta yli (poista se
ensin), ja jo olemassa olevat avaintiedostot säilytetään. Sama komento hyväksyy myös alkuperäisen
palvelinkoneemme `backup.ps1`-skriptin varmuuskopiot, joissa on sama rakenne. Katso
[Windows-palvelin]({{ winserver_page.url | relative_url }}#varmuuskopiot).

### Käsin pystytetty palvelinkone {#hand-built-host}

Sivulla [Palvelin ryhmälle]({{ admin_page.url | relative_url }}#back-up-the-database) on kaksi tapaa
varmuuskopioida tietokanta: kopio pysäytetystä tiedostosta tai skripti, joka kopioi tietokannan
palvelimen pyöriessä. Varmuuskopioi lisäksi, salattuna eikä koskaan gitiin, molemmat `.env`-tiedostot,
`owner.key` ja `gameserver.key`: jos allekirjoitusavaimet katoavat, kaikki kirjautuvat ulos, ja jos
tiliavain katoaa, sen pelaaja ei pääse enää sisään.

## Kaverin koneella {#on-a-friends-pc}

### Käynnistin {#the-launcher}

Käynnistin säilyttää tietonsa Electronin käyttäjäkohtaisessa kansiossa, joka on nimetty tuotteen
mukaan: `%APPDATA%\Dauntless Revived Launcher\`. Mitään siellä ei ole tarkoitettu muokattavaksi käsin.

| Polku | Mikä se on |
|:------|:-----------|
| `settings.json` | Palvelin, jolle on liitytty (tila, osoite, portti, nimi sekä Tailscalen jakolinkki tai varmenteen sormenjälki; kutsukoodi siihen asti, kunnes se on käytetty), asennuskansio, viimeksi kokonaan tarkistettu pelikansio, grafiikan esiasetus, automaattisen valotuksen valinta (`exposure`: `game` tai `basic`), ikkunatila, kieli, pelin kieli (`gameLanguage`: `auto` tai kieli, kuten `es-ES`), näytetäänkö pelin lokiruutu (`showConsole`) sekä palvelinkohtaisesti käyttäjänimi ja se, onko avaimen varmuuskopiota jo tarjottu. Kirjoitetaan atomisesti `settings.json.tmp`-tiedoston kautta; virheelliset kentät palautuvat luettaessa oletusarvoihin. Ei tiliavainta. |
| `keys\<palvelimen tunniste>.key` | Yhden palvelimen tiliavain. **Salaisuus: älä koskaan jaa sitä äläkä kopioi sitä minnekään.** Se on salattu Windowsin DPAPI:lla, joten vain sama Windows-käyttäjä samalla koneella voi lukea sen. Sisällä ovat muototunniste `DRK2`, varmenteen sormenjälki, johon avain kuuluu (julkiset palvelimet), ja itse avain. Palvelimen tunniste on merkkijonon `host:port` (yksityinen tila) tai `public:host:port` (julkinen tila) SHA-256-tiivisteen 24 ensimmäistä heksamerkkiä. ”Kirjaudu ulos” poistaa tiedoston. |
| `logs\launcher.log`, `launcher.old.log` | Käynnistimen loki (katso [Lokit](#logs)): käynnistys, liittymiset, yhteysongelmat, lataukset ja pelin komentorivi avain piilotettuna. Siinä on palvelinten osoitteita ja käyttäjänimesi. |
| `verified-files.json` | Jo tiivistettyjen pelitiedostojen koko ja muokkausaika, jotta keskeytynyt asennus ei tiivistä niitä uudelleen. Korjaus (”Korjaa pelitiedostot”) ei käytä sitä. Sen voi poistaa turvallisesti. |
| `art-cache\<sha256>` | Palvelimen kuvapaketin taustakuvat tiivisteensä mukaan nimettyinä; ne ladataan uudelleen joka istunnossa. Sen voi poistaa turvallisesti. |

Muualla koneella:

| Polku | Mikä se on |
|:------|:-----------|
| `%LOCALAPPDATA%\DauntlessRevived\Game\` | Oletuspelikansio: 410 tiedostoa, noin 10,9 Gt, sekä kaksi DLL-tiedostoa kansiossa `Archon\Binaries\Win64\`. ”Vaihda kansio…” valitsee toisen (absoluuttinen polku, enintään 150 merkkiä). Kansiota, jossa peli jo on (pelin juurikansio, jossa on `Archon\`, sen yläkansio `BaseGame144`, jossa on `Dauntless`-kansio, tai pelin sisällä oleva `Archon` tai `Archon\Binaries\Win64`), käytetään sinä pelinä, ja se torjutaan, jos pelin juurikansion polku on yli 150 merkkiä pitkä; jos jokin muu kansio ei ole tyhjä, peli asennetaan sen `DauntlessRevived`-alikansioon. ”Minulla on jo pelitiedostot” ottaa liitetyn asematunnuksella alkavan polun tai selatun kansion, tunnistaa samat rakenteet, torjuu verkko- (`\\kone\jako`), laite- ja suhteelliset polut ennen kuin katsoo niihin, sallii enintään 150 merkin pituisen pelin juurikansion ja tarkistaa sitten jokaisen tiedoston (Korjaa). Latauksen aikana tiedoston nimi on `<nimi>.part`; kopioitavana olevan DLL:n nimi on `<nimi>.new`. |
| `Dauntless Revived key - <käyttäjänimi>.txt` | Avaimen varmuuskopio, jonka tallennat Asetuksista valitsemaasi kansioon (oletuksena Tiedostot eli Documents). Jos käyttäjänimi ei ole tiedossa, nimi on `Dauntless Revived key.txt`. **Selväkielinen salaisuus: kuka tahansa, jolla se on, voi pelata sinuna. Älä koskaan jaa sitä; säilytä sitä salasanojen hallinnassa tai USB-tikulla.** |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | `Engine.ini`, jonka kaksi hallittua osiota käynnistin kirjoittaa uudelleen ennen jokaista PELAA-painallusta, ja `GameUserSettings.ini`, jonka `sg.*Quality`-rivit se asettaa vain, kun pakotat grafiikkatason. Molemmat kirjoitetaan väliaikaisen `.dr-tmp`-tiedoston kautta. Katso [Pelin asetukset]({{ gamesettings_page.url | relative_url }}). |
| `%LOCALAPPDATA%\DauntlessRevivedLauncher\` | Käynnistinohjelma, johon Squirrel-asennusohjelma sen tavallisesti asentaa (siirrettävä zip-versio toimii siellä, minne sen purat). Kaksi kiinnitettyä DLL-tiedostoa tulevat mukana sen `resources`-kansiossa. |

### Kaveripaketti {#the-friend-kit}

Vanhempi, vain Tailscalen kautta toimiva kaveripaketti ([Liity kaverina]({{ friends_page.url | relative_url }}))
käyttää eri kansiota kuin käynnistin:

| Polku | Mikä se on |
|:------|:-----------|
| `%APPDATA%\DauntlessRevived\account.key` | Tiliavain selväkielisenä. `setup.ps1` kirjoittaa sen, ja `play.ps1` välittää sen pelille. **Salaisuus: älä koskaan jaa sitä; varmuuskopioi se itse.** |
| `%APPDATA%\DauntlessRevived\settings.json` | Palvelinkoneen osoite ja pelikansio, jotta `play.ps1` ei tarvitse parametreja. Ei salaisuuksia. |
| Pelikansio (`-Game`, oletus `C:\D144\Dauntless`) | `setup.ps1` kopioi kaksi tarkistettua DLL-tiedostoa kansioon `Archon\Binaries\Win64\`. |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | `play.ps1` kirjoittaa uudelleen samat `Engine.ini`-osiot kuin käynnistin sekä `-Graphics`-parametrin kanssa `GameUserSettings.ini`-tiedoston grafiikkarivit. |

Tallennetut palvelimet: `savedServers` säilyttää enintään 20 palvelinta. Palvelimen poistaminen listalta ei poista tilin avainta.
