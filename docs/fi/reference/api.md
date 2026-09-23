---
title: HTTP-rajapinta
parent: Tekninen viite
grand_parent: Dauntless Revived suomeksi
nav_order: 3
description: "Dauntless Revivedin metagamen, deploy-palvelimen, sisältöpalvelimen ja yhdyskäytävän jokainen HTTP-reitti: kuka saa kutsua sitä ja mihin internetistä pääsee."
lang: fi
ref: reference/api
locale: fi_FI
---

{% assign config_page = site.pages | where: "path", "fi/reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "fi/reference/ports.md" | first %}
{% assign files_page = site.pages | where: "path", "fi/reference/files.md" | first %}
{% assign game_page = site.pages | where: "path", "fi/reference/game-settings.md" | first %}
{% assign scripts_page = site.pages | where: "path", "fi/reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "fi/reference/development.md" | first %}
{% assign host_page = site.pages | where: "path", "fi/setup/host.md" | first %}
{% assign admin_page = site.pages | where: "path", "fi/setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "fi/setup/windows-server.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "fi/setup/upgrading.md" | first %}
{% assign trouble_page = site.pages | where: "path", "fi/setup/troubleshooting.md" | first %}
{% assign contract_page = site.pages | where: "path", "fi/findings/backend-contract.md" | first %}
{% assign social_page = site.pages | where: "path", "fi/findings/social.md" | first %}
{% assign chat_page = site.pages | where: "path", "fi/findings/chat.md" | first %}

# HTTP-rajapinta
{: .no_toc }

Dauntless Revived koostuu muutamasta pienestä HTTP-palvelusta. Peliohjelma ja pelipalvelimet
puhuvat **metagamelle**. Metagame pyytää **deploy-palvelinta** käynnistämään pelipalvelimia.
Kaverikäynnistin lataa pelin **sisältöpalvelimelta**. Julkisessa tilassa TLS-salattu
**yhdyskäytävä** on ainoa osa, johon internetistä pääsee. Tällä sivulla on jokaisen palvelun
jokainen reitti: metodi ja polku, kuka sitä saa kutsua, mitä se tekee ja pääseekö siihen
yhdyskäytävän kautta.

Pelin reitit noudattavat 1.4.4-peliohjelman sopimusta eli alkuperäisen taustapalvelun polkuja ja
vastausten muotoja (katso [Taustapalvelun rajapinta]({{ contract_page.url | relative_url }})). Ne
eivät ole oma rajapintansa. Polun `/undaunted/api` alla olevat hallintareitit ovat peräisin
Undauntedista ja tästä forkista.

<details open markdown="block">
  <summary>Sisältö</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Palvelut yhdellä silmäyksellä {#services}

| Palvelu | Kansio | Kuuntelee (oletus) | Internetistä julkisessa tilassa | Tunnistautuminen |
|:--------|:-------|:-------------------|:--------------------------------|:-----------------|
| Metagame | `UndauntedMetagame/` | `BIND_HOST` (`127.0.0.1`) ja `PORT` (koodissa ei oletusta; ohjeet ja paketti käyttävät porttia 61000) | Vain yhdyskäytävän kautta, suodatettuna | Pelaajan tunniste, tiliavain, ylläpitäjän avain tai pelipalvelinavain reitistä riippuen |
| Chat (metagamen sisällä, `CHAT=1`) | `UndauntedMetagame/src/realtime/` | `127.0.0.1:61099` (`CHAT_BIND_HOST`, `CHAT_PORT`) | Vain yhdyskäytävän kautta (WebSocket-avaus) | Pelaajan tunniste (SASL PLAIN) |
| Deploy-palvelin | `UndauntedDeployServer/` | `BIND_HOST` (`127.0.0.1`) ja `PORT` (koodissa ei oletusta; ohjeissa ja paketissa 61001) | Ei koskaan | Ei mitään. Se vastaa vain suoraan loopbackin kautta tuleville kutsujille. |
| Sisältöpalvelin | `UndauntedContent/` | `127.0.0.1:61002` | Yhdyskäytävän kautta (`/content`) | Tiliavain pelitiedostoihin; muu on julkista |
| Yhdyskäytävä | `UndauntedGateway/` | HTTPS osoitteessa `0.0.0.0:443` | Kyllä: ainoa julkinen TCP-portti | Omat torjuntansa; välittää tunnistetiedot eteenpäin |
| Sallittujen listan apuri | `UndauntedGateway/` (osa `allowlist`) | `127.0.0.1:61005` | Ei koskaan | Sallittujen listan salaisuus |
| Käynnistimen välitin | `UndauntedLauncher/` | `127.0.0.1:61000` jokaisen pelaajan omalla koneella | Ei ole palvelimen palvelu | Torjuu kaiken, mikä ei ole paikallinen peli |

[Porttien viitesivu]({{ ports_page.url | relative_url }}) luettelee jokaisen portin ja kertoo, miten
sen voi vaihtaa. [Asetusten viitesivu]({{ config_page.url | relative_url }}) kuvaa jokaisen tällä
sivulla mainitun asetuksen.

**Yksityisessä tilassa** (kaverit Tailscalen kautta, katso
[Palvelin ryhmälle]({{ admin_page.url | relative_url }})) yhdyskäytävää ei ole. Metagame kuuntelee
isännän Tailscale-osoitteessa, joten kuka tahansa, joka tavoittaa sen osoitteen, voi kutsua jokaista
metagamen reittiä, myös ylläpitoreittejä (ne vaativat silti ylläpitäjän avaimen). Pidä ylläpitäjän
avaimet palvelinkoneella. Deploy-palvelin pysyy loopbackissa molemmissa tiloissa.

### Kuka kutsuu mitä {#who-calls-what}

| Kutsuja | Kutsuu | Millä |
|:--------|:-------|:------|
| Peliohjelma (1.4.4) | Metagamen pelireittejä. Julkisessa tilassa se kutsuu käynnistimen välitintä, joka välittää pyynnöt TLS:n yli yhdyskäytävälle. | Tiliavaimella kerran (kirjautuminen), sen jälkeen pelaajan tunnisteella |
| Peliohjelma (1.4.4), chat | [Chat](#chat) XMPP:nä WebSocketin yli, samaa tietä välittimen ja yhdyskäytävän kautta | Pelaajan tunnisteella |
| Pelipalvelimet (Ramsgate, Training Dojo, metsästykset) | Metagamea, suoraan palvelinkoneella | Pelipalvelinavaimella, ja pelaajan puolesta toimiessaan myös pelaajan tunnisteella |
| Metagame | Deploy-palvelinta: matchmaking ja pelipalvelinlista | Ei millään (vain loopback) |
| Sisältöpalvelin | Metagamen reittiä `GET /undaunted/api/GetUserInfo` tarkistaakseen lataajan avaimen | Lataajan tiliavaimella |
| Kaverikäynnistin | `Register`, `GetUserInfo`, `ServerStatus` (vanhemmalla metagamella varalla `/dauntless-status`) ja sisältöreitit | Pelaajan tiliavaimella |
| Kaveripaketti (yksityinen tila) | `Register` ja `GetUserInfo` | Pelaajan tiliavaimella |
| Palvelimen skriptit (`New-Invite.ps1`, `Get-ServerStatus.ps1`, `Stack.ps1`, `Update-DauntlessServer.ps1`) | `ServerStatus`, `/dauntless-status`, `RegistrationStatus`, `GetUserInfo` ja kutsureitit; `Stack.ps1 status` lukee lisäksi sallittujen listan apurin reittiä `GET /status` | Omistajan ylläpitäjän avaimella niillä reiteillä, jotka ottavat avaimen, ja `/status`-reitillä sallittujen listan salaisuudella, palvelimella itsellään |
| Yhdyskäytävä | Sallittujen listan apurin reittiä `POST /allow` | Sallittujen listan salaisuudella |

Skriptit kuvataan [skriptien viitesivulla]({{ scripts_page.url | relative_url }}).

## Tunnistautuminen {#authentication}

### Tunnistetiedot {#credentials}

| Tunnistetieto | Lähetetään | Muoto | Kenellä | Mitä se sallii |
|:--------------|:-----------|:------|:--------|:---------------|
| Tiliavain | Otsake `x-undaunted-user-api-key`; myös kirjautumisen `exchange_code` | `UUK_` ja perässä 48 pientä heksadesimaalimerkkiä | Jokaisella pelaajalla (käynnistimen avainsäilö, kaveripaketin `account.key`); omistajatilin avain palvelinkoneella | Kirjautuminen kyseisenä pelaajana, tilin `/undaunted/api`-reitit, pelitiedostojen lataukset |
| Pelaajan tunniste | Otsake `Authorization: Bearer <token>` | RS256-allekirjoitettu JWT, voimassa 24 tuntia | Peliohjelmalla kirjautumisen jälkeen; pelipalvelimet välittävät sen eteenpäin | Jokainen pelireitti pelaajan omalle tilille |
| Ylläpitäjän avain | Otsake `x-undaunted-user-api-key` | Tiliavain, jonka tilillä `isAdmin` = 1 | Palvelimen omistajalla, palvelinkoneella | Ylläpitoreitit, myös tunnisteen luominen mille tahansa tilille |
| Pelipalvelinavain | Otsake `x-undaunted-gameserver-apikey` | Mikä tahansa merkkijono; paketti ja ohje tekevät 48 heksadesimaalimerkkiä | Deploy-palvelimella, joka antaa sen jokaiselle pelipalvelimelle | Minkä tahansa pelaajan tietojen lukeminen ja kirjoittaminen sekä vain pelipalvelimille sallitut kirjoitukset |
| Yhdyskäytävän salaisuus | Otsake `X-Dauntless-Gateway` | 32–256 tulostettavaa merkkiä ilman välilyöntejä; paketti tekee 64 heksadesimaalimerkkiä | Yhdyskäytävällä ja metagamella (`GATEWAY_SECRET` kummassakin) | Saa metagamen luottamaan yhdyskäytävän `X-Forwarded-For`-otsakkeeseen |
| Sallittujen listan salaisuus | Otsake `x-allowlist-secret` | 32–256 tulostettavaa merkkiä ilman välilyöntejä; paketti tekee 64 heksadesimaalimerkkiä | Yhdyskäytävällä ja sallittujen listan apurilla (`ALLOWLIST_SECRET`) | UDP-peliporttien avaaminen osoitteelle |

**Jokainen näistä on salaisuus: älä koskaan jaa sitä, älä koskaan tallenna sitä versionhallintaan
äläkä koskaan liitä sitä keskusteluun, issueen tai kuvakaappaukseen.** Myös kutsukoodit ja
tunnisteiden allekirjoitukseen käytettävä yksityinen avain (`AUTH_SIGNING_PRIVKEY_B64`) ovat
salaisuuksia. Palvelut pitävät avaimet ja tunnisteet poissa lokeistaan. Pelipalvelinavain näkyy
jokaisen pelipalvelimen komentorivillä, joten älä koskaan tulosta niitä komentorivejä. Missä paketti
ja ohjeet säilyttävät kunkin avaimen, kerrotaan [tiedostojen viitesivulla]({{ files_page.url | relative_url }}).

### Tiliavaimet {#account-keys}

- `POST /undaunted/api/Register` luo tilin ja palauttaa sen avaimen kerran. Metagame tallentaa
  avaimesta vain SHA-256-tiivisteen (taulu `userapikeys`) ja vertaa tiivisteitä vakioajassa, joten
  kadonnutta avainta ei voi palauttaa.
- Avaimen uusimiseen, perumiseen tai poistamiseen ei ole reittiä. Sivulla
  [Palvelin ryhmälle]({{ admin_page.url | relative_url }}#missing-admin-functions-and-workarounds)
  kerrotaan, miten sen voi tehdä käsin.
- Sama avain kirjaa pelin sisään ja tunnistaa käynnistimen kutsut ja lataukset.
- Register luo myös tilitunnuksen: `UID-` ja perässä satunnainen UUID. Tilitunnus ei ole salaisuus
  (peli välittää tunnuksia ryhmiä ja kavereita varten), mutta `ServerStatus` näyttää vain
  käyttäjänimet.

### Kirjautuminen: tiliavaimesta pelaajan tunnisteeksi {#login}

1.4.4-peliohjelma kirjautuu samalla tavalla kuin se aikoinaan kirjautui Epicin tilipalveluun, ja
metagame vastaa sen palvelun sijasta:

1. Käynnistin tai kaveripaketti käynnistää pelin parametreilla `-AUTH_TYPE=exchangecode` ja
   `-AUTH_PASSWORD=<account key>` (katso [Pelin asetukset]({{ game_page.url | relative_url }})).
2. Peliohjelma lähettää avaimen `exchange_code`-kenttänä reitille `POST /account/api/oauth/token`,
   JSON- tai lomakemuodossa.
3. Asetuksella `AUTH_MODE=APIKEY` metagame hakee avaimen tiivisteen. Se vastaa EOS-tyylisellä
   rungolla, jonka `access_token` on JWT: sisältönä `{userId}`, myöntäjänä (issuer) ja yleisönä
   (audience) `undaunted-metagame`, voimassa 24 tuntia (`expires_in` 86400). Metagame allekirjoittaa
   sen avaimella `AUTH_SIGNING_PRIVKEY_B64` ja tarkistaa avaimella `AUTH_SIGNING_PUBKEY_B64`.
   Tuntematon avain saa vastauksen 400.
4. Siitä eteenpäin peliohjelma lähettää jokaisella pelireitillä otsakkeen
   `Authorization: Bearer <token>`. `PUT /gamesession/epic` palauttaa saman tunnisteen
   istuntotunnisteena, joten yksi tunniste kelpaa alkuperäisen Epic-Phoenix-kirjautumisen jokaiseen
   vaiheeseen.

Tästä seuraa:

- **Tunnisteet ovat tilattomia.** Tiliavaimen poistaminen tai vaihtaminen ei lopeta jo myönnettyä
  tunnistetta: se on voimassa, kunnes se vanhenee, enintään 24 tuntia. Istuntojen lopetusreitit eivät
  peru mitään. Uusi allekirjoitusavainpari mitätöi kaikki tunnisteet kerralla, ja pelaajat vain
  kirjautuvat uudelleen.
- **Kuka tahansa, jolla on yksityinen allekirjoitusavain, voi luoda tunnisteen mille tahansa
  tilille.**
- Ylläpitäjät voivat luoda tunnisteen mille tahansa tilille reitillä
  `POST /undaunted/api/GenerateJWTForUserId`.
- `AUTH_MODE=NONE` on vain kehitystä varten, ja sitä noudatetaan vain, kun `NODE_ENV` ei ole
  `production`. Silloin `exchange_code` ja `x-undaunted-user-api-key`-otsakkeen arvo otetaan suoraan
  tilitunnukseksi, joten kuka tahansa voi esiintyä kenenä tahansa. Tässä tilassa metagame vastaa 403
  jokaiseen pyyntöön, joka tuli välityspalvelimen kautta.
- Kun `AUTH_MODE` puuttuu tai on jokin muu (tai `NONE` yhdessä asetuksen `NODE_ENV=production`
  kanssa), `POST /account/api/oauth/token` kirjaa lokiin `No login method configured!` eikä
  **vastaa koskaan**: peliohjelma odottaa loputtomiin. Tiliavainta vaativat reitit vastaavat silloin
  500.

### Ylläpitäjätilit {#admin-accounts}

- Ylläpitäjä on tavallinen tili, jonka `users.isAdmin` on 1, ja ylläpitäjän avain on sen tilin oma
  tiliavain. Mikään reitti ei tee tilistä ylläpitäjää. Paketin asennusohjelma tekee sen omistajan
  tilille; käsin rakennetulla palvelimella
  [Pystytä palvelin]({{ host_page.url | relative_url }}#admin-account) näyttää yhden rivin komennon.
- Ylläpitäjätarkistus vastaa **403 jokaiseen pyyntöön, jossa on välitysotsake**, jo ennen kuin
  avainta edes haetaan (otsakkeet luetellaan [alempana](#public-mode)). Siksi ylläpitokutsut toimivat
  vain suoraan: palvelinkoneella itsellään tai yksityisessä tilassa miltä tahansa koneelta, joka
  tavoittaa metagamen. Yhdyskäytävä estää ylläpitoreitit myös omalla päätöksellään.
- Puuttuva tai tuntematon avain saa vastauksen 401; kelvollinen avain tilille, joka ei ole
  ylläpitäjä, saa vastauksen 403.
- Ylläpitäjän avain on yhtä hyvä kuin kenen tahansa tiliavain, koska sillä voi luoda tunnisteen
  kenelle tahansa.

### Pelipalvelinavain {#the-game-server-key}

- Pelipalvelimet ovat 1.4.4-peliohjelman lisäkopioita palvelintilassa. Deploy-palvelin käynnistää
  jokaisen niistä niin, että avain (`METAGAME_API_KEY`) on ensimmäinen komentoriviparametri, ja
  palvelin-DLL lisää otsakkeen `x-undaunted-gameserver-apikey: <key>` jokaiseen prosessin tekemään
  HTTP-pyyntöön. Kun pelipalvelin toimii pelaajan puolesta, se välittää myös pelaajan
  bearer-tunnisteen, joten metagame tietää molemmat.
- Metagame tallentaa avaimesta vain SHA-256-tiivisteen (taulu `gameserverapikeys`). Jonotauluun
  `gameserverapikeystoregister` laitettu avain tiivistetään ja siirretään seuraavassa käynnistyksessä.
  [Pystytä palvelin]({{ host_page.url | relative_url }}) näyttää käsin tehtävän tavan; paketin
  asennusohjelma rekisteröi avaimen itse.
- Avain hyväksytään vain suoraan saman koneen kutsujalta: loopback, yhteys johonkin koneen omista
  osoitteista (yksityisessä tilassa pelipalvelimet kutsuvat Tailscale-osoitetta) tai
  `GAMESERVER_ALLOW_FROM`-asetuksessa lueteltu osoite. Välitysotsakkeen kanssa sitä ei hyväksytä
  koskaan. Kaikki muut saavat vastauksen 403 ennen kuin avainta tarkistetaan; väärä avain saa
  vastauksen 401.
- Yhdyskäytävä vastaa 403 jokaiseen pyyntöön, jossa tämä otsake on lainkaan, arvosta riippumatta.
- Kun pelipalvelimen kirjoitus nimeää osoitteessa yhden tilin mutta välittää toisen tilin tunnisteen,
  metagame pitää kirjoituksen osoitteen tilille ja kirjaa sen lokiin (`Game server <what> for <tili>
  carries the token of <toinen tili>: accepted for <tili>, the account the request names`, enintään
  kerran minuutissa paria kohden). Se ei koskaan hylkää tällaista kirjoitusta: hylkäys voisi hukata
  tallennuksen metsästyksessä, jossa on useita pelaajia.
- Pelipalvelimen pyyntö, jonka välittämä pelaajan tunniste on vanhentunut tai virheellinen, saa
  vastauksen 500 eikä 401: tällä polulla tunniste tarkistetaan ilman virheenkäsittelyä. Siksi
  pelipalvelimen tallennukset epäonnistuvat, kun pelaajan tunniste on yli 24 tuntia vanha (katso
  [Vianetsintä]({{ trouble_page.url | relative_url }}#not-hit-yet-but-known-from-the-code)).

### Julkinen tila: yhdyskäytävän salaisuus ja välitysotsakkeet {#public-mode}

- Kun metagamelle asetetaan `GATEWAY_SECRET`, julkinen tila kytkeytyy päälle. Metagame kieltäytyy
  silloin käynnistymästä, ellei `AUTH_MODE=APIKEY`, ja varoittaa, jos salaisuus on alle 16 merkkiä,
  `BIND_HOST` ei ole loopback, `NODE_ENV` ei ole `production` tai `QOS_TARGET_URL` ei ole
  `http://127.0.0.1:<port>/QoS`. Yhdyskäytävä kieltäytyy käynnistymästä, ellei salaisuus ole 32–256
  tulostettavaa merkkiä ilman välilyöntejä, joten sitä sääntöä kannattaa noudattaa. Paketti
  kirjoittaa saman 64 heksadesimaalimerkin arvon kummankin osan asetuksiin.
- Yhdyskäytävä poistaa kaikki asiakkaan lähettämät välitysotsakkeet (`X-Forwarded-For`, `-Proto`,
  `-Host`, `-Port` ja `-Prefix`, `Forwarded`, `X-Real-IP`, `X-Client-IP`, `True-Client-IP`,
  `CF-Connecting-IP`, `X-Dauntless-Gateway`) ja asettaa omansa: `X-Forwarded-For: <the peer's address>`, `X-Forwarded-Proto: https` ja
  `X-Dauntless-Gateway: <secret>`.
- Metagame ottaa pelaajan osoitteen `X-Forwarded-For`-otsakkeesta (oikeanpuoleisin merkintä) vain,
  kun yhteys tulee loopbackista ja salaisuus täsmää (vertailu vakioajassa). Muuten se käyttää
  yhteyden omaa osoitetta. Silloin sen pyyntölokin rivi päättyy muotoon `via=gateway ip=<address>`.
- Mikä tahansa otsakkeista `X-Dauntless-Gateway`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP`,
  `X-Forwarded-Host`, `X-Forwarded-Proto` tai `Via` merkitsee pyynnön **välitetyksi** arvosta
  riippumatta ja riippumatta siitä, onko julkinen tila päällä. Välitetty pyyntö ei voi koskaan
  käyttää ylläpitäjän avainta eikä pelipalvelinavainta, ja deploy-palvelin torjuu välitetyt pyynnöt
  kokonaan.

### Reittitaulukoiden pääsymerkinnät {#access-labels}

| Merkintä | Hyväksyy | Torjuu |
|:---------|:---------|:-------|
| ei mitään | Kenet tahansa | Ei mitään |
| tunniste | Pelaajan tunnisteen (etuliite `Bearer `, `bearer ` tai `BEARER `) tai paikallisen kutsujan pelipalvelinavaimen, valinnaisesti pelaajan tunnisteen kanssa | 401 ilman kelvollista tunnistetietoa; 403 muualta tulevalle pelipalvelinavaimelle |
| pelaaja | Pelaajan tunnisteen. Pelipalvelimen on välitettävä sellainen; sen avain yksinään ei nimeä ketään pelaajaa. | Kuten *tunniste*, ja lisäksi 403 ilman pelaajan tunnistetta |
| valinnainen tunniste | Kenet tahansa. Kelvollinen pelaajan tunniste avaa oikean vastauksen. | Ei mitään: ilman tunnistetta reitti antaa kiinteän tyhjän vastauksen |
| tiliavain | Minkä tahansa kelvollisen tiliavaimen, ylläpitäjän tai muun | 401 |
| ylläpitäjän avain | Ylläpitäjän tiliavaimen suoralta kutsujalta | 403 minkä tahansa välityspalvelimen kautta, 401 puuttuvalle tai tuntemattomalle avaimelle, 403 muulle kuin ylläpitäjälle |
| rekisteröitynyt | Kenet tahansa. Kelvollinen tiliavain tai olemassa olevan tilin kelvollinen tunniste saa täyden vastauksen. | Ei mitään |

Etenemisreitteihin liittyy kolme lisämerkintää. **Oikea eteneminen on oletuksena päällä jokaisella
tilillä.** Asetuksella `PROGRESSION_MODE=stub` sen säilyttävät vain `PROGRESSION_REAL_ACCOUNTS`-asetuksessa
luetellut tilit, ja kaikki muut saavat alkuperäisen projektin kiinteät maksimitasot
([Päivitysohjeet]({{ upgrade_page.url | relative_url }}) selittävät valinnan).

| Merkintä | Merkitys |
|:---------|:---------|
| vain oikea | Reitti on olemassa vain tileille, joilla on oikea eteneminen. Muille tileille se päätyy tyhjään 404-vastaukseen jo ennen kuin mitään tunnistetietoa tarkistetaan. |
| oma | Oikeassa etenemisessä pelaajan tunnisteella saa lukea vain omaa tiliään (polun `:userId`); jonkun muun tili saa vastauksen 403. Pelipalvelin saa lukea minkä tahansa tilin. |
| pelipalvelin | Oikeassa etenemisessä vain pelipalvelin saa kirjoittaa; pelaajan tunniste saa vastauksen 403. Tämä estää pelaajia kirjoittamasta itse omaa etenemistään, oikeuksiaan (entitlements), odotusaikojaan, palkkiotehtäviään ja varustesarjapaikkojaan. |

## Metagamen käytännöt {#metagame-conventions}

- Polut täsmätään kirjainkoosta riippumatta, ja loppukauttaviiva ohitetaan, joten
  `/undaunted/api/register` päätyy `Register`-reitille. `HEAD` toimii jokaisella `GET`-reitillä.
- Metodi ja polku, jotka eivät vastaa mitään reittiä, saavat tyhjän 404-vastauksen ja lokirivin
  `Unstubbed route <METHOD> <path>`.
- Pyyntöjen rungot voivat olla JSONia (enintään 50 Mt) tai lomakemuotoisia (enintään Expressin
  oletus, 100 kt). Yhdyskäytävän kautta raja on 128 KiB.
- Jäsentymätön JSON reiteille `Register`, `CreateInvite`, `RenameUser`, `PartyInvite`, `Friends`,
  `GuildInvite` tai `DisbandGuild` saa vastauksen 400 `{"error": "bad_request", ...}`. Muilla
  reiteillä se saa Expressin HTML-muotoisen 400-sivun, ja muu odottamaton virhe saa Expressin
  HTML-muotoisen 500-sivun. Kummassakin on pinojälki (stack trace), ellei `NODE_ENV=production`.
- Jokainen pyyntö kirjataan lokiin muodossa `<METHOD> <path> gs=0|1` (`gs=1`, kun pyynnössä on
  pelipalvelinavain), ja polussa olevat tunnisteet korvataan. `LOG_REQUESTS=0` kytkee tämän pois.
  `LOG_BODIES=1` kirjoittaa lisäksi joidenkin pelireittien rungot (muun muassa ryhmä-, kaveri-,
  kilta-, kauppa-, Escalation- ja Slayer Link -reittien sekä reittien `/account/mapping` ja
  `/accountinfo/public`) tiedostoon `BODY_LOG_FILE` (oletus `bodies.log`), rivi pyyntöä kohden, kun
  siihen on vastattu, vastauksen tilan ja keston kanssa ja tunnisteet ja tiliavaimet poistettuina.
  `BODY_LOG_PER_PATH` rajoittaa rivejä polkua kohden. Tiedostossa on silti pelaajien tietoja: pidä se
  yksityisenä.
- `/progression`-alkuinen pyyntö, johon mikään reitti ei vastaa, kirjataan varoituksena
  (`Unhandled progression request <METHOD> <polku> from a game server` tai `from a player`) ennen
  tavallista 404-vastausta.
- Monet pelireitit vastaavat `{"code": null, "message": "OK", "payload": ...}`, kuten alkuperäinen
  taustapalvelu. [Taustapalvelun rajapinta]({{ contract_page.url | relative_url }}) kertoo muodot,
  joita peliohjelma odottaa.
- Nämä asetukset vaikuttavat siihen, mitkä reitit vastaavat. Jokainen vaatii uudelleenkäynnistyksen;
  yksityiskohdat ovat [asetusten viitesivulla]({{ config_page.url | relative_url }}).

| Asetus | Oletus | Vaikutus reitteihin |
|:-------|:-------|:--------------------|
| `MISC_ROUTES` | puuttuu: päällä | `0` palauttaa alkuperäisen projektin 404-vastauksen reitteihin `GET /motd/trigger`, `POST /candidate/player/alive` ja kaveripalvelun neljään lukureittiin (kaverilista, estolista, viimeaikaiset pelaajat, asetukset). |
| `MATCHMAKING_CANCEL` | puuttuu: pois | `1` saa reitit `DELETE /candidate` ja `DELETE /candidate/leave` vastaamaan; muuten ne saavat vastauksen 404. |
| `PROGRESSION_MODE` | puuttuu: oikea | `stub` antaa jokaiselle tilille, jota ei ole lueteltu `PROGRESSION_REAL_ACCOUNTS`-asetuksessa, alkuperäisen projektin kiinteät vastaukset, ja *vain oikea* -reitit vastaavat niille 404. Muu arvo kuin `stub` tai `real` kirjataan lokiin, ja sitä kohdellaan kuten oikeaa etenemistä. |
| `PROGRESSION_CONFIRM` | puuttuu: päällä | `off` saa tason vahvistuksen vastaamaan 404. |
| `PROGRESSION_ALLOW_DELETE` | puuttuu: pois | `1` sallii pelipalvelinten nollata radan. |
| `STATUS_EXTRA` | puuttuu: päällä | `0` karsii `/dauntless-status`-vastauksen niihin yhdeksään kenttään, jotka peliohjelma lukee. |
| `ACCOUNT_DISPLAY_NAME` | puuttuu: päällä | `0` palauttaa alkuperäisen projektin `{}`-arvon `displayName`-kentäksi tilitietueeseen ja ryhmävastauksiin. |
| `ACCOUNT_MAPPING` | puuttuu: päällä | `0` saa reitin `POST /account/mapping` yhdistämään ei mitään (`accountMappings: {}`), kuten ennen. |
| `ACCOUNTINFO_PUBLIC_LEGACY` | puuttuu: pois | `1` palauttaa alkuperäisen projektin `POST /accountinfo/public` -vastauksen: pyytäjän oma tunnus ja tuntemattomalle tunnukselle 200 tyhjällä nimellä. |
| `GUILDS` | puuttuu: päällä | `0` palauttaa vanhat kiltatyngät (`GET /guild` 204, `GET /guild/invite/player` tyhjä lista); kaikki muut kiltareitit ja hallintarajapinnan kolme kiltareittiä vastaavat 404. |
| `ESCALATION_MODE` | puuttuu: `stub` | `real` tallentaa Escalationin oikean etenemisen tileille: `GET /escalation/...` lukee tallennetun kauden, ja `POST /escalation/...` on olemassa (muuten 404). |
| `STORE` | puuttuu: `off` | `free` ottaa käyttöön neljä kauppareittiä; arvolla `off` kauppa vastaa vanhan 400:n ja kolme ostoreittiä 404. |
| `STORE_REPEATABLE_TOKENS` | puuttuu: pois | `1` näyttää ja myy palkkiotehtävien tunnisteiden paketin (vain kun `STORE=free`). |
| `SLAYER_LINKS` | puuttuu: päällä | `0` saa jokaisen `/slayerlink`-reitin vastaamaan 404, kuten ennen. |
| `VERIFY_STUB_ACCOUNT` | puuttuu: pois | `1` palauttaa kiinteän paikkamerkki-`account_id`:n vastaukseen `GET /account/api/oauth/verify`. |
| `BALANCE_FROM_INVENTORY` | puuttuu: päällä | `0` palauttaa kiinteän valuuttataulukon vastauksiin `GET /balance` ja `POST /reconcile`. |
| `PROGRESSION_REPLAY_WINDOW_S` | puuttuu: `5` | Reitin `POST /progression/:userId` uusintavahti; `0` kytkee sen pois. |
| `PROGRESSION_CONFIRM_ENTITLEMENTS` | puuttuu: pois | `1` saa tason vahvistuksen antamaan myös tason pysyvät oikeudet asetuksista. |

## Metagame: pelireitit {#game-routes}

**Yhdyskäytävän kautta:** jokainen tämän osion reitti välitetään. Kirjautuminen lasketaan
yhdyskäytävän *token*-pyyntörajaan ja kaikki muu *general*-rajaan (katso [Yhdyskäytävä](#gateway)).
Yhdyskäytävä torjuu pyynnön, jossa on pelipalvelinavain, joten *pelipalvelin*-merkityt kirjoitukset
toimivat vain palvelinkoneella.

### Kirjautuminen ja tilit {#login-and-accounts}

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| POST | `/account/api/oauth/token` | ei mitään (avain on rungossa) | Kirjautuminen: `exchange_code` = tiliavain, vastauksena 24 tuntia voimassa oleva `access_token` (katso [Kirjautuminen](#login)). 400 tuntemattomalle avaimelle. |
| GET | `/account/api/oauth/verify` | valinnainen tunniste | Peliohjelman säännöllinen istunnon tarkistus. Kelvollisella pelaajan tunnisteella: `{"active": true, ...}`, jonka `account_id` on pelaajan oma tili. Ilman tunnistetta tai virheellisellä, vanhentuneella tai vieraalla tunnisteella: vanha kiinteä vastaus paikkamerkki-`account_id`:llä, silti 200 (ei koskaan 401; huono tai vanhentunut tunniste kirjataan enintään kerran minuutissa). `expires_at` pysyy kaukana tulevaisuudessa. `VERIFY_STUB_ACCOUNT=1` antaa paikkamerkin kaikille. |
| DELETE | `/account/api/oauth/sessions/kill` | ei mitään | Vastaa `{}`. Ei peru mitään. |
| DELETE | `/account/api/oauth/sessions/kill/:token` | ei mitään | Sama. Polussa oleva tunniste korvataan merkinnällä `<token>` metagamen ja yhdyskäytävän lokeissa. |
| GET | `/account/api/public/account` | tunniste | Ilman kyselyä: pyytäjän oma Epic-tyylinen tilitietue, `displayName` = käyttäjänimi. Kyselyllä `?accountId=A&accountId=B` (enintään 100): taulukko `{id, displayName, externalAuths}` niistä tileistä, jotka ovat olemassa. |
| GET | `/account/api/public/account/:accountId` | valinnainen tunniste | Tunnisteen kanssa: kyseisen tilin `{id, displayName, externalAuths}`, tai `{}`, jos tiliä ei ole. Ilman tunnistetta: `{}`. |
| GET | `/account/api/public/account/displayName/:name` | valinnainen tunniste | Etsii tilin käyttäjänimellä kirjainkoosta riippumatta. Löytääkseen jotain se tarvitsee tunnisteen; muuten, tai jos mikään ei täsmää, 404. |
| GET | `/account/api/public/account/:accountId/externalAuths` | ei mitään | Vastaa `{}`. |
| POST | `/account/mapping` | valinnainen tunniste | Peliohjelman tilien yhdistämishaku (`QueryAccountMappingsEndpoint`): Epic-tilitunnuksista Phoenix-tilitunnuksiksi. Se ajetaan kaverin lisäämisessä (nimihaun jälkeen), chatin komennossa `/invite <nimi>`, killan jäsenen lisäyskentässä, jokaiselle kaverilistan ja estolistan tunnukselle sekä kirjautuessa pelaajan omalle tunnukselle (ohjelmatiedoston lokiteksti ja 2.1.1-tallenne; 1.4.4-reittiluettelossa on 6 kutsua 8 kirjautumisessa, niistä 2 kaverin lisäyksiä, joten ei jokaisella kirjautumisella). Runko `{"srcAccountType": "epic", "ids": ["<tunnus>", ...]}` (enintään 100 tunnusta, kukin kerran; aiemmat arvaukset toimivat yhä: pelkkä taulukko, `externalIds`, `accountIds` tai `externalAuthIds` sekä `type`/`externalAuthType`). Vastaus `{"accountMappings": {"<kysytty tunnus>": {"accountId": "<tunnus>", "accountType": "phoenix"}}, "code": "OK", "message": "", "payload": {"accountMappings": {...}}}`: olio, jonka avaimina ovat kysytyt tunnukset. Tätä muotoa peliohjelma lukee; käärittyä kopiota se ei lue. Jokainen tunnus yhdistyy täällä itseensä (pelaajan Epic-tunnus ja tilitunnus ovat samat). Kun `srcAccountType` on `phoenix`, merkinnöissä lukee `epic`. Tunnukset, jotka eivät ole tämän palvelimen tilejä, jätetään pois, ja ilman kelvollista tunnistetta olio on tyhjä. `ACCOUNT_MAPPING=0` ei yhdistä mitään. Lokiin kirjataan rungon rakenne ja `-> N of M mapped`. Aiemmat vastaukset (tunnuksilla avattu olio ilman `accountMappings`-avainta, sitten `accountMappings` taulukkona) eivät yhdistäneet peliohjelmassa mitään; katso [Kaverit, ryhmät ja killat]({{ social_page.url | relative_url }}). |
| GET | `/features/platform/win` | ei mitään | Alustaliput: `crossplay` ja `crossprogression` ovat true. |
| GET | `/account/link/epic/:accountId` | ei mitään | Vastaa `isLinked: true`. |
| POST | `/login` | tunniste | Kirjautumisjono. Rungon `email`-kentän on oltava sama kuin tunnisteen tilitunnus, ja tilin on oltava olemassa (muuten 400). Vastaa `{"error_code": "TicketRateOk", "state": "OPEN", ...}`. |
| GET | `/accountinfo` | tunniste | Pyytäjän `accountId` ja `username`, muissa kentissä kiinteät arvot. |
| GET | `/tags` | tunniste | `{accountId, tags: []}`. |
| PUT | `/gamesession/epic` | tunniste | Palauttaa pyytäjän oman bearer-tunnisteen kentässä `payload.sessionToken`. Vastauksessa on siis tunniste. |
| POST | `/accountinfo/public` | tunniste | Toisen pelaajan käyttäjätiedot, joita peliohjelma tarvitsee ennen kuin se näyttää pelaajan missään (ryhmäkutsun lähettäjä, ryhmän jäsenet ja Hunt Members, kaverit, estetyt pelaajat, killan jäsenet). Runko `{"accountId": "<tunnus>"}` tai `{"displayname": "<nimi>"}` (mikä tahansa kirjainkoko; `accountId` voittaa, jos molemmat annetaan). Vastaus `{accountId, username, linkedAccounts: [{accountId, accountType: "epic"}], isSubscribed: true, language: null}` **kysytystä** tilistä: peliohjelma tallentaa vastauksen sen `accountId`-tunnuksen alle. 404 `{}` tuntemattomalle tunnukselle tai nimelle. Kuka tahansa kirjautunut pelaaja voi katsoa minkä tahansa tilin. Alkuperäinen projekti vastasi pyytäjän omalla tunnuksella, minkä vuoksi muut pelaajat eivät koskaan näkyneet; `ACCOUNTINFO_PUBLIC_LEGACY=1` palauttaa sen. Jokainen haku kirjataan lokiin muodossa `accountinfo/public by <pyytäjä> for <tunnus> -> found` (tai `-> 404`). |

### Tila, elonmerkki ja pienet kiinteät vastaukset {#status-heartbeat-and-small-fixed-replies}

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/dauntless-status` | ei mitään | Tilailmoitus, jonka peliohjelma näyttää (`show-status` ja tervetulotoivotus palvelimen nimellä, `Welcome to <SERVER_NAME>!`, kahdeksalle kielelle käännettynä), sekä `name`, `version`, `commit` ja `sourceUrl` (AGPL-lähdekoodilinkki), ellei `STATUS_EXTRA=0`. Ei pelaajatietoja. Palvelimen skriptit käyttävät sitä terveystarkistuksena. |
| POST | `/heartbeat` | tunniste | Runko `{map, state?}`, 20 sekunnin välein. Merkitsee pelaajan paikalla olevaksi 90 sekunniksi ja pitää hänet ryhmässään. Vastaa tekstillä `20000`. Pelipalvelimen elonmerkki ilman pelaajan tunnistetta ei kirjaa mitään. Yhdyskäytävän kautta 2xx-vastaus pyyntöön, jossa on bearer-tunniste, avaa peliportit pelaajan osoitteelle, joten puuttuvan tai väärän tunnisteen on saatava 401 (testi vartioi tätä). |
| POST | `/event` | ei mitään | Telemetrian nielu. Vastaa `{}`. |
| POST | `/account/migrate` | tunniste | Vastaa `{migration_failed: false, migration_finished: true}`. |
| POST | `/profile/update` | tunniste | Tyhjä 200 (tulostaulukon profiili). |
| GET | `/vivox/login` | tunniste | Tarkoituksella 404: äänichat-palvelu on poissa. |
| POST | `/motd/` | tunniste | 204: ei päivän viestiä. |
| GET | `/motd/trigger` | ei mitään | 204: ei metsästyksen jälkeisiä uutisia. 404 asetuksella `MISC_ROUTES=0`. |
| GET | `/playertreatments/:userId` | tunniste | Kiinteä kohorttilista. |
| GET | `/eventstats/` | tunniste | Vastaa `{stats: []}`. |
| GET | `/all/` | tunniste | Tyhjä postilaatikko. |
| GET | `/game_tuning/seasonal_event_schedule` | ei mitään | Ei ajastettuja tapahtumia. |
| GET | `/game_tuning/huntpass_xp_config` | ei mitään | Hunt Passin XP-asetukset (`MaxXPAwarded` 200). |

### Hahmot, tavaraluettelo ja valuutta {#characters-inventory-and-currency}

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/character` | tunniste | Pyytäjän hahmot (pelkkä taulukko). Tili, jolla ei ole hahmoja, saa yhden, joka nimetään käyttäjänimen mukaan. |
| PUT | `/character` | tunniste | Luo pyytäjälle hahmon `{name}`. |
| POST | `/character` | tunniste | Tallentaa `{characterId, data, updateVersion}` pyytäjän omalle hahmolle optimistisella versioinnilla: 400 virheelliselle versiolle tai datalle, 404 jonkun toisen hahmolle, 409 versioristiriidalle. Jokainen tallennus menee tallennushistoriaan. |
| GET | `/inventory/:userId/:characterId` | tunniste | Hahmon tavaraluettelo. Pelaaja saa aina oman tilinsä luettelon, sanoi URL mitä tahansa; pelipalvelin saa URL:n tilin luettelon. |
| POST | `/inventory` | tunniste | Yksi tavaraluettelotapahtuma: `{characterId, transactionId, addInstancedItems, addStackedItems, removeInstancedItems, removeStackedItems, saveInstancedItems, source}`, sekä pelipalvelimelta `accountId` (pelaajalta se ohitetaan). Toistuva `transactionId` saa tallennetun vastauksen eikä muuta mitään. `INVENTORY_REFUSE_OVERSPEND` ja `INVENTORY_REPORT_REMOVALS` säätävät toimintaa. |
| POST | `/inventory/instanceditem` | tunniste | Päivittää yhden esineen: `{characterId, instanceId, catalogId, itemData, updateVersion}`, sekä pelipalvelimelta `accountId`. |
| POST | `/inventory/:characterId/:changeList` | tunniste | Tavaraluettelon siirron tynkä. Vastaa `{code: null, message: ""}`. |
| POST | `/reconcile` | tunniste | `{balances: {id_currency_notes, CURRENCY_NOTES}, refreshInventory: true}`. Kun `BALANCE_FROM_INVENTORY` on päällä (oletus), jokainen avain on kyseisen valuutan pinon määrä (`CURRENCY_NOTES` eli Ramsit) tilin aktiivisen hahmon tavaraluettelossa (viimeksi tallennettu hahmo); valuutta, jota hahmolla ei ole, pitää vanhan arvonsa (taulun `users` notes-sarake). `0`: vain vanhat arvot. |
| GET | `/balance` | tunniste | Valuuttataulukko: samat 52 avainta kuin ennen (kumpikin kirjoitusasu, `CURRENCY_X` ja `id_currency_x`). Kun `BALANCE_FROM_INVENTORY` on päällä, jokainen avain, jonka `CURRENCY_*`-pino aktiivisella hahmolla on, kertoo sen määrän; muut pitävät vanhat arvonsa (notes tietokannasta, 25 asepolettia (weapon token), muut 0). Avaimia ei lisätä, poisteta eikä järjestetä uudelleen. `CURRENCY_PLATINUM_UNIV` ei ole mukana. `0`: vanha kiinteä taulukko. |
| GET | `/creator` | tunniste | Kiinteä support-a-creator-vastaus. |

### Kauppa {#store}

Pelin kauppa ([Pelin kauppa]({{ '/fi/findings/store.html' | relative_url }})). **Vain asetuksella
`STORE=free`**; asetuksella `STORE=off` (oletus) kauppa vastaa vanhan 400:n
(`{"code": "400", "message": "The store is not available on Dauntless Revived yet."}`) ja kolme muuta
reittiä tyhjän 404:n. Jokainen reitti toimii bearer-tunnisteen pelaajan puolesta: ilman tunnistetta 401,
pelkkä pelipalvelinavain 403. Torjunnat ovat muotoa `{"code": "<tila>", "message": ...}`.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/product/skus/public?requiredTags=<tunniste>` | pelaaja | Yhden tunnisteen tarjoukset pelkkänä taulukkona, jokaisella `remaining` (0, kun aktiivisella hahmolla on jokainen tarjouksen tavara ja jokainen sen oikeus on voimassa). Kauppanäkymä pyytää tunnistetta `webstore` (200 tarjousta; Elite-passi on tunnisteen `season09b_pass` alla). Tuntematon tunniste on `[]` ja varoitus; puuttuva tunniste on 400. |
| GET | `/product/sku/:skuId` | pelaaja | Yksi tarjous mistä tahansa tunnisteesta; 404 tuntemattomalle (tai palkkiotehtävien tunnistepaketille, kun `STORE_REPEATABLE_TOKENS` on pois). |
| GET | `/token/:currency/:skuId` | pelaaja | `{purchaseToken}`: 64 heksamerkkiä, voimassa 10 minuuttia, sidottu tilin aktiiviseen hahmoon ja tarjoukseen sellaisena kuin se nyt on (rivi taulussa `storepurchases`, joka tallentaa vain tunnisteen SHA-256-tiivisteen). `currency` on oltava `platinum` (400); vain sallittujen tavaroiden ilmaisia tarjouksia myydään (409); 404 tuntemattomalle tarjoukselle; 409, kun tilillä ei ole hahmoa, sillä on jo kaikki, mitä tarjous antaa, tai se on saanut 60 tunnistetta viimeisten 10 minuutin aikana. |
| POST | `/notification/:currency?token=<tunniste>` | pelaaja | Lunastaa tunnisteen ja vastaa 204 ilman runkoa. Yhtenä tapahtumana: tavarat tavaraluettelon ytimen kautta (kutsuja `store`, lähde `store:<tarjous>`, tapahtuman tunnus `store:<tunnisteen tiiviste>`; tavarat, jotka hahmolla jo on, ohitetaan), oikeudet oikeuksien myöntökoodin kautta (lähde `store:<tarjous>`), ja sitten tunniste merkitään lunastetuksi. 403 toisen tilin tai tuntemattomalle tunnisteelle tai sellaiselle, jonka hahmo ei enää kuulu tilille; 410 vanhentuneelle; 409, kun tarjous muuttui tai sitä ei enää myydä; 400 virheelliselle tunnisteelle tai muulle valuutalle. Jo lunastettu tunniste saa taas vastauksen 204 eikä anna mitään. |

Ostotunniste poistetaan jokaiselta lokiriviltä (pyyntöloki ei koskaan kirjaa kyselymerkkijonoa,
yhdyskäytävä peittää `token=`-arvon, ja runkoloki peittää sen myös).

### Eteneminen, Hunt Pass, oikeudet, odotusajat ja palkkiotehtävät {#progression-hunt-pass-entitlements-cooldowns-and-bounties}

Oikeassa etenemisessä (oletus) nämä reitit tallentavat ja lukevat kunkin tilin omia tietoja.
Tynkätilassa reitit, joilla on *Tynkä:*-huomautus, vastaavat sen sijaan alkuperäisen projektin
kiinteillä vastauksilla, ja *vain oikea* -reitit vastaavat 404. Merkinnät selitetään kohdassa
[Pääsymerkinnät](#access-labels).

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/progression/config` | tunniste | Etenemisen asetukset (radat ja tasot) metagamen omasta kopiosta pelin asetuksista, tai asetuksella `PROGRESSION_CONFIG_DIR` kyseisen kansion kausitiedostoista (tarkistetaan käynnistyksessä; katso [Pelin asetukset]({{ game_page.url | relative_url }}#hunt-pass-seasons)). Ilman kansiota tavut ovat ennallaan. |
| GET | `/progression/:userId` | tunniste, oma | Jokainen rata, tallennettuna tai nollassa. Tynkä: kiinteät maksimitasot pyytäjälle. |
| POST | `/progression/:userId` | tunniste, pelipalvelin | Tallentaa etenemisen lisäyksen `{progress_tracks, objectives}` ja vastaa uusilla kokonaismäärillä. `PROGRESSION_GRANT_CAP` (5000) rajoittaa, mitä yksi pyyntö voi lisätä rataan; ylimenevä osa leikataan ja kirjataan lokiin. **Uusintavahti:** runko, joka on tavu tavulta sama kuin tilin edellinen myöntö, alle `PROGRESSION_REPLAY_WINDOW_S` sekuntia sen jälkeen (oletus 5) eikä välissä ole muuta radan kirjoitusta, saa tuon myönnön tallennetun vastauksen eikä lisää mitään (tapahtumariviin tulee merkintä). Tallennettua pienempi tavoite kirjataan lokiin ja tallennetaan lähetettynä. Toisen tilin välitetty pelaajan tunniste kirjataan, ei koskaan hylätä. Tynkä: aina tarkoituksella 400 (mikä tahansa muu saa peliohjelman toistamaan mestaruusilmoitustaan loputtomiin). |
| GET | `/progression/:userId/:progressionId` | vain oikea, tunniste, oma | Yksi rata; 404, jos mitään ei ole tallennettu. |
| POST | `/progression/:userId/:progressionId/:amount` | vain oikea, tunniste, pelipalvelin | Lisää yhteen rataan määrän `amount`, enintään `PROGRESSION_GRANT_CAP`. |
| POST | `/progression/:userId/:progressionId/:rank/confirm/:kind` | vain oikea, tunniste, pelipalvelin | Vahvistaa ilmaisen (`public`) tai premium-tason. Se ei anna mitään: pelipalvelin maksaa tasopalkinnot itse reitin `/inventory` kautta. Asetuksella `PROGRESSION_CONFIRM_ENTITLEMENTS=1` tasoa nostava vahvistus antaa myös juuri vahvistettujen tasojen pysyvät oikeudet asetuksista (ei koskaan tavaroita, valuuttoja tai määräaikaisia); vastaus on sama. 404 asetuksella `PROGRESSION_CONFIRM=off`. |
| DELETE | `/progression/:userId/:progressionId` | vain oikea; ylläpitäjän avain, tai pelipalvelinavain asetuksella `PROGRESSION_ALLOW_DELETE=1` | Nollaa yhden radan. Jos `x-undaunted-user-api-key` on mukana, sovelletaan ylläpitäjän avaimen tarkistusta. Muuten tarvitaan pelipalvelinavain ja `PROGRESSION_ALLOW_DELETE=1` (ilman niitä 403). Peli lähettää tämän vain vianetsintäkomennosta. |
| GET | `/progression/objectives/:userId` | tunniste, oma | Tallennetut tavoitteet (objectives). Tynkä: mestaruusradat maksimissa eikä tavoitteita. |
| GET | `/progression/objectives/:userId/:objectiveId` | tunniste, oma | Yksi tavoite, nollat, jos mitään ei ole tallennettu. Tynkä: kiinteät arvot. |
| GET | `/huntpass/:userId` | tunniste, oma | Valittu Hunt Pass: tallennettu, muuten `ACTIVE_HUNT_PASS` (oletus `season09b`). |
| POST | `/huntpass/:userId` | vain oikea, tunniste, pelipalvelin | Tallentaa Hunt Pass -valinnan. |
| GET | `/escalation/:season/:userId` | tunniste; oma asetuksella `ESCALATION_MODE=real` | `ESCALATION_MODE=stub` (oletus) sekä tynkäetenemisen tilit: kiinteä vastaus `{code: null, message: "OK", payload: {escalation_level: 99999, next_level_xp: 99999, talents_progress: [], unlock_progress: [], update_version: 1}}` kenelle tahansa, mitään ei tallenneta. `real`: tallennettu kausi samassa kuoressa tai taso 0 ja versio 0, jos mitään ei ole tallennettu (luku ei luo riviä); 404 `{code: "404", ...}` kaudelle, jota ei ole luettelossa ([Escalation]({{ '/fi/findings/escalation.html' | relative_url }})). |
| POST | `/escalation/:season/:userId` | vain asetuksella `ESCALATION_MODE=real`; vain oikea, tunniste, pelipalvelin | Tallentaa koko kauden `{escalation_level, next_level_xp, talents_progress: [{rank, talent_id}], unlock_progress: [{collected, reward_id}], update_version}` ja vastaa tallennetulla tilalla. 400 virheelliselle tallennukselle, 404 tuntemattomalle tilille tai kaudelle, 409 pois käytöstä olevalle kaudelle (Frost), vanhemmalle versiolle, samalle versiolle eri sisällöllä, alemmalle etenemiselle, palautetulle palkinnolle tai tallennukselle, jossa on vanhan tyngän arvot (taso 25 ja vähintään 99 999 XP:tä, ellei tallennettu kausi ole jo tasolla 25); sama versio samalla sisällöllä saa tallennetun tilan (uusinta). `ESCALATION_STRICT=1` torjuu (409) myös pehmeän säännön rikkovan tallennuksen. Jokainen tallennus, hyväksytty tai torjuttu, on rivi taulussa `progression_events`. Asetuksella `stub` reitti päätyy tyhjään 404-vastaukseen. |
| GET | `/entitlementsv2` | tunniste | Tunnisteen tilin oikeudet (pelipalvelimen on välitettävä pelaajan tunniste). Oikea: litteä `{entitlements: [...]}` ilman vanhentuneita. Tynkä: tyhjä lista. |
| POST | `/entitlementv2/:userId` | tunniste, pelipalvelin | Myöntää `{entitlement, duration}` (tunteina; 0 tai puuttuva = pysyvä) ja vastaa tilin koko listalla. 404 tuntemattomalle tilille. Tynkä: tyhjä vastaus. |
| DELETE | `/entitlement/:userId/:entitlement` | vain oikea, tunniste, pelipalvelin | Peruu oikeuden. |
| GET | `/cooldown/:userId` | tunniste, oma | Kunkin odotusajan (cooldown) alkamisaika. Tynkä: tyhjä. |
| PUT | `/cooldown/batch/:userId` | tunniste, pelipalvelin | Tallentaa `{cooldowns: [{cooldown_id, cooldown_started_date}]}`. Tynkä: tyhjä vastaus. |
| PUT | `/cooldown/:userId/:cooldownId` | vain oikea, tunniste, pelipalvelin | Käynnistää yhden odotusajan nyt (ei runkoa). |
| GET | `/bounty/game-data` | tunniste | Palkkiotehtävien kiinteät asetukset (4 paikkaa, tokenien tunnukset). Se on rekisteröity ennen reittiä `/bounty/:userId`, joten se voittaa. |
| GET | `/bounty/:userId` | tunniste, oma | Tallennettu palkkiotehtävätaulu. Tynkä: tyhjä taulu. |
| POST | `/bounty/:userId` | tunniste, pelipalvelin | Päivittää palkkiotehtäviä `bounty_id`:n mukaan (osittainen päivitys). Tynkä: tyhjä taulu. |
| POST | `/bounty/delete/:userId` | vain oikea, tunniste, pelipalvelin | Poistaa listan `{bounty_ids}` palkkiotehtävät. |
| GET | `/encountered-content/:characterId/:contentType` | tunniste | Yhden tyypin sisältö, jonka pyytäjän hahmo on kohdannut. 403 jonkun toisen hahmolle. |
| POST | `/encountered-content/query/:characterId` | tunniste | Sama listalle `{content_types}`. |
| POST | `/encountered-content/:characterId` | tunniste | Lisää `{content_type, content_id}`. |
| GET | `/breadcrumbs/:characterId` | tunniste | Hahmon käyttöliittymän murupolut (breadcrumbs). |
| POST | `/breadcrumbs/:characterId` | tunniste | Tallentaa `{breadcrumbs, updateVersion}`; 409 versioristiriidassa. |

### Varustesarjat {#loadouts}

Pelaaja rajataan aina omaan tiliinsä, sanoi URL mitä tahansa; pelipalvelin toimii URL:ssa nimetyn
tilin puolesta. Hahmon on kuuluttava sille tilille (muuten 404).

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/loadout/:userId/:characterId/all` | tunniste | Kaikki varustesarjat, pysyvät tiedot ja paikkamäärät. |
| POST | `/loadout/:userId/:characterId/:index` | tunniste | Tallentaa yhden varustesarjapaikan `{data}`. Oikea: mikä tahansa avattu paikka. Tynkä: vain paikka 0 ja `persistent`. Jokainen tallennus menee tallennushistoriaan. |
| POST | `/loadout/:userId/:characterId/unlock/:numSlots` | vain oikea, tunniste, pelipalvelin | Avaa `numSlots` paikkaa lisää. |
| GET | `/loadout/:userId/:characterId/slotcount` | vain oikea, tunniste | Paikkamäärät. |
| POST | `/loadout/:userId/:characterId/active/:index` | vain oikea, tunniste, pelipalvelin | Asettaa aktiivisen paikan. |

### Matchmaking {#matchmaking}

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| POST | `/candidate/join` | tunniste | Runko `{gameMode, gameArgs, playerHuntId}`. Syötteen tarkistuksen jälkeen se joko pyytää deploy-palvelimelta palvelimen heti (Ramsgate, Dojo, opetusjakso) tai laittaa pelaajan jonoon metsästystä varten. Metsästysryhmä sulkeutuu 4 pelaajalla tai kun 20 sekuntia kuluu ilman uusia tulijoita. Pelaaja on jonossa vain kerran: uusi liittyminen korvaa pelaajan vanhemman, yhä odottavan liittymisen, eikä deploy-palvelimelle koskaan kerrota samaa tiliä odotettavaksi kahdesti. Vastaa `{candidateId, gameMode, huntId, status: "MATCHING"}`. 400 virheelliselle syötteelle, tai kun `MATCHMAKING_MODE` on `DISABLED` tai puuttuu. Ryhmän johtajan liittyminen voi viedä koko ryhmän mukanaan. |
| POST | `/candidate/join/:candidateId` | tunniste | Ryhmän jäsen seuraa johtajan hakua (candidate); 404, jos haku ei ole hänen ryhmänsä. |
| GET | `/candidate/status` | tunniste | Peliohjelman tilakysely. `MATCHING`; `IN_PROGRESS` ja `serverInfo {buildId, gameSessionId, host, port}` (pelipalvelimen osoite asetuksesta `MY_IP`); tai `FAILED`, kun palvelinta ei saatu käynnistettyä. 404, kun pyytäjä ei ole jonossa. |
| DELETE | `/candidate` | tunniste | Peruutus. Oletuksena pois päältä (404), koska peliohjelma lähettää sen heti jokaisen liittymisen jälkeen; `MATCHMAKING_CANCEL=1` kytkee sen päälle. Ryhmän johtajan peruutus peruu myös ryhmän haun. |
| DELETE | `/candidate/leave` | tunniste | Vain pyytäjä poistuu hausta. Sama kytkin kuin reitillä `DELETE /candidate`. |
| POST | `/candidate/player/alive` | tunniste | Metsästyspalvelin kysyy, keitä pelaajia sen pitää yhä odottaa; reitti palauttaa saamansa `playerIds`-listan kentässä `expectedPlayerIds`. 404 asetuksella `MISC_ROUTES=0`. |
| POST | `/candidate/player/register` | tunniste | Vastaa `{}`. |
| GET | `/candidate/regions` | tunniste | Aluelista ping-testiä varten: `QOS_TARGET_URL`-asetuksen ainoa osoite, pingattuna 5 kertaa. |
| GET | `/QoS` | ei mitään | Pingin kohde, HTML-muotoinen "pong". Julkisessa tilassa `QOS_TARGET_URL` on pelaajan oma käynnistimen välitin, `http://127.0.0.1:61000/QoS`, joka välittää pingin yhdyskäytävän kautta. |
| POST | `/key/generate` | tunniste | Aina 400. |

### Ryhmät (party) {#parties}

Ryhmät ovat metagamen muistissa: uudelleenkäynnistyksen jälkeen jokainen on yhden hengen ryhmässä.
Jokainen toiminto tehdään tunnisteen oman tilin nimissä; URL:n tai rungon tunnukset vain nimeävät
toisen pelaajan tai ryhmän. Rajat: 4 pelaajaa ryhmässä, 8 odottavaa kutsua ryhmää kohden ja 10
vastaanottajaa kohden, ja kutsut vanhenevat 5 minuutissa. Pelaaja lähettää enintään 20 kutsua 10
minuutissa, ja kun joku hylkää hänen kutsunsa, hän ei voi kutsua tätä pelaajaa uudelleen 2 minuuttiin
(kumpikin 409 `{}`, jonka peliohjelma näyttää epäonnistumisena). Esto poistaa kahden pelaajan väliset
odottavat kutsut, eikä toisensa estäneiden pelaajien välistä kutsua koskaan listata eikä voi hyväksyä
(404). Yksin ryhmässään oleva pelaaja saa alkuperäisen projektin paikkamerkkiehdokkaan
(`candidateState: "QUEUED_FOR_START"`); `PARTY_SOLO_STUB=0` vastaa yhden hengen ryhmälle ilman
ehdokasta (katso [Asetukset]({{ config_page.url | relative_url }}#metagame-social)).

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| POST | `/party` | pelaaja | Ryhmän tilakysely noin 10 sekunnin välein: pelaajan oma ryhmä tai yhden hengen ryhmä. |
| GET | `/party/invites` | valinnainen tunniste | Pelaajalle osoitetut odottavat kutsut. Ilman kelvollista tunnistetta: `{invitations: []}`. |
| PUT | `/party/invite` | pelaaja | Kutsuu pelaajan `{recipientPlayerId}` omaan ryhmään. Vain johtaja. |
| PUT | `/party/invite/accept/:inviteId` | pelaaja | Hyväksyy yhden pelaajalle itselleen osoitetuista kutsuista (peliohjelman lähettämä tunnus on ryhmän). Jos voimassa olevaa kutsua ei ole, toistunut hyväksyntä saa vastauksen 200 ja pelaajan ryhmän, kun pelaaja on jo vähintään kahden hengen ryhmässä ja tunnus on sen ryhmän tai toisen jäsenen; muuten 404. |
| DELETE | `/party/invite` | pelaaja | Hylkää kutsun tai peruu pelaajan itse lähettämän kutsun. |
| DELETE | `/party/member` | pelaaja | Pelaaja poistuu ryhmästään. |
| DELETE | `/party/member/:memberId` | pelaaja | Poistaa jäsenen. Vain johtaja. |
| PUT | `/party/member/promote/:memberId` | pelaaja | Tekee toisesta jäsenestä johtajan. Vain johtaja. |
| DELETE | `/party/leader/:leaderId` | pelaaja | Poistaa johtajan, josta kukaan ei ole kuullut 2 minuuttiin; muuten pyyntö ohitetaan. Aina 200. |
| POST | `/party/status` | pelaaja | `{playerIds}` (enintään 16): näiden pelaajien ryhmät ja pelaajalle itselleen osoitetut kutsut. |

### Kaverit {#friends}

Epic-tyylinen kaveripalvelu. Kaveruudet ja estot tallennetaan tietokantaan (kumpaakin enintään 200
tiliä kohden). Kaikki näkyvät offline-tilassa, ellei kavereiden paikalla olo ole päällä
[chat-palvelimessa](#chat) (`CHAT=1` ja `CHAT_PRESENCE=1`, oletuksena pois): paikalla olo tulee vain
chat-yhteyden läsnäolotiedoista. Kaveruuden purku tai esto peruu myös kahden pelaajan väliset
odottavat [Slayer Link](#slayer-links) -kutsut.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/friends/api/public/friends/:userId` | valinnainen tunniste | Pyytäjän omat kaverit, pelkkä taulukko `{accountId, status, direction, created}`; `?includePending=true` lisää odottavat pyynnöt. Ilman tunnistetta tai toisen tilin listalle: `[]`. 404 asetuksella `MISC_ROUTES=0`. |
| GET | `/friends/api/public/blocklist/:userId` | valinnainen tunniste | Pyytäjän oma estolista `{blockedUsers}`; muuten tyhjä lista. 404 asetuksella `MISC_ROUTES=0`. |
| POST | `/friends/api/public/friends/:userId/:friendId` | pelaaja | Lähettää kaveripyynnön tai hyväksyy sen, jonka `friendId` lähetti. |
| DELETE | `/friends/api/public/friends/:userId/:friendId` | pelaaja | Poistaa kaveruuden, peruu pyynnön tai hylkää sen. |
| POST | `/friends/api/public/blocklist/:userId/:friendId` | pelaaja | Estää tilin `friendId` ja poistaa kaveruuden heidän väliltään sekä ryhmä- ja kiltakutsut, joita kumpi tahansa on lähettänyt toiselle. |
| PUT | `/friends/api/public/blocklist/:userId/:friendId` | pelaaja | Sama kuin POST. Peliohjelman Block-toiminnon metodi on päätelty ohjelmatiedostosta mutta ei jäljitetty, joten kumpikin kelpaa. |
| DELETE | `/friends/api/public/blocklist/:userId/:friendId` | pelaaja | Poistaa tilin `friendId` eston. |
| GET | `/friends/api/public/list/:namespace/:userId/recentPlayers` | ei mitään | Vastaa `[]`. 404 asetuksella `MISC_ROUTES=0`. |
| GET | `/friends/api/v1/:userId/settings` | ei mitään | Vastaa `{acceptInvites: "public"}`. 404 asetuksella `MISC_ROUTES=0`. |

Muuttavat reitit vastaavat 204 ilman runkoa. `:userId`-arvon on oltava pyytäjä itse (muuten
403). `friendId`, joka ei ole tilitunnuksen muotoinen, saa vastauksen 404. Kaveripyyntö ja esto
torjuvat lisäksi tuntemattoman tilin (404), oman tilin (400) ja 200:n rajan ylityksen (409), ja
kaveripyyntö torjuu parin, jossa toinen on estänyt toisen (403). Uusi kaveripyyntö torjutaan (409)
myös, jos pyytäjällä on jo 50 vastaamatonta lähetettyä pyyntöä tai hän on lähettänyt 20 uutta pyyntöä
viimeisten 10 minuutin aikana; toisen pelaajan lähettämän pyynnön hyväksymistä ei rajoiteta.
Kaveruuden tai eston poisto, jota ei ole olemassa, vastaa silti 204.

Peliohjelma lukee kummankin listan vain kirjautuessa, joten uusi tai hyväksytty kaveripyyntö näkyy
toiselle pelaajalle vasta hänen seuraavalla kirjautumisellaan. Sivu
[Kaverit, ryhmät ja killat]({{ social_page.url | relative_url }}) kertoo, mitä pelaaja näkee missäkin
vaiheessa.

### Killat {#guilds}

1.4.4-peliohjelman kiltarajapinnan versio 2, tallennettuna tietokantaan (taulut `guilds`,
`guildmembers` ja `guildinvites`, katso [Tiedostot ja data]({{ files_page.url | relative_url }})),
joten killat ja kutsut säilyvät uudelleenkäynnistysten yli.

- **Vastaukset** ovat Phoenixin kuori `{"code", "message", "payload"}`. Vastaus, jossa on kilta tai
  kutsulista, kopioi lisäksi rungon (`payload`) kentät juureen. Onnistuneessa vastauksessa on aina
  JSON-runko: peliohjelma pitää onnistumista ilman runkoa epäonnistumisena. Ainoa tyhjä vastaus on
  `GET /guild` -reitin 204, joka tarkoittaa "ei kiltaa".
- **Torjunnat** ovat 4xx-vastauksia muodossa `{"code": "<koodi>", "message": "<teksti>", "payload": {}}`.
  Peliohjelma muuttaa koodin omaksi virheekseen ja näyttää oman tekstinsä; tyhjä koodi näkyy tekstinä
  "Unable to create guild."
- **Kiltaolio** on `{id, name, nameplate, leader_account_id, members: [{phx_account_id, rank}],
  maximum_guild_members}`. Arvot ovat `Leader` (johtaja), `Officer` (upseeri) ja `Member` (jäsen)
  tässä järjestyksessä ja sen jälkeen liittymisajan mukaan. `maximum_guild_members` on
  `GUILD_MAX_MEMBERS` (oletus 100), numerona.
- **Mitään ei lähetetä pelaajille itsestään.** Muut jäsenet ja kutsutut näkevät muutoksen seuraavalla
  kirjautumisellaan tai maailman latautuessa (peliohjelma lukee silloin `GET /guild`- ja
  `GET /guild/invite/player` -reitit, samoin jokaisen oman kiltatoimintonsa jälkeen).
- `GUILDS=0` palauttaa kahden lukureitin vanhat tyngät, ja jokainen muu kiltareitti vastaa 404.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/guild` | tunniste | Pyytäjän kilta: 200 ja kiltaolio sekä käärittynä että litteänä. 204 ilman runkoa, kun pyytäjä ei ole missään killassa (myös pelipalvelinavaimelle ilman pelaajan tunnistetta). |
| GET | `/guild/invite/player` | tunniste | Pyytäjän avoimet kutsut uusin ensin: `{code: "OK", message: "", payload: {invites}, invites}`, jokainen muodossa `{id, guild_id, guild_name, inviter_account_id}`. |
| POST | `/guild/validate` | pelaaja | `{leader_account_id, name, nameplate}`, lähetetään, kun pelaaja kirjoittaa CREATE A GUILD -ikkunaan. Tarkistaa alla olevat säännöt tunnisteen tilille (eri `leader_account_id` vain kirjataan lokiin) ja vastaa `{code: "OK", message: "", payload: {}}` tai torjunnalla. Ei luo mitään. |
| POST | `/guild` | pelipalvelinavain | Perustaminen. Create-painike lähettää etäkutsun (RPC) Ramsgaten pelipalvelimelle, joka lähettää saman rungon tänne avaimellaan. Vastaa uudella kiltaoliolla. Katso alta. |
| DELETE | `/guild/player` | pelaaja | Leave Guild. Jäsen tai upseeri lähtee; johtaja ei voi lähteä (409 `ChiefAdorableQuillshot`). |
| DELETE | `/guild/player/:accountId` | pelaaja | Kick From Guild. Vain johtaja. Oman tunnuksen antaminen tarkoittaa lähtemistä. |
| PUT | `/guild/invite/:accountId` | pelaaja | Invite to Guild, ei runkoa. Johtaja tai upseeri. |
| POST | `/guild/invite/accept/:inviteId` | pelaaja | Hyväksyy yhden pyytäjälle osoitetuista kutsuista: pyytäjä liittyy jäseneksi, ja kaikki hänen muut kutsunsa poistetaan. |
| DELETE | `/guild/invite/:inviteId` | pelaaja | Hylkää yhden pyytäjälle osoitetuista kutsuista. |
| PUT | `/guild/rank/:accountId/:rank` | pelaaja | `member`, `officer` tai `leader` missä tahansa kirjainkoossa. Vain johtaja. `leader` luovuttaa killan, ja entisestä johtajasta tulee upseeri. Jo olemassa olevan arvon asettaminen ei muuta mitään. |
| DELETE | `/guild/:guildId` | pelaaja | DISBAND GUILD: pyytäjän oma kilta, sen jäsenet ja kutsut. Vain johtaja. |

`DELETE /guild/player` ja `DELETE /guild/player/:accountId` on rekisteröity ennen reittiä
`DELETE /guild/:guildId`, joka muuten sieppaisi ne.

**Nimet ja nimikyltit** tarkistetaan tässä järjestyksessä (ensimmäinen hylkäävä sääntö ratkaisee):

| Sääntö | Koodi | Tilakoodi |
|:-------|:------|:----------|
| Pyytäjä (perustettaessa johtaja) ei ole jo killassa | `OccupiedAdorableQuillshot` | 409 |
| Nimi: 4–15 englannin kirjainta ja numeroa, ei muuta | `ObedientAdorableQuillshot` | 400 |
| Nimi: enintään 6 numeroa | `NumberedAdorableQuillshot` | 400 |
| Nimi: sama kirjain enintään 6 kertaa peräkkäin kirjainkoosta riippumatta | `LetteredAdorableQuillshot` | 400 |
| Nimi: ei kieltolistan sanaa eikä lyhyttä loukkaavaa sanaa | `NastyAdorableQuillshot` | 400 |
| Nimi: ei varattua henkilökunnan tai projektin sanaa | `SeizedAdorableQuillshot` | 409 |
| Nimi: ei varattu kirjainkoosta riippumatta | `SeizedAdorableQuillshot` | 409 |
| Nimikyltti: tyhjä tai 2–6 englannin kirjainta ja numeroa | `DutifulAdorableQuillshot` | 400 |
| Nimikyltti: ei kieltolistan sanaa eikä lyhyttä loukkaavaa tunnusta | `DirtyAdorableQuillshot` | 400 |
| Nimikyltti: ei varattua henkilökunnan tai projektin sanaa | `CapturedAdorableQuillshot` | 409 |
| Nimikyltti: ei varattu kirjainkoosta riippumatta (tyhjä ei ole koskaan varattu) | `CapturedAdorableQuillshot` | 409 |

Kieltolista on lyhyt ja sisäänrakennettu; `GUILD_NAME_DENYLIST` lisää sanoja. Vertailu tehdään
pienaakkosina ja tavalliset numerokorvaukset (`0` kirjaimen `o` tilalla, `3` kirjaimen `e` tilalla ja
niin edelleen) purettuina, missä kohdassa tahansa tekstiä. Muutama lyhyt loukkaava sana (kuten `KKK`,
`SS` ja `1488`) torjutaan koko nimenä tai nimikylttinä (`KKK` missä tahansa).

**Varatut sanat** estävät kiltaa esiintymästä palvelimen henkilökuntana tai projektina. Ne vastaavat
"already in use" (`SeizedAdorableQuillshot` tai `CapturedAdorableQuillshot`), ja vertailu tehdään
pienaakkosina ja numerokorvaukset purettuina:

| Missä | Sanat |
|:------|:------|
| Missä tahansa nimessä tai nimikyltissä | `admin`, `moderator`, `official`, `gamemaster`, `staff`, `dauntlessrevived`, `phoenixlabs` |
| Koko nimenä | `dauntless`, `phoenix`, `revived`, `support`, `system`, `server`, `servers`, `mods`, `developer`, `developers`, `devteam` |
| Koko nimikylttinä | `gm`, `gms`, `dev`, `devs`, `mod`, `mods`, `sys`, `phx`, `dr`, `drev`, `undt` |

Siis `DauntlessCrew` ja `PhoenixRising` käyvät, mutta `Dauntless`, `ServerAdmins` ja nimikyltti `GM`
eivät (myös `Badminton` jää kiinni). `GUILD_RESERVED_NAMES=0` poistaa varatut sanat käytöstä,
esimerkiksi virallisen killan perustamista varten; loukkaavat sanat torjutaan silti.

**Perustaminen** (`POST /guild`) hyväksyy vain tämän koneen pelipalvelinavaimen: pelaajan tunniste
yksinään saa vastauksen 403 `{"code": ""}`, avain yhdyskäytävän tai muun välityspalvelimen kautta 403
ja rekisteröimätön avain 401. Pelipalvelin välittää sen johtajatunnuksen, jonka peliohjelma laittoi
etäkutsuunsa, mutta ei tämän pelaajan tunnistetta: mukana mahdollisesti tuleva tunniste on
pelipalvelimen oman kirjautumisen (ohjelmatiedosto ottaa palvelimen paikallisen käyttäjän
tunnisteen), joten se vain kirjataan lokiin, ja kelvoton tunniste ohitetaan (ei koskaan 500). Sen
jälkeen järjestyksessä:

1. `leader_account_id`:n on oltava tili (400, tyhjä koodi).
2. **Johtajan on pitänyt tarkistaa juuri tämä nimi ja nimikyltti** (`POST /guild/validate` omalla
   tunnisteellaan; ikkuna tekee sen pelaajan kirjoittaessa) viimeisten 15 minuutin aikana. Pelaajan
   viisi viimeksi tarkistettua paria kelpaavat, kirjainkoosta riippumatta. Muuten 403 tyhjällä
   koodilla (peliohjelmassa "Unable to create guild."), joka kirjataan lokiin tekstillä "no validate
   of this name and nameplate by the leader in the last 15 minutes"; nimi, jonka säännöt torjuvat
   joka tapauksessa, saa sen säännön koodin. Kukaan ei siis voi tehdä toisesta pelaajasta sellaisen
   killan johtajaa, jota tämä ei itse nimennyt. `GUILD_CREATE_ACTIVITY_FALLBACK=1` hyväksyy myös
   johtajan, joka tarkisti jonkin toisen nimen tai näkyi palvelimelle viimeisen minuutin aikana
   (ryhmäkysely, elonmerkki), ja kirjaa lokiin varoituksen; se on pois päältä, koska muokattu
   peliohjelma voisi silloin nimetä kenet tahansa paikalla olevan pelaajan.
3. Johtaja ei ole killassa (409 `OccupiedAdorableQuillshot`), ja yllä olevat nimisäännöt.
4. Enintään yksi uusi kilta johtajaa kohden 10 minuutissa (429, tyhjä koodi).

Onnistunut perustaminen kuluttaa johtajan tarkistamat nimet.

**Muut torjunnat:** ei killassa, tai kohde ei ole pyytäjän killassa: 404 `ExcludedAdorableQuillshot`.
Ei oikeutta (jäsen kutsuu, joku muu kuin johtaja erottaa, muuttaa arvoja tai lakkauttaa, johtajan oma
arvo): 403 `SlyAdorableQuillshot`. Itsensä tai jäsenen kutsuminen: 409 `ClonedAdorableQuillshot`.
Saman killan voimassa oleva kutsu: 409 `RedundantAdorableQuillshot`. Kilta on täynnä (kutsu ja
hyväksyminen): 409 `StuffedAdorableQuillshot`. Puuttuva, vanhentunut tai jonkun toisen kutsu: 404
`UninvitedAdorableQuillshot`. Tuntematon arvo: 400 `DocileAdorableQuillshot`. Tuntematon tili (404),
esto kumpaan tahansa suuntaan (403, viestillä, joka ei kerro syytä) ja rajat (429) vastaavat tyhjällä
koodilla.

**Rajat:** `GUILD_MAX_MEMBERS` jäsentä kiltaa kohden; kutsut ovat voimassa `GUILD_INVITE_TTL_DAYS`
päivää (7); 50 avointa kutsua kiltaa kohden ja 30 lähetettyä kutsua kutsujaa kohden tunnissa (429);
kun pelaaja hylkää killan kutsun, sama kilta ei voi kutsua häntä uudelleen 24 tuntiin (429);
pelaajalla on enintään 20 avointa kutsua (vanhin poistetaan; yhdeltä killalta niistä voi olla vain
yksi). Odottavat kutsut eivät varaa paikkaa. Toisen killan jäsenen voi kutsua, mutta hänen on
lähdettävä vanhasta killastaan ennen hyväksymistä (409 `OccupiedAdorableQuillshot`).

**Raukeavat kutsut:** esto poistaa kahden pelaajan väliset kiltakutsut. Upseerin kutsut poistetaan,
kun hänet alennetaan jäseneksi, erotetaan tai hän lähtee; johtajan kutsut säilyvät, kun hän luovuttaa
killan (hänestä tulee upseeri). Kutsulista jättää pois, ja hyväksyminen vastaa 404
`UninvitedAdorableQuillshot`, jokaisen kutsun, joka on toisensa estäneiden pelaajien välinen tai jonka
kutsuja ei ole enää killan johtaja tai upseeri.

### Slayer Links {#slayer-links}

Kaksi kaveria liittoutuu viikoksi (My Links -välilehti; miten peliohjelma lukee kunkin vastauksen,
kerrotaan sivulla [Kaverit, ryhmät ja killat]({{ social_page.url | relative_url }}#slayer-links)).
Tallennetaan tietokantaan (taulut `slayerlinkinvites` ja `slayerlinks`). Oletuksena päällä;
asetuksella `SLAYER_LINKS=0` jokainen alla oleva reitti päätyy tyhjään 404-vastaukseen, ja tallennetut
rivit säilyvät. Jokainen reitti toimii bearer-tunnisteen pelaajan puolesta (ilman tunnistetta 401,
pelkkä pelipalvelinavain 403); rungon tai polun tunnukset vain nimeävät toisen pelaajan. Vastaukset
käyttävät kuorta `{code: null, message: "OK", payload}`; torjunnat ovat muotoa
`{code: "<tila>", message, payload: null}`.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET | `/slayerlink/status_good` | pelaaja | `{invites, links, config: {link_duration_hours: 168, invite_expiry_hours: 24}}`: alla olevat kaksi listaa yhdessä, peliohjelman uutiskysely. |
| GET | `/slayerlink/invites` | pelaaja | `{invites: [{account_id, slot, direction, status, expires, link_id}]}`: pelaajan odottavat, voimassa olevat kutsut; `account_id` on toinen pelaaja, `direction` `Sent` tai `Received`, `status` `Pending`, `slot` lähettäjän paikka. |
| GET | `/slayerlink/links` | pelaaja | `{links: [{account_id, linked_account_id, slot, ends, link_id, prize_pool: []}]}`: käynnissä olevat linkit pelaajan paikan mukaan; kumpikin tunnusavain nimeää toisen pelaajan. |
| PUT | `/slayerlink/invite` | pelaaja | `{account_id, slot, action_source}`: kutsuu kaverin johonkin pelaajan paikoista (1–3, peliohjelman numerot). Vastaa `{link_id}`, kutsun tunnus; saman pelaajan kutsuminen uudelleen antaa saman tunnuksen. |
| POST | `/slayerlink/invite` | pelaaja | `{account_id, action, slot, action_source}`, jossa `action` on `accept` tai `reject` (kutsuttu; `account_id` on lähettäjä) tai `cancel` (lähettäjä; `account_id` on kutsuttu). Rungon `link_id` tai `invite_id` kokeillaan ensin. Hyväksyntä käyttää rungon paikkaa `slot`, jos se on vapaa, muuten ensimmäistä vapaata. Vastaa `{link_id}`; saman vastauksen toisto on taas 200. |
| DELETE | `/slayerlink/invites/:accountId` | pelaaja | Pelaajan omalla tunnuksella: peruu jokaisen pelaajan lähettämän kutsun ja hylkää jokaisen saadun. Toisen pelaajan tunnuksella: vain näiden kahden väliset kutsut. Vastaa `{}`. |
| DELETE | `/slayerlink/links` | pelaaja | `{account_id, slot, delete_pair}` (tai samat kyselyparametreina): päättää pelaajan linkin kyseisessä paikassa tai kyseisen pelaajan kanssa, kummaltakin pelaajalta. Vastaa `{}`, myös kun poistettavaa ei ollut. |
| POST | `/slayerlink/availability` | pelaaja | `{account_ids: [...]}` (enintään 50) → `{availability: [{account_id, available}]}`: keitä heistä pelaaja voisi nyt kutsua. |

Säännöt: kummankin pelaajan on oltava hyväksyttyjä kavereita, eikä kumpikaan saa olla estänyt toista
(403); 3 paikkaa pelaajaa kohden ja yksi odottava kutsu paikkaa kohden; enintään 20 uutta kutsua pelaajaa
kohden 10 minuutissa; kutsu on voimassa 24 tuntia ja
linkki 168 tuntia; kaveruuden purku tai esto peruu kahden pelaajan väliset odottavat kutsut (käynnissä
oleva linkki jatkuu loppuunsa). Muut torjunnat: 400 (ei tilitunnusta, paikka muu kuin 1–3, tuntematon
toiminto), 404 (tiliä tai kutsua ei ole), 409 (oma itse, paikka on varattu tai siinä on odottava kutsu,
jo linkitetty, toinen pelaaja on jo kutsunut sinut, ei vapaata paikkaa, kutsuraja, kutsu on vanhentunut
tai siihen on vastattu). **Ei vastata** (404): palkintoreitit `PUT /slayerlink/links/rewards` ja
`GET /slayerlink/links/rewards/:accountId/:slot`.

## Metagame: hallintarajapinta {#undaunted-api}

Kaikki nämä ovat metagamessa polun `/undaunted/api/` alla, ja alla olevat polut ovat suhteessa
siihen. **Yhdyskäytävän kautta vastaa vain neljä:** `POST Register` sekä `GetUserInfo`,
`ServerStatus` ja `RegistrationStatus` metodeilla `GET` ja `HEAD`. Jokainen muu polku
`/undaunted`-alla, myös `UsernameAvailable`, `PublicOnlineStats`, `PartyInvite`, `Friends` ja
kiltareitit, saa yhdyskäytävältä vastauksen 403. Aja loput palvelimella itsellään (julkisessa tilassa osoitteessa
`http://127.0.0.1:61000`) tai yksityisessä tilassa koneelta, joka tavoittaa metagamen.

| Metodi | Polku | Pääsy | Yhdyskäytävä | Mitä se tekee |
|:-------|:------|:------|:-------------|:--------------|
| GET | `RegistrationStatus` | ei mitään | kyllä | `{RegistrationMode}`: `NONE`, `INVITECODE` tai `OPEN`, muistissa oleva arvo. Kun `REGISTRATION_MODE` puuttuu, vastaus on `{}`. |
| POST | `RegistrationStatus` | ylläpitäjän avain | ei | Runko `{RegistrationStatus: <mode>}`. Vaihtaa tilan vain muistissa; uudelleenkäynnistys palauttaa asetuksen `REGISTRATION_MODE` arvon. 400 tuntemattomalle tilalle. |
| POST | `Register` | ei mitään (rekisteröintitila rajaa) | kyllä, vain POST | Luo tilin; katso [Register](#register). Palauttaa `{UUK}`, uuden tiliavaimen, kerran. |
| GET | `UsernameAvailable` | ei mitään | ei | `?Username=`: `{available}`, ja kun nimi ei kelpaa, myös `error` ja `message`. Tarkistaa vain säännöt ja olemassa olevat tilit; rekisteröinti voi silti hävitä kilpailutilanteen. Mikään repositoriossa ei kutsu sitä. |
| GET | `GetUserInfo` | tiliavain | kyllä | `{UserId, Username, IsAdmin}` avaimen tilille. Käynnistin, kaveripaketti ja sisältöpalvelin tarkistavat sillä avaimen. |
| GET | `ServerStatus` | rekisteröitynyt | kyllä | Palvelimen nimi, versio, lähdekoodi ja pelaajalista käynnistintä varten; katso [ServerStatus](#serverstatus). Ei koskaan 401. |
| GET | `PublicOnlineStats` | tiliavain | ei | `{NumActivePlayers}`: pelaajat, joilta on tullut elonmerkki viimeisten 90 sekunnin aikana. |
| POST | `PartyInvite` | tiliavain (`From`-kentälle ylläpitäjän avain) | ei | `{Username, From?}`: avaimen omistaja kutsuu kyseisen pelaajan ryhmäänsä; kaveri hyväksyy kutsun silti pelissä. Vastaa `{From, To}`. |
| POST | `Friends` | tiliavain (`From`-kentälle ylläpitäjän avain) | ei | `{Username, From?}`: lähettää kaveripyynnön tai hyväksyy sen, jonka kyseinen pelaaja lähetti. Vastaa `{From, To, Result}`, jossa `Result` = `requested`, `accepted`, `already_friends` tai `already_requested`. |
| POST | `GuildInvite` | tiliavain (`From`-kentälle ylläpitäjän avain) | ei | `{Username, From?}`: avaimen omistaja (tai `From`) kutsuu kyseisen pelaajan kiltaansa samoin tarkistuksin kuin pelin oma kutsu; pelaaja hyväksyy kutsun silti pelissä. Vastaa `{From, To, Guild}`. |
| GET | `Guilds` | ylläpitäjän avain | ei | Kaikki killat: `[{guildId, name, nameplate, leader, members}]`, jossa `members` on jäsenten määrä. |
| POST | `DisbandGuild` | ylläpitäjän avain | ei | `{Guild}` (tunnus tai nimi missä tahansa kirjainkoossa): poistaa killan, sen jäsenyydet ja kutsut. Vastaa `{Guild, Members}`; 404 `not_found` tuntemattomalle killalle. |
| GET | `InviteCodes` | ylläpitäjän avain | ei | `{InviteCodes: [{inviteCode, usesRemaining, infiniteUses}]}`. **Vastauksessa on voimassa olevia kutsukoodeja.** |
| POST | `CreateInvite` | ylläpitäjän avain | ei | `{uses?, name?}` → `{code}`. Satunnainen `XXXX-XXXX-XXXX`-koodi Crockfordin base32-aakkostosta (60 satunnaista bittiä). `uses` on 1–1000 (oletus 1). `name` on muistiinpano lokiin, eikä sitä tallenneta; lokissa näkyy vain koodin ensimmäinen ryhmä. |
| POST | `RegisterInviteCode` | ylläpitäjän avain | ei | `{NewInviteCode, Uses, InfiniteUses}`: tallentaa itse valitsemasi koodin (`Uses` on kokonaisluku, vähintään 1, ellei `InfiniteUses`). Vanhempi tapa; `New-Invite.ps1` käyttää sitä vain metagamessa, jossa ei ole `CreateInvite`-reittiä. |
| DELETE | `InviteCode/:code` | ylläpitäjän avain | ei | Peruu koodin. Aina 200. |
| GET | `GetAllUsers` | ylläpitäjän avain | ei | `{Users: [{Username, UserId}]}`. |
| POST | `RenameUser` | ylläpitäjän avain | ei | `{UserId}` tai `{Username}` (nykyinen nimi missä tahansa kirjainkoossa) sekä `{NewUsername}` → `{UserId, OldUsername, Username}`. Nimeää tilin ja sen hahmot uudelleen yhdessä; pelaaja näkee muutoksen kirjauduttuaan uudelleen. |
| POST | `GenerateJWTForUserId` | ylläpitäjän avain | ei | `{UserId}` → `{JWT}`: 24 tuntia voimassa oleva pelaajan tunniste mille tahansa tilille, mikä käytännössä tarkoittaa pelaamista hänenä. Tunnusta ei tarkisteta. |
| GET | `PrivateOnlineStats` | ylläpitäjän avain | ei | Lista `{UserId, Map, HuntId, EnteredHuntAt}` pelaajista, joilta on tullut elonmerkki viimeisten 90 sekunnin aikana. |
| GET | `SaveHistory` | ylläpitäjän avain | ei | `?UserId=` tai `?CharacterId=` → `{Characters: [...]}`: hahmotietojen ja varustesarjojen tallennetut versiot ilman itse tietoja. 400 ilman kumpaakaan, 404, kun mitään ei löydy. |
| POST | `RollbackCharacter` | ylläpitäjän avain | ei | `{CharacterId, Version}`: palauttaa hahmon tiedot `SaveHistory`-listan versioon. 404 tuntemattomalle hahmolle tai versiolle, 409 ristiriidassa. Pelaajan pitäisi olla poissa pelistä. |
| POST | `RollbackLoadout` | ylläpitäjän avain | ei | Sama hahmon varustesarjoille, varustesarjan versiolla. |
| GET | `Progression` | ylläpitäjän avain | ei | `?UserId=` → `{UserId, RealMode, HuntPass, Tracks, Objectives, Entitlements}`. Jokaisella radalla näkyvät myös `earned_free_rank` ja `earned_premium_rank`, eli tasot, jotka peli näyttää. 404 tuntemattomalle tilille. |
| POST | `SeedProgression` | ylläpitäjän avain | ei | `{UserId, Mode}`. `grandfather` asettaa jokaisen radan korkeimmalle tasolleen täysin vahvistettuna (mitään ei myönnetä); `fresh` asettaa jokaisen radan nollaan ja tyhjentää tavoitteet. Vastaa `{UserId, Mode, RealMode, Tracks}`; 400 mille tahansa muulle `Mode`-arvolle, 404 tuntemattomalle tilille. Tili lukee nämä rivit aina, kun sillä on oikea eteneminen. Aja se, kun pelaaja ei ole pelissä; [Päivitysohjeissa]({{ upgrade_page.url | relative_url }}) on skripti. |
| POST | `GrantEntitlement` | ylläpitäjän avain | ei | `{UserId, Entitlement, Duration?}` (tunteina; 0, oletus, on pysyvä) → `{UserId, Entitlements}`. |
| POST | `RevokeEntitlement` | ylläpitäjän avain | ei | `{UserId, Entitlement}` → `{UserId, Revoked, Entitlements}`. Peruttu oletusoikeus pysyy peruttuna, kunnes se myönnetään uudelleen. |

Ylläpitäjän myöntämät ja perumat oikeudet kirjataan etenemisen tapahtumalokiin samoin kuin
pelipalvelimen omat.

### Register {#register}

`POST /undaunted/api/Register` rungolla `{"Username": "...", "InviteCode": "..."}`:

- **Käyttäjänimestä** poistetaan ensin alun ja lopun välilyönnit, minkä jälkeen sen on oltava 3–16
  kirjainta, numeroa tai alaviivaa (`^[A-Za-z0-9_]{3,16}$`) ja ainutlaatuinen kirjainkoosta
  riippumatta. Ennen näitä sääntöjä tehdyt tilit säilyttävät nimensä; säännöt koskevat uusia nimiä
  ja nimenvaihtoja.
- `NONE` torjuu kaikki. `INVITECODE` vaatii kelvollisen koodin. `OPEN` ei välitä koodista.
- Ensin tarkistetaan nimen muoto. Sen jälkeen kaikki tapahtuu yhdessä tietokantatransaktiossa tässä
  järjestyksessä: ensin tarkistetaan kutsukoodi, sitten se, onko nimi varattu, ja vasta sitten
  koodista kulutetaan yksi käyttökerta ja tili kirjoitetaan. Varattu nimi ei koskaan vie pelaajalta
  hänen koodiaan, eikä käyttökertaa kuluteta koskaan kahdesti.
- Jos `REGISTRATION_MODE` puuttuu tai ei ole mikään kolmesta tilasta, Register vastaa tyhjällä
  500-vastauksella.
- Vastaus `{UUK}` on tilin avaimen ainoa kopio. **Se on salaisuus**: kutsun tekijän on tallennettava
  se suoraan yksityiseen tiedostoon.
- Yhdyskäytävän kautta Registerillä on oma pyyntörajansa: 5 heti, sen jälkeen yksi 5 minuutin välein
  osoitetta kohden.

### Tilireittien virhekoodit {#error-codes-of-the-account-routes}

`Register`, `RenameUser`, `CreateInvite`, `UsernameAvailable`, `PartyInvite`, `Friends`,
`GuildInvite`, `DisbandGuild` ja `Guilds` kertovat torjunnan syyn muodossa `{"error": <code>, "message": <text>}`:

| Koodi | Tilakoodi | Missä | Merkitys |
|:------|:----------|:------|:---------|
| `registration_closed` | 400 | Register | Rekisteröintitila on `NONE`. |
| `bad_request` | 400 | Register, RenameUser, CreateInvite sekä virheellinen JSON kaikilla seitsemällä POST-reitillä | Runko ei ole JSONia, tai kenttä puuttuu tai on väärää tyyppiä. |
| `username_invalid` | 400 | Register, RenameUser, UsernameAvailable | Nimi rikkoo yllä olevia sääntöjä. |
| `invite_invalid` | 401 | Register | Koodi puuttuu, on väärä tai on käytetty loppuun. |
| `username_taken` | 409 | Register, RenameUser, UsernameAvailable | Toisella tilillä on sama nimi missä tahansa kirjainkoossa. |
| `not_found` | 404 | RenameUser, PartyInvite, Friends, GuildInvite, DisbandGuild | Tiliä ei ole. Nimi, joka vastaa kahta vanhempaa, eri kirjainkoossa kirjoitettua tiliä, ei vastaa kumpaakaan. |
| `forbidden` | 403 | PartyInvite, Friends, GuildInvite | `From` annettiin avaimella, joka ei ole ylläpitäjän. |
| `party_invite_refused` | ryhmän antama tilakoodi | PartyInvite | Ryhmä torjui kutsun (täynnä, ei johtaja, estetty ja niin edelleen). |
| `self`, `blocked`, `limit` | 400, 403, 409 | Friends | Oma tili; toinen kahdesta on estänyt toisen; 200 kaveria tai pyyntöä. |
| `pending_limit`, `rate` | 409 | Friends | 50 lähetettyä pyyntöä on yhä vastaamatta; 20 uutta pyyntöä viimeisten 10 minuutin aikana. |
| `guild_refused` | killan antama tilakoodi | GuildInvite | Kilta torjui kutsun; `message` alkaa killan koodilla (esimerkiksi `RedundantAdorableQuillshot: ...`), kun sellainen on. |
| `guilds_off` | 404 | GuildInvite, DisbandGuild, Guilds | `GUILDS=0`. |

`UsernameAvailable` vastaa aina 200, jolloin mukana ovat `available: false` ja koodi. Tämän
rajapinnan muut reitit torjuvat pelkällä tilakoodilla ilman runkoa.

### ServerStatus {#serverstatus}

`GET /undaunted/api/ServerStatus` vastaa kaikille, joten käynnistin, joka ei ole vielä
rekisteröitynyt, voi silti lukea palvelimen nimen ja rekisteröintitilan:

```json
{
  "name": "Dauntless Revived", "online": true, "version": "...", "commit": "...",
  "sourceUrl": "https://github.com/...", "registration": "INVITECODE",
  "playersOnline": 1,
  "players": [{ "name": "Slayer_one", "where": "city", "instance": "..." }],
  "instances": [{ "id": "...", "kind": "city", "title": "Ramsgate", "map": "...", "behemoth": null,
                  "players": 1, "maxPlayers": 32, "startedAt": "..." }],
  "contentPort": 61002, "uptimeSeconds": 3600, "limited": false
}
```

- Pyytäjä, jolla on kelvollinen tiliavain tai olemassa olevan tilin kelvollinen tunniste, saa täyden
  vastauksen. Kaikki muut saavat saman muodon niin, että `playersOnline` on 0, `players` ja
  `instances` ovat tyhjiä ja `limited: true`.
- Vastauksessa ei koskaan ole tilitunnuksia, avaimia tai osoitteita, vain käyttäjänimiä. `where` on
  `menu`, `city`, `hunt`, `dojo`, `tutorial` tai `unknown`, päätelty elonmerkin ilmoittamasta
  pelikentästä (`map`).
  Pelaaja lasketaan paikalla olevaksi 90 sekunnin ajan viimeisen elonmerkkinsä jälkeen.
- Pelipalvelimet tulevat deploy-palvelimen reitiltä `GET /gameservers` (2 sekunnin aikaraja); ilman
  vastausta lista on tyhjä.
- `name`, `version`, `commit` ja `sourceUrl` tulevat asetuksista `SERVER_NAME`, `SERVER_VERSION`,
  `GIT_COMMIT` ja `SOURCE_URL`, muuten koontiversiosta ja oletuksista. `contentPort` on
  `CONTENT_PORT` tai `null`. `registration` on `NONE`, kun `REGISTRATION_MODE` puuttuu tai ei ole
  mikään kolmesta tilasta.
- Kumpaakin muunnelmaa pidetään välimuistissa 5 sekuntia. Vastauksessa on `Cache-Control: no-store`,
  ja sen `Vary`-otsake nimeää avainotsakkeen ja `Authorization`-otsakkeen.

## Chat (XMPP portissa 61099) {#chat}

Pelin tekstichat (Ramsgaten ja metsästysten chat, ryhmächat, kiltachat ja kuiskaukset) on XMPP:tä
WebSocketin yli, ja sitä palvelee metagame itse, kun `CHAT=1`, osoitteessa `127.0.0.1:61099`. Se ei
ole HTTP:tä: peliohjelma avaa WebSocketin (pyynnön polku `//`, protokolla `xmpp`) ja vaihtaa yhden
viestin (stanza) kerrallaan. Julkisessa tilassa yhdyskäytävä välittää avauksen käynnistimen
välittimeltä. Miksi kukin vastaus on sen muotoinen, ohjelmatiedoston osoitteineen, kerrotaan sivulla
[Tekstichat]({{ chat_page.url | relative_url }}); asetukset ja rajat ovat sivulla
[Asetukset]({{ config_page.url | relative_url }}#metagame-chat).

**Kirjautuminen.** `<open>` (verkkotunnus tulee sen `to`-kentästä, oletus `prod.ol.epicgames.com`),
SASL `PLAIN` tilitunnuksella ja pelaajan tunnisteella (tunnisteen on oltava voimassa ja kuuluttava
tälle tilille), toinen `<open>` ja sitten sidonta (bind): resurssi palautetaan sellaisenaan. Hylättyyn
kirjautumiseen vastataan `<failure>` ja `<not-authorized/>` (tai `<temporary-auth-failure/>`, kun
tiliä tai osoitetta pidätetään); peliohjelman sen jälkeen yrittämä vanha `jabber:iq:auth` saa virheen,
ja yhteys suljetaan. Yhteys saa yhden kirjautumisyrityksen ja enintään neljä kehystä ennen
kirjautumista, ja sen on sitouduttava 10 sekunnissa kirjautumisesta.

`<open to>` -verkkotunnus voi olla isäntänimi tai käynnistimen `isäntä:portti`-päätepiste. Jälkimmäinen
säilytetään sellaisenaan, koska versio 1.4.4 käyttää sitä myös huoneiden JID-osoitteiden loppuosana.

**Mitä palvelin vastaa:**

| Peliohjelma lähettää | Palvelin |
|:---------------------|:---------|
| `<presence to="Huone@(muc|conference).<verkkotunnus>/<nimimerkki>">` (liittyminen) | Tarkistaa huoneen ja nimimerkin. Jos saman tilin vanhempi yhteys on huoneessa (uudelleenyhdistäminen vanhan yhteyden vielä roikkuessa), se poistuu ensin: muut saavat sen unavailable-läsnäolotiedon, eikä vanhalle yhteydelle kerrota mitään. Sitten se lähettää liittyjälle jokaisen muun huoneessa olijan läsnäolotiedon, kertoo jokaiselle muulle liittyjästä ja lähettää liittyjän oman läsnäolotiedon (tilakoodi 110) viimeisenä. Jokaisessa huoneessa olijan läsnäolotiedossa on `<item jid="<tili>@<verkkotunnus>/<resurssi>">`, ja jokainen `from` on huoneen JID ja huoneessa olijan nimimerkki täsmälleen sellaisena kuin se lähetettiin. |
| `<presence type="unavailable" to="Huone@...">` (poistuminen) | Muut saavat poistujan unavailable-läsnäolotiedon; poistuja saa omansa tilakoodilla 110. |
| `<message type="groupchat" to="Huone@muc.<verkkotunnus>">` | Toimitetaan jokaiselle huoneessa olijalle lähettäjä mukaan lukien osoitteesta `Huone@muc.<verkkotunnus>/<lähettäjän nimimerkki>` samalla `id`:llä. Ei niille, jotka ovat estäneet lähettäjän. |
| `<message type="chat" to="<tili>@<verkkotunnus>[/<resurssi>]">` (kuiskaus) | Toimitetaan lähettäjän täydestä JID:stä kyseiselle istunnolle tai tilin jokaiselle istunnolle. Ei toimiteta, eikä virhettä lähetetä, jos pelaaja ei ole paikalla tai jompikumpi on estänyt toisen. |
| Yleinen `<presence>` (ei `to`-kenttää) | Kun `CHAT_PRESENCE` on pois (oletus): kirjataan ja pudotetaan, ei koskaan kaiuteta eikä välitetä. Asetuksella `CHAT_PRESENCE=1`: välitetään lähettäjän täydestä JID-osoitteesta, `<show>` ja `<status>` muuttumattomina, jokaisen hyväksytyn, estämättömän kaverin niihin istuntoihin, jotka ovat lähettäneet oman läsnäolotietonsa; istunto saa ensimmäisellä läsnäolotiedollaan myös heidän tietonsa. Ei koskaan lähettäjän oman tilin istuntoon. |
| `<presence type="unavailable">` (ei `to`-kenttää), tai yhteys päättyy | Asetuksella `CHAT_PRESENCE=1`: `type="unavailable"` täydestä JID-osoitteesta samoille kavereille, ja sitten tilin toisen istunnon läsnäolotieto, jos sellainen on. |
| `<iq>`: ping, session tai mikä tahansa muu | Tyhjä `result` samalla `id`:llä. |
| `<close/>` | `<close/>`, sitten yhteys suljetaan. |

Kun peliohjelma on ollut 50 sekuntia hiljaa, palvelin pingaa sitä ja päättää yhteyden, jos vastausta
ei tule seuraavien 100 sekunnin aikana (peliohjelma vastaa pelisäikeensä kierroksella, jonka kartan
lataus pysäyttää). Peliohjelmalle, joka lakkaa lukemasta, ei lähetetä enää mitään, kun 256 KiB odottaa
lähtemättä, ja sen yhteys päättyy.

**Palvelimen itse lähettämät, vain asetuksella `CHAT_PRESENCE=1`:** kun kaveripyyntö hyväksytään
HTTP:n kautta, kummankin pelaajan jokainen istunto saa viestin `<message from="xmpp-admin@<verkkotunnus>">`,
jonka runko on peliohjelman kaverilistan päivitys `{"type": "com.epicgames.friends.core.apiobjects.Friend",
"payload": {"accountId", "status": "ACCEPTED", "direction", "created"}, "timestamp"}`, ja he vaihtavat
läsnäolotiedot; kaveruuden purku tai esto lähettää kummallekin toisen `unavailable`-tiedon.
Yksityiskohdat: [Tekstichat]({{ chat_page.url | relative_url }}#presence).

**Huoneet.** `City-<tunnus>`, `Hunt-<tunnus>` ja `General<tunnus>` ovat avoimia kaikille
kirjautuneille pelaajille, `Party-<partyId>` vain sen ryhmän jäsenille ja `Guild-<guildId>` vain sen
killan jäsenille. Kaikki ovat osoitteessa `muc.<verkkotunnus>` tai sen live-peliohjelman
`conference.<verkkotunnus>`-aliaksessa. Pelaaja, joka on lähtenyt ryhmästä tai
killasta, poistetaan tilakoodilla 307.

**Hylätyt liittymiset** ovat virheläsnäolotieto huoneen JID:stä, ja peliohjelma käsittelee ne
epäonnistuneena liittymisenä:

| Syy (`chat: join refused ... reason=`) | `<error>` |
|:----------------------------------------|:----------|
| Nimimerkki ei ole muotoa `<nimi>:<oma tilitunnus>:<oma resurssi>`, siinä on toisen tilin tunnus tai sen nimi ei ole tilin käyttäjänimi (`nick-account`, `nick-resource`, `nick-format`, `nick-name`); ei ryhmän tai killan jäsen (`not-member`) | `type="auth"`, `<forbidden/>` |
| Huoneen nimi, jota peliohjelma ei koskaan rakenna, tai eri verkkotunnus (`not-allowed`) | `type="cancel"`, `<not-allowed/>` |
| Nimimerkki on toisen yhteyden käytössä (`conflict`) | `type="cancel"`, `<conflict/>` |
| Liikaa huoneita, huoneessa olijoita tai liittymisiä (`limit`) | `type="wait"`, `<service-unavailable/>` |

Huoneviesti, jota ei voi toimittaa (ei huoneessa, tyhjä tai liian pitkä teksti, liikaa viestejä),
saa vastaukseksi `<message type="error">` ja `<not-acceptable/>`; yhteys pysyy auki.

**Nimet** tulevat kahdelta tilireitiltä, joita peliohjelma kutsuu omalla tunnisteellaan:
`GET /account/api/public/account/<oma tunnus>` omaa nimeä varten kirjautuessa ja
`GET /account/api/public/account?accountId=<tunnus>` toisen pelaajan rivin lähettäjää varten (katso
[Kirjautuminen ja tilit](#login-and-accounts)).

## Deploy-palvelin {#deploy-server}

Deploy-palvelin käynnistää ja valvoo pelipalvelinprosesseja. Sillä on kaksi reittiä eikä **lainkaan
tunnistautumista**. Kumpikin vastaa 403 jokaiselle kutsujalle, joka ei ole loopbackissa tai jonka
pyynnössä on välitysotsake, ja palvelu sitoutuu oletuksena osoitteeseen `127.0.0.1`. Yhdyskäytävällä
ei ole reittiä siihen. **Älä koskaan avaa sen porttia.**

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| POST | `/api/matchmaker/handle-matchmaking-for-player` | ei mitään; vain loopback | Runko `{GameMode, GameArgs, HuntId, ExpectedPlayers}` (enintään 16 tilitunnusta). Käynnistää tai valitsee pelipalvelimen ja vastaa `{host, port}`, jossa `host` on `MY_IP`. `CITY`: Ramsgate. `SHARED` metsästystunnuksella `ShatteredIsles_TrainingDojo`: Dojo, joka käynnistetään ensimmäisellä käyttökerralla (tai jo palvelimen käynnistyessä asetuksella `ENABLE_DOJO=1`). `ISLAND` peliparametrien kanssa: parametreissa nimetty kenttä (opetusjakso). `ISLAND` metsästystunnuksen ja odotettujen pelaajien kanssa: uusi metsästyspalvelin. Mikä tahansa muu: Ramsgate. Ennen kuin se antaa Ramsgaten tai Dojon, se tarkistaa, että prosessi on elossa, ja käynnistää kaatuneen ensin (`PERSISTENT_WORLD_LIVENESS`, päällä) saman yhden käynnistyksen kautta, jota palvelimen käynnistys ja vahtikoira käyttävät. 400 `{error: "bad_request", message}` syötteelle, joka ei läpäise tarkistuksia; 500 `{error: "no_game_server"}`, kun pelipalvelinta ei saatu käyntiin (ei vapaata metsästysporttia, käynnistys epäonnistui). |
| GET | `/gameservers` | ei mitään; vain loopback | Käynnissä olevat pelipalvelimet: `{servers: [{id, port, kind, map, gameMode, behemoth, huntId, matchmakerHuntId, expectedPlayers, maxPlayers, startedAt}]}`, jossa `kind` = `city`, `hunt`, `dojo` tai `tutorial`. Siinä on tilitunnuksia, joten se on vain metagamea varten. |

- Metagame kutsuu sitä tavallisella HTTP:llä ilman tunnistetietoja osoitteessa `DEPLOYSERVER_URL`
  (`host:port`, ilman protokollaa). Loopback-säännön takia sen on oltava `127.0.0.1:<port>`
  molemmissa tiloissa: Tailscale- tai lähiverkko-osoite saa vastauksen 403 jokaiseen kutsuun.
- Matchmaking-syöte tarkistetaan kahdesti, metagamessa ja uudelleen täällä, koska se päätyy
  pelipalvelimen komentoriville.
- Se vastaa heti, kun prosessi on käynnistetty, ei vasta silloin, kun palvelin on valmis.
  Käynnistykset jonotetaan `SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP` sekunnin välein.
- Kun vapaata metsästysporttia ei ole tai pelipalvelimen käynnistys epäonnistuu, pyyntö epäonnistuu
  vastauksella 500 `{error: "no_game_server"}` (deploy-palvelin kirjaa lokiin `Matchmaking for <tila>
  <metsästys> failed: No free ports left!` tai käynnistysvirheen), ja metagame vastaa pelaajien
  tilakyselyihin `FAILED`. Samoin käy kaikissa muissa tämän kutsun virheissä: muu tila, vastaus ilman
  palvelinta, lainausmerkeissä oleva portti, runko joka ei ole JSONia tai katkennut yhteys.
- Yleistä kiinniottoreittiä (catch-all) ei ole: tuntematon polku saa Expressin oletusarvoisen
  HTML-muotoisen 404-sivun. JSON-rungot on rajattu Expressin oletukseen, 100 kt. Virheissä on
  pinojälki, ellei `NODE_ENV=production`.

## Sisältöpalvelin {#content-server}

Sisältöpalvelin jakaa tarkistetut 1.4.4-pelitiedostot rekisteröityneiden pelaajien käynnistimille
ja tarjoaa isännän kuvapaketin ja uutiset. Se vastaa vain metodeihin `GET` ja `HEAD`, eikä
hakemistolistausta ole.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| GET, HEAD | `/content/v1/manifest` | ei mitään | Koontiversion tiedostolista: `{build, totalBytes, files: [{path, size, sha256}]}`. `ETag`-otsakkeen kanssa; `If-None-Match` saa vastauksen 304. |
| GET, HEAD | `/content/v1/files/<path>` | tiliavain | Yksi pelitiedosto; `<path>`-arvon on vastattava manifestin polkua täsmälleen. Yksi tavualue pyyntöä kohden (`Range`, `If-Range`); `ETag` on tiedoston SHA-256. |
| GET, HEAD | `/content/v1/branding` | ei mitään | Isännän kuvapaketti: `{backgrounds: [{url, credit}], accent}`. |
| GET, HEAD | `/content/v1/branding/<file>` | ei mitään | Yksi kuva: jpg, png tai webp, enintään 25 Mt. |
| GET, HEAD | `/content/v1/news` | ei mitään | Isännän uutiset: `{items: [{date, title, body}]}`. |

- Julkiset reitit lähettävät otsakkeen `Access-Control-Allow-Origin: *`. Kuvapaketti ja uutiset ovat
  tyhjiä, ellei isäntä aseta asetuksia `CONTENT_BRANDING_DIR` ja `CONTENT_NEWS_FILE`.
- **Avaimen tarkistus.** Sisältöpalvelin kysyy metagamen reitiltä `GET /undaunted/api/GetUserInfo`
  (osoitteessa `METAGAME_URL`, oletus `http://127.0.0.1:61000`), kenelle avain kuuluu. Se pitää
  vastauksen välimuistissa avaimen SHA-256-tiivisteen mukaan: hyväksytyt avaimet
  `CONTENT_AUTH_CACHE_SECONDS` sekuntia (300), torjutut 30 sekuntia. Itse avainta se ei koskaan
  tallenna eikä kirjaa lokiin. Arvo, joka ei ole 1–256 tulostettavaa merkkiä ilman välilyöntejä,
  torjutaan kysymättä.
- Tarkistukset tehdään tässä järjestyksessä: polku, manifesti ja sitten avain. Polku, jota ei ole
  manifestissa, saa vastauksen 404 ilman avaintakin.

| Tilakoodi | `error` | Milloin |
|:----------|:--------|:--------|
| 400 | `bad_path` | Tiedostopolku ei ole siisti: koodatut erottimet, `..`, kaksinkertainen koodaus ja vastaavat. |
| 401 | `unauthorized` | Avainta ei ole, tai metagame ei tunne sitä. |
| 404 | `not_found` | Ei mikään viidestä reitistä (metodista riippumatta), ei manifestissa tai kuvaa ei ole. |
| 405 | `method_not_allowed` | Mikä tahansa muu kuin `GET` ja `HEAD` jollakin viidestä reitistä (`Allow: GET, HEAD`). |
| 416 | `range_not_satisfiable` | Pyydetty alue on tiedoston ulkopuolella. |
| 429 | `too_many_streams` | Tilillä on jo `CONTENT_MAX_STREAMS_PER_ACCOUNT` (6) latausta käynnissä. `Retry-After: 2`. |
| 503 | `auth_unavailable` | Metagamelta ei voitu kysyä. `Retry-After: 5`. |
| 503 | `file_unavailable` | Tiedosto puuttuu tai on muuttunut levyllä palvelimen käynnistyksen jälkeen. |
| 503 | `server_busy` | `CONTENT_MAX_STREAMS_TOTAL` (48) latausta on käynnissä. `Retry-After: 10`. |

## Yhdyskäytävä {#gateway}

Yhdyskäytävä on olemassa vain julkisessa tilassa. Se on HTTPS-palvelu (TLS 1.2 tai uudempi) itse
allekirjoitetulla varmenteella, jonka käynnistin kiinnittää sormenjäljen perusteella, osoitteessa `GATEWAY_BIND`
(`0.0.0.0`) ja portissa `GATEWAY_PORT` (443).
[UndauntedGateway/README.md]({{ site.github.repository_url }}/blob/dauntless-revived/UndauntedGateway/README.md)
(englanniksi) kertoo tarkemmin sen rajoista, aikakatkaisuista ja pääsylokista.

| Pyyntö | Menee | Oletus |
|:-------|:------|:-------|
| `/content` ja `/content/...` | Sisältöpalvelimelle | `GATEWAY_CONTENT_URL`, `http://127.0.0.1:61002` |
| `GET` otsakkeella `Upgrade: websocket` | WebSocket-kohteelle: metagamen [chat](#chat) | `GATEWAY_WS_URL`, `http://127.0.0.1:61099`. Kun chat on pois päältä, siellä ei kuuntele mikään, ja WebSocket-pyynnöt saavat vastauksen 502. |
| Kaikki muu | Metagamelle | `GATEWAY_METAGAME_URL`, `http://127.0.0.1:61000` |

Kohdeosoitteiden on oltava tavallisia `http://`-osoitteita tällä koneella, jotta salaisuusotsake ei
koskaan poistu koneelta. Reittiä deploy-palvelimelle tai sallittujen listan apurille ei ole.

**Mitä se torjuu.** Torjunnat ovat JSONia, `{"error": <code>}`:

| Tilakoodi | `error` | Milloin |
|:----------|:--------|:--------|
| 400 | `bad_request` | Pyynnön kohde ei ole tavallinen polku (`/...`), tukematon yhteyden päivitys (upgrade) tai virheellinen pyyntö. |
| 400 | `bad_path` | Polussa on kenoviiva, tyhjätilaa tai ohjausmerkki, `.`- tai `..`-osa, `%2f`, `%5c`, `%00` tai `%2e`, tai rikkinäinen prosenttikoodaus. |
| 403 | `forbidden` | Mikä tahansa `x-undaunted-gameserver-apikey`-otsake. Mikä tahansa polku `/undaunted`-alla paitsi neljä julkista (myös yhteyden päivityksille). |
| 405 | `method_not_allowed` | Mikä tahansa muu kuin `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH` ja `OPTIONS`. |
| 408, 431 | `request_timeout`, `headers_too_large` | Otsakkeet tulevat liian hitaasti tai ovat liian suuria. |
| 413 | `body_too_large` | Runko on suurempi kuin `GATEWAY_MAX_BODY_BYTES` (128 KiB). |
| 429 | `rate_limited` | Osoitteen pyyntökiintiö on tyhjä; `Retry-After`-otsakkeen kanssa. |
| 502, 504 | `bad_gateway`, `upstream_timeout` | Kohdepalvelu on alhaalla tai ei vastaa. |

`/undaunted`-tarkistus tehdään polulle, joka on muutettu pieniksi kirjaimiksi, jonka
prosenttikoodaus on purettu, jonka toistuvat kauttaviivat on yhdistetty ja jonka loppukauttaviivat on
poistettu. Näin kirjainkoko tai koodaus ei voi livauttaa ylläpitoreittiä tarkistuksen ohi.

**Pyyntörajat.** Rajoitus toimii kiintiöinä (token bucket) IPv4-osoitetta tai IPv6-/64-verkkoa
kohden. Myös torjutut pyynnöt lasketaan.

| Kiintiö | Laskee | Purske | Täyttö minuutissa | Asetus |
|:--------|:-------|-------:|------------------:|:-------|
| general | Kaiken, mikä ei kuulu alempiin | 300 | 180 | `GATEWAY_RATE_GENERAL` |
| content | `/content` | 600 | 600 | `GATEWAY_RATE_CONTENT` |
| register | `/undaunted/api/Register` | 5 | 0,2 | `GATEWAY_RATE_REGISTER` |
| token | `/account/api/oauth/token` | 10 | 1 | `GATEWAY_RATE_TOKEN` |
| connect | Uudet TCP-yhteydet | 200 | 300 | `GATEWAY_RATE_CONNECT` |

Yhdellä osoitteella voi lisäksi olla enintään 128 avointa yhteyttä
(`GATEWAY_MAX_CONNECTIONS_PER_IP`), ja yhdyskäytävällä enintään 2048 yhteensä
(`GATEWAY_MAX_CONNECTIONS`).

**Otsakkeet.** Yhdyskäytävä asettaa otsakkeet `X-Forwarded-For`, `X-Forwarded-Proto` ja
`X-Dauntless-Gateway` kohdassa [Julkinen tila](#public-mode) kuvatulla tavalla ja pudottaa
yhteyskohtaiset (hop-by-hop) otsakkeet molempiin suuntiin. Vastauksista se poistaa otsakkeet
`X-Powered-By` ja `X-Dauntless-Gateway`. Sen pääsylokissa ei koskaan ole otsakkeita eikä runkoja,
ja pyynnön polussa olevat tunnisteet ja avaimet korvataan.

**Peliporttien avaaminen.** Kun `POST /heartbeat` bearer-tunnisteen kanssa tai
`POST /account/api/oauth/token` saa 2xx-vastauksen, yhdyskäytävä ilmoittaa pelaajan osoitteen
sallittujen listan apurille, osoitetta kohden enintään kerran `GATEWAY_ALLOWLIST_REFRESH_SECONDS`
sekunnissa (60). Apuri avaa sitten UDP-peliportit tälle osoitteelle 10 minuutiksi. Pelaajan pyyntö ei
koskaan odota apuria. `GATEWAY_ALLOWLIST=0` kytkee tämän pois, ja silloin peliportit eivät aukea
kenellekään.

## Sallittujen listan apuri {#allowlist-helper}

Pieni HTTP-palvelu osoitteessa `127.0.0.1:61005` (`ALLOWLIST_BIND`, `ALLOWLIST_PORT`), joka pitää
yllä yhtä Windowsin palomuurisääntöä. Se toimii ylläpitäjän oikeuksin, koska se muokkaa palomuuria.
Vain yhdyskäytävä kutsuu reittiä `/allow`; paketin `Stack.ps1 status` lukee reittiä `/status`.

| Metodi | Polku | Pääsy | Mitä se tekee |
|:-------|:------|:------|:--------------|
| POST | `/allow` | sallittujen listan salaisuus | Runko `{ip}` (enintään 1 kt). Lisää osoitteen sääntöön tai uusii sen ajaksi `ALLOWLIST_TTL_SECONDS` (600 sekuntia). Vastaa `{ip, added, ttlSeconds}`. 400 `invalid_ip` yksityiselle osoitteelle (ellei `ALLOWLIST_ALLOW_PRIVATE=1`) tai virheelliselle osoitteelle; 503 `allowlist_full`, kun `ALLOWLIST_MAX_ENTRIES` (256) ylittyisi. |
| GET | `/status` | sallittujen listan salaisuus | `{dryRun, allowPrivate, ttlSeconds, ports, entries: [{ip, expiresAt}], pending, lastApply}`. Portit tulevat asetuksesta `ALLOWLIST_PORTS`, oletuksena 8770-8777. |

Muut vastaukset: 400 `bad_request` rungolle, joka ei ole JSONia, 401 puuttuvalle tai väärälle
salaisuudelle, 403 kutsujalle, joka ei ole loopbackissa, 404 mille tahansa muulle polulle, 405 väärälle metodille ja 413 tätä suuremmalle
rungolle. `entries` ovat pelaajien osoitteita: pidä `/status`-tuloste yksityisenä.

## Käynnistimen välitin {#launcher-relay}

Julkisessa tilassa kaverikäynnistin pyörittää pelin ajan välitintä pelaajan omalla koneella
osoitteessa `127.0.0.1:61000`. `DAUNTLESS_REVIVED_RELAY_PORT` vaihtaa portin, mutta vain testejä ja
harjoitusajoja varten: palvelimen puoli (esimerkiksi pingin kohde asetuksessa `QOS_TARGET_URL`)
odottaa porttia 61000. Peli puhuu välittimelle
tavallista HTTP:tä, ja välitin välittää jokaisen pyynnön, myös WebSocket-yhteydet, muuttamattomana
TLS:n yli yhdyskäytävälle. Yhteys on kiinnitetty kutsun mukana tulleeseen varmenteen sormenjälkeen.

- 403 `forbidden` kutsujalle, joka ei ole paikallinen, `Host`- tai `Origin`-otsakkeelle, joka ei ole
  loopback, tai tavallisessa pyynnössä mille tahansa `Sec-Fetch-*`-otsakkeelle. Näin verkkosivut (ja
  DNS rebinding -hyökkäykset) eivät voi käyttää välitintä.
- 501 `unsupported_transfer_encoding` muulle `Transfer-Encoding`-arvolle kuin chunked.
- 502 `certificate_mismatch`, kun palvelimen varmenne ei ole kiinnitetty varmenne, ja 502
  `upstream_unreachable`, kun yhdyskäytävään ei saada yhteyttä.

Sivu [Windows-palvelin]({{ winserver_page.url | relative_url }}#how-public-mode-works) selittää koko
julkisen tilan polun pelistä välittimen ja yhdyskäytävän kautta peliportteihin.

## Esimerkkejä {#examples}

Aseta jokaiselle kutsulle aikaraja, jotta väärä kuuntelija epäonnistuu nopeasti (katso
[Vianetsintä]({{ trouble_page.url | relative_url }}#invoke-restmethod-hangs)).

Kuka tahansa, palvelimella (tai Tailscalen yli palvelimen osoitteella):

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:61000/undaunted/api/RegistrationStatus -TimeoutSec 10
Invoke-RestMethod -Uri http://127.0.0.1:61000/undaunted/api/ServerStatus -TimeoutSec 10
```

Ylläpitokutsut palvelimella itsellään. Avain luetaan tiedostostaan eikä sitä koskaan tulosteta.
Omistajan avain on tiedostossa `C:\dr\data\owner.key` palvelimella, joka on pystytetty sivun
[Pystytä palvelin]({{ host_page.url | relative_url }}) ohjeilla, ja tiedostossa
`C:\DauntlessRevived\data\keys\owner.key` paketilla asennetulla palvelimella:

```powershell
$api = "http://127.0.0.1:61000/undaunted/api"
$h = @{ "x-undaunted-user-api-key" = (Get-Content C:\dr\data\owner.key -Raw).Trim() }

(Invoke-RestMethod -Uri "$api/GetAllUsers" -Headers $h -TimeoutSec 10).Users

$body = @{ Username = "OldName"; NewUsername = "New_Name" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/RenameUser" -Headers $h -ContentType "application/json" -Body $body -TimeoutSec 10

$h = $null
```

Kutsun saat paketilla asennetulla palvelimella skriptillä `New-Invite.ps1`; se kutsuu
`CreateInvite`-reittiä ja tulostaa koko kutsun. Käsin rakennetulla palvelimella
`POST $api/CreateInvite` rungolla `{"uses": 1}` vastaa `{"code": "XXXX-XXXX-XXXX"}`. **Koodi on
tunnistetieto**: lähetä se yhdelle kaverille, yksityisesti.

## Reittien muuttaminen {#changing-the-routes}

- `UndauntedMetagame/test/permissions.test.ts` lukitsee listan metagamen jokaisesta reitistä
  pääsytarkistuksineen rekisteröintijärjestyksessä. Reitin lisääminen tai sen tarkistusten
  muuttaminen kaataa testin, kunnes lista päivitetään, mikä pakottaa päättämään, kuka reittiä saa
  kutsua.
- Yhdyskäytävän testit lukevat tiedoston `UndauntedMetagame/src/routes/undauntedapi.ts`, joten
  jokainen uusi `/undaunted/api`-reitti testataan automaattisesti yhdyskäytävän estämäksi. Vain
  reitti, joka lisätään `PUBLIC_UNDAUNTED_API`-listaan tiedostossa `UndauntedGateway/src/policy.ts`,
  tulee tavoitettavaksi internetistä.
- Uusi pelireitti on tavoitettavissa yhdyskäytävän kautta heti, kun se on olemassa. Anna sille
  pääsytarkistus.

[Kehittäjän opas]({{ dev_page.url | relative_url }}) kertoo koontiversioiden tekemisestä ja testien
ajamisesta.
