---
title: Liity kaverina
parent: Asennus
grand_parent: Dauntless Revived suomeksi
nav_order: 2
description: "Näin kutsuttu kaveri liittyy Dauntless Revived -palvelimelle: Tailscale, tarkistettu Dauntless 1.4.4, kaksi DLL-tiedostoa, kutsukoodi ja kaveripaketti."
lang: fi
ref: setup/friends
locale: fi_FI
---

{% assign admin_page = site.pages | where: "path", "fi/setup/admin.md" | first %}
{% assign linux_page = site.pages | where: "path", "fi/setup/linux.md" | first %}
{% assign legal_page = site.pages | where: "path", "fi/legal.md" | first %}
{% assign trouble_page = site.pages | where: "path", "fi/setup/troubleshooting.md" | first %}

# Liity kaverina
{: .no_toc }

Tämä sivu on sinulle, jos isäntä (se, joka pyörittää palvelinta) on kutsunut sinut mukaan. Pelaat
**omalla Dauntless 1.4.4 -peliohjelmallasi** (lokakuu 2020, UE4) isännän palvelimella. Palvelin on
tietokone, joka pyörittää peliä verkossa. Et tarvitse Epic-tiliä, hosts-tiedoston muutoksia etkä
varmenteita. Kaikki liikenne kulkee yksityisen Tailscale-yhteyden kautta isännän koneelle.

**Julkisen tilan palvelimet käyttävät käynnistintä, eivät tätä sivua.** Jos isäntä lähetti sinulle
`dauntless-revived://join?...`-rivin (julkinen palvelin vuokrakoneella), et tarvitse Tailscalea etkä alla
olevia käsivaiheita. Windowsissa asenna `DauntlessRevivedLauncher-Setup.exe`; Linuxissa seuraa oman
jakelusi [Linux-käynnistin]({{ linux_page.url | relative_url }}) -ohjetta. Liitä sitten kutsurivi, ja
käynnistin hoitaa loput. Jos sinulla on jo tiliavain, valitse **"Minulla on jo tiliavain"** ja tuo tai
liitä se rekisteröitymisen sijaan. Pidä käynnistin auki pelatessasi. Loput tästä sivusta on käsivaiheinen
Windows/Tailscale-polku.

**Jos sinulla on jo peli.** Valitse asennusnäkymässä **"Minulla on jo pelitiedostot"** ja liitä
1.4.4-kansiosi polku (esimerkiksi `C:\Pelit\BaseGame144` tai sen sisällä oleva `Dauntless`-kansio),
tai selaa siihen. Käynnistin löytää pelin ja käyttää sitä siinä kansiossa, jossa se on: se tarkistaa
jokaisen tiedoston kiinnitettyä luetteloa vasten, korvaa tiedostot, jotka eroavat 1.4.4:stä, ja
laittaa omat `dxgi.dll`- ja `UndauntedInternalServer.dll`-tiedostonsa kansioon
`Archon\Binaries\Win64`. Puuttuvat ja poikkeavat tiedostot ladataan isännän palvelimelta, joten se
onnistuu vain, jos isäntä on avannut pelin latauksen. Jos jokin toinen asennus (esimerkiksi alla
oleva kaveripaketti) käyttää kansiota yhä, kopioi se ensin. Polun liittämisen lisäsi Vvoidddd
([#8](https://github.com/mixutin/dauntless-revived/pull/8)).

**Jos Windows estää asennusohjelman.** Käynnistintä ei ole vielä allekirjoitettu, joten Windows
SmartScreen varoittaa ensimmäisellä kerralla: **Lisätietoja > Suorita silti**. Koneella, jossa
tunnistamattomat sovellukset on asetettu estettäviksi, SmartScreen estää sen kokonaan, eikä Suorita
silti -vaihtoehtoa ole. Tee silloin näin:

1. Lataa samasta julkaisusta `SHA256SUMS.txt` ja tarkista asennusohjelma sitä vasten. Aja
   PowerShellissä latauskansiossa `Get-FileHash .\DauntlessRevivedLauncher-Setup.exe`: sen on
   näytettävä sama SHA-256 kuin tiedoston rivillä `SHA256SUMS.txt`-tiedostossa (PowerShell näyttää sen
   isoin kirjaimin ja tiedostossa se on pienin; sillä erolla ei ole väliä). Jos se ei täsmää, poista
   tiedosto äläkä aja sitä.
2. Poista esto: napsauta tiedostoa hiiren oikealla > **Ominaisuudet** > rastita **Poista esto** >
   **OK**, tai aja PowerShellissä `Unblock-File .\DauntlessRevivedLauncher-Setup.exe`.
3. Käynnistä se uudelleen.

Kaikki tällä sivulla koskee **versiota 1.4.4**. Pelin viimeinen versio, 2.1.1 (”Awakening”, UE5), ei
toimi tässä: `UndauntedInternalServer.dll` muokkaa kiinteitä muistiosoitteita 1.4.4:n
ohjelmatiedoston sisällä, joten se toimii vain juuri sen version kanssa. Siksi jokainen alla oleva
vaihe myös tarkistaa tiivisteen (hash). Tiiviste on tiedoston sisällöstä laskettu sormenjälki: jos
tiedostosta muuttuu yksikin tavu, tiiviste muuttuu.

**Tilanne (22.9.2026).** Kavereille tarkoitettu palvelimemme pyörii julkisessa tilassa vuokratulla
koneella. 22.9.2026 omistaja pelasi siellä internetin yli käynnistimellä, kutsusta ja pelin
latauksesta ensimmäiseen metsästykseen asti. Myöhemmin samana iltana mukaan tuli toinen pelaaja:
he näkivät toisensa Ramsgatessa ja metsästivät yhdessä. Tämän sivun käsivaiheista Tailscale-polkua
ei ole vielä käyttänyt yksikään kaveri (katso [Palvelin ryhmälle]({{ admin_page.url | relative_url }})).

**Lyhyt tapa: kaveripaketti.** Isäntä voi antaa sinulle pienen zip-tiedoston, joka on koottu
repositorion [`friend-kit/`]({{ site.github.repository_url }}/tree/dauntless-revived/friend-kit)-kansiosta.
Tee ensin vaihe 1 ja kaksoisnapsauta sitten `Setup.cmd`-tiedostoa: se tekee vaiheet 2–4 puolestasi ja
tarkistaa jokaisen tiivisteen. Sen jälkeen `Play Dauntless.cmd` tekee vaiheen 5 jokaisella
käynnistyskerralla. Alla olevat käsin tehtävät vaiheet näyttävät tarkalleen, mitä paketti tekee.

<details open markdown="block">
  <summary>Sisältö</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Mitä tarvitset {#what-you-need}

| Tarvike | Tiedot |
|:-----|:--------|
| Windows-tietokone | 64-bittinen Windows 10 tai 11. Peli vie levyltä noin 10,9 Gt (10,1 GiB). |
| Oma Dauntless 1.4.4 -asennus | Shipping-versio `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827`, joka tarkistetaan tiivisteellä vaiheessa 2. |
| Tailscale | Oma ilmainen tili sekä isännän jakaman koneen hyväksyminen. |
| Kaksi DLL-tiedostoa | `dxgi.dll` ja `UndauntedInternalServer.dll`, jotka tarkistetaan tiivisteellä vaiheessa 3. |
| Microsoft Visual C++ 2015-2022 Redistributable (x64) | `UndauntedInternalServer.dll` tarvitsee tiedostot `MSVCP140.dll` ja `VCRUNTIME140_1.dll`. Monessa koneessa ne ovat jo valmiina. |
| Kutsukoodi | Isännältä. Koodit ovat yleensä kertakäyttöisiä. |
| Käynnistysskripti | Annetaan vaiheessa 5. |

**Tämä sivusto ja repositorio eivät jaa peliä eivätkä linkitä sen latauksiin.** Mitä kopiota
käytätkin, vaihe 2 tarkistaa sen. Jos omasi tuli `BaseGame144.zip`-arkistona, josta alkuperäisen
Undauntedin käynnistin asentaa pelin, vaihe 2 kertoo myös arkiston tiivisteen. Sivulta
[Kiitokset ja lisenssi]({{ legal_page.url | relative_url }}) näet, miksi toimimme näin.

## Vaihe 1: Asenna Tailscale ja hyväksy isännän jako {#step-1-install-tailscale-and-accept-the-hosts-share}

Isännän palvelimella ei ole julkista osoitetta. Sen tavoittaa vain Tailscalen kautta, ja vain ne
ihmiset, joille isäntä on jakanut juuri sen yhden koneen. Tailscale on ohjelma, joka tekee salatun,
yksityisen yhteyden koneiden välille. Sivu [Palvelin ryhmälle]({{ admin_page.url | relative_url }})
kertoo, miksi näin on tehty.

1. Asenna Tailscale for Windows osoitteesta [tailscale.com/download](https://tailscale.com/download)
   ja kirjaudu sisään omalla tililläsi.
2. Avaa isännän jakokutsu (linkki tai sähköposti) ja hyväksy se. Isännän kone näkyy sen jälkeen
   Tailscalen konelistassasi. Et liity isännän verkkoon. Näet vain sen yhden koneen.
3. Ota isännän osoite talteen. `tailscale status` näyttää sen muodossa `100.x.y.z`. Sen pitäisi olla
   sama osoite, jonka isäntä antoi sinulle.
4. Testaa yhteys PowerShellissä:

```powershell
$Server = "100.x.y.z"   # the host's Tailscale address
tailscale ping $Server
Invoke-RestMethod "http://${Server}:61000/undaunted/api/RegistrationStatus"
```

`tailscale ping` -komennon pitäisi vastata `pong`. Jos vastauksessa lukee `via DERP(...)`, liikenteesi
kulkee Tailscalen välityspalvelimen (relay) kautta. Se toimii, mutta viive on suurempi. Toisen
komennon pitäisi tulostaa `RegistrationMode : INVITECODE`. Jos se aikakatkaistaan, Tailscale on pois
päältä, jakoa ei ole vielä hyväksytty tai isännän palvelin ei ole käynnissä.

## Vaihe 2: Tarkista pelitiedostosi {#step-2-verify-your-game-files}

Osoita `$Game` asennuskansioosi, siihen, jossa ovat kansiot `Archon`, `Engine` ja `EasyAntiCheat`:

```powershell
$Game = "C:\D144\Dauntless"
Get-Content "$Game\Version.txt"
(Get-FileHash "$Game\Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe" -Algorithm SHA256).Hash
```

| Mitä | Odotettu arvo |
|:-----|:---------|
| `Version.txt` | `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827` |
| `Dauntless-Win64-Shipping.exe` SHA-256 | `D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4` |
| `Dauntless-Win64-Shipping.exe` koko | 103 673 520 tavua |
| `BaseGame144.zip` SHA-256, jos sinulla on arkisto | `556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D` (10,48 Gt) |

Exe-tiedoston tiiviste on sama arvo, jonka alkuperäinen Undaunted-käynnistin tarkistaa. Jos se ei
täsmää, lopeta tähän: DLL-tiedostot eivät toimi eri version kanssa.

Isännän koneella tarkistimme vertailukopiomme perusteellisemmin. Kaikki 406 tiedostoa vastaavat
`Manifest.bin.json`-luetteloa, jonka Phoenix Labs toimitti asennuksen mukana, kaikkien 39
allekirjoitetun ohjelmatiedoston Authenticode-tiivisteet ovat yhä ehjiä, ja haittaohjelmatarkistus oli
puhdas. Löydökset-osiossa on yksityiskohdat. Sinulle riittää exe-tiedoston tiiviste.

## Vaihe 3: Kopioi kaksi DLL-tiedostoa {#step-3-copy-the-two-dlls}

Molemmat tiedostot menevät kansioon `<game folder>\Archon\Binaries\Win64\` eli pelikansiosi alle,
`Dauntless-Win64-Shipping.exe`-tiedoston viereen.

| Tiedosto | Koko | SHA-256 |
|:-----|-----:|:--------|
| `dxgi.dll` | 11 264 tavua | `9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F` |
| `UndauntedInternalServer.dll` | 123 392 tavua | `520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933` |

Saat ne isännältä, helpoimmin kaveripaketissa (katso yllä), tai
alkuperäisestä repositoriosta kansiosta
[`UndauntedLauncher/assets/`](https://github.com/SyST3MDeV/Undaunted/tree/main/UndauntedLauncher/assets).
Ne ovat samat tiedostot. Kopioinnin jälkeen tarkista ne ja poista niistä ”ladattu internetistä”
-merkintä:

```powershell
$W = "$Game\Archon\Binaries\Win64"
Get-FileHash "$W\dxgi.dll", "$W\UndauntedInternalServer.dll" -Algorithm SHA256 | Format-Table Hash, Path
Unblock-File "$W\dxgi.dll", "$W\UndauntedInternalServer.dll"
```

**Mitä ne tekevät.** Kun peli käynnistyy, Windows lataa `dxgi.dll`-tiedoston pelikansiosta ennen
järjestelmän omaa kopiota. Tämä välittäjä (proxy) lataa oikean järjestelmän `dxgi.dll`-tiedoston,
välittää sen kolme funktiota (exports) eteenpäin ja lataa `UndauntedInternalServer.dll`-tiedoston.
Tavallisessa käynnistyksessä (client-tilassa) tämä DLL lukee ensimmäisen komentoriviparametrin
palvelimen osoitteeksi. Sen jälkeen se kirjoittaa uudelleen taustapalvelun osoitteet, jotka peli lukee
asetuksistaan (167 avaimen taulukko sekä tilipalvelun asetukset): kuolleista `steelyard.ca`-palvelimista
osoitteeseen `http://<that address>/...` eli annettuun palvelinosoitteeseen. Kun sama DLL ladataan
prosessiin, joka on käynnistetty valitsimella `-server`, se muuttaa kyseisen peliohjelman
pelipalvelimeksi. Näin isäntä pyörittää Ramsgatea ja metsästyksiä.

**Mistä voimme mennä takuuseen ja mistä emme:**

- Nämä ovat alkuperäisen projektin valmiiksi käännetyt tiedostot. Kiinnitämme niiden tiivisteet. Emme
  ole vielä kääntäneet `UndauntedInternalServer.dll`-tiedostoa itse lähdekoodista todistaaksemme, että
  se vastaa julkaistua koodia. Versiomerkkijonot täsmäävät (0.0.3), mutta se ei ole todiste.
- `dxgi.dll`-tiedoston lähdekoodia ei ole koskaan julkaistu. Purimme sen konekielen luettavaan muotoon
  (disassembly): se tekee vain yllä kuvatut kolme asiaa eikä käytä mitään muuta kuin `KERNEL32`-kirjastoa
  ja C-kielen ajonaikaista kirjastoa. Aiomme korvata sen omalla pienellä välittäjällämme, joka
  käännetään lähdekoodista forkissamme.
- Virustorjunta voi merkitä DLL-välittäjän epäilyttäväksi, koska samaa tekniikkaa käytetään myös
  haittaohjelmissa. Tarkista tiivisteet ja päätä itse.

Jos haluat poistaa asennuksen, poista kaksi DLL-tiedostoa. Mitään muuta pelikansiossa ei muuteta.

Jos peli ei käynnisty ja näyttää viestin tiedostosta `MSVCP140.dll` tai `VCRUNTIME140_1.dll`, asenna
Microsoftilta Microsoft Visual C++ 2015-2022 Redistributable (x64).

## Vaihe 4: Rekisteröidy ja hanki henkilökohtainen avaimesi {#step-4-register-and-get-your-personal-key}

Rekisteröidyt kerran käyttäjänimellä ja kutsukoodilla. Palvelin vastaa **henkilökohtaisella
tiliavaimella**, merkkijonolla, joka alkaa `UUK_`. Avain on salasanasi. Peli kirjautuu sillä
puolestasi.

- **Kukaan ei voi palauttaa sitä, ei edes isäntä.** Palvelin tallentaa siitä vain SHA-256-tiivisteen.
  Jos kadotat sen, isännän on annettava sinulle uusi käsin.
- **Pidä se omana tietonasi.** Kuka tahansa, jolla on avaimesi, voi pelata sinuna.

**Käyttäjänimen valinta.** 3–16 merkkiä, vain kirjaimia, numeroita ja alaviivoja, ja nimen on
oltava ainutlaatuinen isoista ja pienistä kirjaimista riippumatta. Palvelin hylkää kaikki muut nimet
(katso taulukko alla). Hahmosi saa myös saman nimen ensimmäisellä kirjautumisella. Vain isäntä voi
vaihtaa nimesi myöhemmin.

Tämä skripti rekisteröi sinut ja tallentaa avaimen profiilikansioosi tulostamatta sitä. Se kieltäytyy
toimimasta toista kertaa, koska uusi rekisteröinti loisi toisen, tyhjän tilin.

```powershell
$Server   = "100.x.y.z"             # the host's Tailscale address
$Username = "YourName"              # 3-16 letters, digits or _
$Invite   = "code-from-the-host"

$dir = "$env:APPDATA\DauntlessRevived"
if (Test-Path "$dir\account.key") { throw "You already have a key in $dir. Registering again would create a second account." }
$body = @{ Username = $Username; InviteCode = $Invite } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://${Server}:61000/undaunted/api/Register" -ContentType "application/json" -Body $body
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Content -Path "$dir\account.key" -Value $r.UUK -NoNewline -Encoding ASCII
"Registered. Key saved to $dir\account.key"
```

| Palvelimen vastaus | Merkitys |
|:--------------|:--------|
| 200 | Rekisteröity. Avain on tiedostossa `account.key`. |
| 401 | Kutsukoodi on väärä tai jo käytetty (`invite_invalid`). |
| 400 | Rekisteröinti on suljettu (`registration_closed`) tai käyttäjänimi rikkoo sääntöjä (`username_invalid`). |
| 409 | Jollakulla on jo sama käyttäjänimi missä tahansa kirjainkoossa (`username_taken`). Valitse toinen: kutsukoodiasi ei kulutettu. |
| Ei vastausta | Tailscale on pois päältä tai isännän palvelin ei ole käynnissä. |

Hylkäyksen mukana tulee lyhyt JSON-muotoinen syy, `{"error": "<code>", "message": "..."}`, jonka
PowerShell näyttää virheen yhteydessä.

Tarkista, että avain toimii. Tämä tulostaa käyttäjätunnisteesi (user id), käyttäjänimesi ja sen,
oletko ylläpitäjä:

```powershell
$key = (Get-Content "$env:APPDATA\DauntlessRevived\account.key" -Raw).Trim()
Invoke-RestMethod "http://${Server}:61000/undaunted/api/GetUserInfo" -Headers @{ "x-undaunted-user-api-key" = $key }
```

Säilytä kopio `account.key`-tiedostosta turvallisessa paikassa, esimerkiksi salasanojen
hallintaohjelmassa.

Palvelin käyttää tavallista, salaamatonta HTTP:tä, joten avain kulkee verkossa salaamattomana
Tailscale-tunnelin sisällä. Tailscale salaa tuon tunnelin päästä päähän. Älä koskaan lähetä avainta
tälle palvelimelle avoimen internetin yli.

## Vaihe 5: Käynnistä {#step-5-launch}

**Pidä ensin peli erossa Epicin vanhasta chat-palvelimesta.** Dauntless 1.4.4:n chat- ja
paikallaoloyhteys (XMPP, eli tieto siitä, kuka on paikalla) osoittaa valmiiksi Epicin yhä toiminnassa
olevaan palvelimeen. Peli yrittää muodostaa siihen yhteyden yhä uudelleen ja lähettää tilisi tunnisteen ja
kirjautumistunnisteesi. Lisää tämä lohko tiedostoon
`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\Engine.ini` (luo tiedosto, jos sitä ei ole;
lainausmerkit ovat pakollisia) ja kirjoita isännän osoite kohdan `100.x.y.z` paikalle:

```ini
[OnlineSubsystemMcp.XMPP]
ServerAddr="ws://100.x.y.z"
ServerPort=61099
bUseSSL=false
```

Yhteys menee nyt Tailscalen kautta isännälle. Yksityisessä tilassa chat ei vielä toimi, joten
yhteys vain epäonnistuu, täsmälleen kuten se epäonnistuu Epiciä vastaan nykyään, ja peli jatkaa
normaalisti. Kaveripaketin `play.ps1` kirjoittaa tämän lohkon jokaisella käynnistyksellä.

Tallenna tämä nimellä `play.ps1` mihin tahansa. Se tarkistaa kolme kiinnitettyä tiivistettä ja
käynnistää sitten pelin isännän palvelinta vasten.

```powershell
param(
  [Parameter(Mandatory = $true)] [string]$Server,    # the host's Tailscale address
  [string]$Game = "C:\D144\Dauntless",
  [switch]$Windowed
)
$W   = Join-Path $Game "Archon\Binaries\Win64"
$exe = Join-Path $W "Dauntless-Win64-Shipping.exe"
$pinned = @{
  "Dauntless-Win64-Shipping.exe" = "D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4"
  "dxgi.dll"                     = "9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F"
  "UndauntedInternalServer.dll"  = "520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933"
}
foreach ($f in $pinned.Keys) {
  $p = Join-Path $W $f
  if (-not (Test-Path $p)) { throw "Missing: $p" }
  if ((Get-FileHash $p -Algorithm SHA256).Hash -ne $pinned[$f]) { throw "Hash mismatch: $p" }
}
$key = (Get-Content "$env:APPDATA\DauntlessRevived\account.key" -Raw).Trim()
$a = @("${Server}:61000", "-AUTH_PASSWORD=$key", "-AUTH_LOGIN=unused", "-AUTH_TYPE=exchangecode",
       "-epicapp=appidlol", "-epicenv=Prod", "-EpicPortal", "-epicusername=usernamelol",
       "-epicuserid=useridlol", "-epiclocale=en-US", "-epicsandboxid=sandboxidlol",
       "-epicdeploymentid=deploymentidlol")
if ($Windowed) { $a += @("-windowed", "-ResX=1280", "-ResY=720") }
Start-Process $exe -WorkingDirectory $W -ArgumentList $a | Out-Null
"Launched against ${Server}:61000"
```

Aja se:

```powershell
powershell -ExecutionPolicy Bypass -File .\play.ps1 -Server 100.x.y.z
```

Mitä parametrit tekevät:

- **Ensimmäinen parametri** on palvelimen osoite. DLL ottaa sen siitä.
- `-AUTH_TYPE=exchangecode` yhdessä parametrin `-AUTH_PASSWORD=<key>` kanssa saa pelin lähettämään
  avaimesi ”vaihtokoodina” (exchange code) palvelimen reitille `/account/api/oauth/token`. Palvelin
  vaihtaa sen kirjautumistunnisteeseen, joka on voimassa 24 tuntia.
- `-epic...`-arvot ovat paikanpitäjiä. Alkuperäinen käynnistin antaa juuri nämä, ja niin mekin. Emme
  ole testanneet, mitä niistä 1.4.4-peliohjelma oikeasti tarvitsee.
- Avaimesi on pelin komentorivillä, joten muut omalla koneellasi pyörivät ohjelmat voivat lukea sen.
  Alkuperäinen käynnistin toimii samalla tavalla.

Skripti käynnistää `Dauntless-Win64-Shipping.exe`-tiedoston suoraan. Älä käynnistä `Dauntless.exe`-tiedostoa
tai EasyAntiCheatin käynnistysohjelmaa. Suoralla käynnistyksellä EasyAntiCheat ei koskaan käynnisty.

**Mitä ruudulla tapahtuu:**

- DLL:n lokiruutu (musta tekstiruutu) on piilossa pelatessa. Jos haluat nähdä sen ongelmatilanteessa,
  ota käynnistimessä käyttöön Asetukset > Vianmääritys > "Näytä lokiruutu" ennen PELAA-painiketta.
  Jos näytät sen, **jätä se auki**: konsoli-ikkunan sulkeminen lopettaa prosessin, johon se kuuluu,
  eli tässä tapauksessa pelin.
- Ensimmäisellä kirjautumisellasi palvelin luo hahmosi, jolla on sama nimi kuin käyttäjänimelläsi, ja
  peli lähettää sinut opetusjaksoon yhdelle isännän metsästyspalvelimista. Sen jälkeen saavut
  Ramsgateen, pelin keskuskaupunkiin. Olemme testanneet tämän polun isännän omalla tilillä.
- F2 avaa Unrealin konsolin. DLL ottaa sen käyttöön.

## Vaihe 6: Grafiikka-asetukset {#step-6-graphics-options}

Pelin oma asetusvalikko toimii tavalliseen tapaan. Se tallentaa asetukset tiedostoon
`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\GameUserSettings.ini`.

Voit myös pakottaa asetuksia. Versiossa 1.4.4 käyttäjän `Engine.ini`-tiedoston
(`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\Engine.ini`) `[SystemSettings]`-osio ohittaa
valikon. Isännän oma käynnistin kirjoittaa tämän lohkon tiedoston alkuun jokaisella käynnistyksellä
pakottaakseen korkeimman tason:

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

- `sg.*`-tasot ovat 0 = Low, 1 = Medium, 2 = High, 3 = Epic, 4 = Cinematic. Käytä heikommalla koneella
  tasoa 2 tai 3.
- `r.Streaming.PoolSize=3000` asettaa tekstuurien suoratoistopoolin 3000 megatavuun, ja
  `LimitPoolSizeToVRAM=1` laskee rajaa vielä, jos näytönohjaimessasi on vähemmän muistia. Kaksi
  `gc`/`s.`-riviä vaikuttavat vain muistin siivoukseen, eivät kuvanlaatuun.
- `r.Tonemapper.Sharpen` kumoaa ajallisen reunanpehmennyksen (temporal anti-aliasing) aiheuttamaa
  pehmeyttä. Poista se, jos pidät alkuperäisestä ulkoasusta.
- Varmuuskopioi `Engine.ini` ennen muokkaamista. Säilytä muu osa tiedostosta, koska peli tallentaa
  sinne myös omia asetuksiaan. Poista lohko, jos haluat antaa ohjat takaisin valikolle.
- Cinematic-tasolla peliohjelma käytti isännän koneella noin 1,8–2,3 Gt keskusmuistia (RAM).
- `play.ps1 -Windowed` käynnistää pelin 1280x720-kokoiseen ikkunaan tallennetun näyttötilan sijaan.

## Mitä odottaa juuri nyt {#what-to-expect-right-now}

Tämä on pieni yksityinen elvytyshanke, ja työ on kesken. Tätä kirjoitettaessa:

- Omilla palvelimillamme yksi pelaaja on pelannut palvelinkoneella opetusjakson, Ramsgaten, Training
  Dojon (harjoitussalin), tavallisen metsästyksen ja takaa-ajon (pursuit), ja 22.9.2026 saman polun
  ensimmäiseen metsästykseen asti internetin yli vuokratulla palvelimella. Myöhemmin samana iltana
  kaksi pelaajaa metsästi siellä yhdessä, kun he jonottivat samaan metsästykseen muutaman sekunnin
  sisällä toisistaan. Alkuperäinen Undaunted kertoo, että metsästykset enintään neljän hengen
  ryhmissä toimivat; me olemme kokeilleet kahta.
- Slayer-taso, aseiden ja hirviöiden mestaruus (mastery) ja Hunt Pass alkavat alusta (Slayer-taso 1)
  ja tallentuvat, kun palvelimella on nykyinen koodi oletusasetuksin. Jokaisella tilillä on Elite Hunt
  Pass. Slayer-tason, aseen mestaruuden ja hirviön mestaruuden on kaikkien nähty nousevan pelissä. Jos
  palvelimella oli aiemmin vanhempi versio, tasosi voi päivityksen jälkeen alkaa uudelleen 1:stä: kysy
  isännältä.
- Ilmalaiva ennen metsästystä on toistaiseksi hyvin pimeä. Se on lyhyt kohtaus; katso
  [Vianetsintä]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out).
- Ryhmät (parties), kaverit ja killat on rakennettu palvelimelle, ja ne läpäisevät testimme, mutta
  kaksi pelaajaa ei ole vielä kokeillut niitä pelissä; katso alta
  [Kaverit, ryhmät ja killat](#friends-parties-and-guilds). Ennen kuin ryhmät on todettu toimiviksi, voitte myös jonottaa samaan metsästykseen suunnilleen samaan aikaan. Matchmaker
  (pelaajia yhteen sovittava osa) kerää pelaajat, jotka jonottavat samaan metsästykseen, ja
  käynnistää heille yhden palvelimen, kun neljä on liittynyt tai kun 20 sekuntia kuluu ilman, että
  kukaan uusi liittyy.
- Tekstichat on rakennettu, mutta sitä ei ole vielä kytketty päälle (katso alta). Käytä [Dauntless Revived Discordia](https://discord.gg/ZJRprHzsgu).
- Palkkiotehtävät (bounties) ja odotusajat (cooldowns) tallentuvat, mutta palkkiotehtävän valitsemista
  ja lunastamista sekä vuorokauden vaihdetta ei ole vielä kokeiltu pelissä. Escalation-sarjat ovat
  vain tynkiä, jotka eivät oikeasti tallenna mitään, eivätkä ne säily pelikerrasta toiseen, ellei
  isäntäsi ole kytkenyt oikeaa Escalationia päälle (silloin kaikki aloittavat uudelleen tasolta 0).
- Pelin kauppa on rakennettu, mutta se on pois päältä, ellei isäntäsi kytke sitä päälle. Kun se on
  päällä, kaikki siinä on ilmaista.
- Äänichat toimi Vivoxilla, joka on maksullinen ulkopuolinen palvelu, eikä se voi palata. Käytä
  [Dauntless Revived Discordia](https://discord.gg/ZJRprHzsgu).
- Jonkun omalla koneella pyörivä palvelin on poissa päältä, kun se kone on sammutettu. Vuokratulla
  koneella pyörivä palvelin ei riipu kenenkään omasta koneesta.

## Kaverit, ryhmät ja killat {#friends-parties-and-guilds}

**Tilanne (22.9.2026): rakennettu palvelimelle, kaksi pelaajaa ei ole vielä kokeillut.** Ensimmäisessä
kahden pelaajan testissä ryhmäkutsu ei koskaan näkynyt, eikä kaverin lisääminen (Add Friends) tehnyt
mitään. Kumpikin syy on löydetty ja korjattu palvelimella, ja killat ovat uusia. Kukaan ei ole vielä
kokeillut korjattua versiota pelissä, joten kerro isännälle, mitä näet.

**Kun isäntä on päivittänyt palvelimen, käynnistä peli kerran uudelleen.** Peli muistaa muista
pelaajista oppimansa asiat uudelleenkäynnistykseen asti, myös aiemmat väärät vastaukset.

Kaikki alla oleva löytyy **Social**-paneelista (Sosiaalinen), jossa ovat välilehdet My Friends, Add
Friends, My Links ja Guilds. **Kaikki näkyvät tilassa Offline, myös sinä itse.** Se on toistaiseksi
odotettua (katso tämän osion loppu); se ei tarkoita, ettei toinen pelaaja olisi paikalla.

### Lisää kaveri {#add-a-friend}

1. Avaa **Add Friends**, kirjoita toisen pelaajan käyttäjänimi ja paina **Add**. Kyseessä ei ole haku:
   nimen on oltava tarkka, mutta isoilla ja pienillä kirjaimilla ei ole väliä. Saat ilmoituksen
   "friend invite sent", eikä ruudullasi muutu muuta.
2. Toinen pelaaja näkee pyyntösi **seuraavalla kirjautumisellaan**, ei heti, ja voi valita
   **Accept** (hyväksy) tai **Decline** (hylkää).
3. Kun hän hyväksyy, näette toisenne **OFFLINE**-listalla seuraavan kirjautumisenne jälkeen.

Kaverin valikosta voit **poistaa** kaverin (Remove) tai **estää** pelaajan (Block): estetty siirtyy
kohtaan **BLOCKED**, välillänne avoinna olevat ryhmä- ja kiltakutsut poistetaan, eikä kumpikaan voi
lähettää toiselle kaveripyyntöjä, ryhmäkutsuja tai kiltakutsuja. **Unblock** poistaa eston. Palvelin sallii 200 kaveria, 50 vastaamatonta lähetettyä
pyyntöä ja 20 uutta pyyntöä 10 minuutissa.

### Kutsu joku ryhmääsi {#invite-someone-to-your-party}

Kavereita ei tarvitse olla. Ryhmässä on enintään 4 pelaajaa, ja vain ryhmän johtaja kutsuu.

1. Avaa **Social**, etsi pelaaja kohdasta **Hunt Members** (palvelimesi pelaajat) tai kavereistasi ja
   valitse **Invite to Party**.
2. Toinen pelaaja näkee kutsun kohdassa **PARTY INVITES** noin 10 sekunnin kuluessa ja valitsee
   **Accept**.
3. Kummankin ryhmäpaneelissa näkyvät molemmat nimet. Kun johtaja valitsee metsästyksen, koko ryhmä
   menee samalle metsästyspalvelimelle ja palaa johtajan mukana Ramsgateen.

Jos joku hylkää kutsusi, voit kutsua hänet uudelleen 2 minuutin kuluttua, ja voit lähettää 20 kutsua
10 minuutissa. Jos **Invite to Party** ei tee mitään, kun olet yksin, kerro isännälle: palvelimessa on
asetus juuri tätä tilannetta varten.

Jos pelin oma kutsu ei toimi, isäntä voi lähettää kutsun nimellä palvelimelta
([hallintarajapinnan]({{ '/fi/reference/api.html' | relative_url }}#undaunted-api) `PartyInvite`-reitti);
hyväksyt sen silti pelissä. Sama koskee kiltakutsuja (`GuildInvite`).

### Slayer Links {#slayer-links}

**Uusi, ei vielä kokeiltu pelissä.** **My Links** -välilehdellä kaksi kaveria voi liittoutua viikoksi:
kutsu kaveri johonkin kolmesta linkkipaikastasi, ja hän hyväksyy kutsun johonkin omaan paikkaansa.
Teidän on oltava kavereita, eikä kumpikaan saa olla estänyt toista. Kutsu odottaa vastausta 24 tuntia.
Voit poistaa linkin milloin tahansa; se päättyy teiltä molemmilta. Kaverin poistaminen tai estäminen
peruu välillänne vielä odottavat kutsut. Peli saattaa pitää välilehden piilossa; silloin mikään ei
muutu.

### Killat {#guilds}

- **Perusta kilta** **Guilds**-välilehdellä ollessasi Ramsgatessa: **CREATE GUILD**, sitten nimi,
  jossa on 4–15 englannin kirjainta ja numeroa (enintään 6 numeroa ja sama kirjain enintään 6 kertaa
  peräkkäin), ja halutessasi nimikyltti (2–6 kirjainta ja numeroa), joka näkyy pääsi yllä muodossa
  `[TAG]`. Ikkuna tarkistaa nimen kirjoittaessasi ja kertoo, jos se on varattu tai ei kelpaa.
  **Odota hetki kirjoittamisen jälkeen ja paina vasta sitten Create:** palvelin perustaa vain nimen ja
  nimikyltin, jotka ikkuna on tarkistanut puolestasi. Henkilökunnalta näyttävät sanat (admin,
  moderator, official, GM, DEV ja vastaavat) lasketaan varatuiksi. Killan perustaminen on ilmaista.
- **Kutsu** (johtaja ja upseerit): kirjoita pelaajan käyttäjänimi jäsenen lisäyskenttään (siinä lukee
  "Enter an Epic Games display name"; tällä palvelimella se on käyttäjänimi) tai valitse **Invite to
  Guild** minkä tahansa pelaajan valikosta.
- **Kutsuttu pelaaja** näkee kutsun kohdassa **GUILD INVITES** seuraavalla kirjautumisellaan tai
  matkustettuaan (metsästykseen ja takaisin Ramsgateen), ja voi valita **Accept** tai **Decline**.
  Kutsu on voimassa 7 päivää. Hyväksyäksesi sinun on ensin lähdettävä nykyisestä killastasi. Jos
  hylkäät kutsun, sama kilta voi kutsua sinut uudelleen 24 tunnin kuluttua.
- **Johtaja** voi tehdä jäsenistä upseereita ja takaisin, luovuttaa killan (**Promote To Guild
  Leader**; entisestä johtajasta tulee upseeri), erottaa jäseniä ja lakkauttaa killan. Johtaja ei voi
  lähteä: luovuta kilta tai lakkauta se. Upseerit voivat kutsua; jäsenet voivat lähteä.
- Killassa on enintään 100 jäsentä (isäntä voi muuttaa rajaa). Muut jäsenet näkevät muutokset
  seuraavalla kirjautumisellaan tai maailman latautuessa.

### Mikä ei vielä toimi {#what-does-not-work-yet}

- **Paikalla olo.** Kaikki näkyvät tilassa Offline, ja EPIC FRIENDS pysyy tyhjänä. Kavereiden
  näyttäminen paikalla on rakennettu chat-palvelimeen, mutta isäntä kytkee sen päälle vasta, kun chat
  itse toimii ja kaksi pelaajaa on kokeillut sitä.
- **Chat**: kuiskaukset sekä ryhmä-, kilta- ja Ramsgate-chat käyttäjänimin on rakennettu, mutta isäntä
  kytkee sen päälle vasta, kun kaksi pelaajaa on kokeillut sitä; siihen asti käytä [Dauntless Revived Discordia](https://discord.gg/ZJRprHzsgu). Aluksi
  Ramsgaten chat tavoittaa vain ne pelaajat, jotka matkustivat sinne kanssasi ryhmänä.
- **Muutokset näkyvät viiveellä.** Kaveripyynnöt, hyväksytyt pyynnöt ja kiltojen muutokset näkyvät
  toiselle pelaajalle hänen seuraavalla kirjautumisellaan (killoissa myös matkustamisen jälkeen), eivät
  heti.
- Äänichat ja kaveripalvelun viimeaikaiset pelaajat.

Jos jokin ei näy, kerro isännälle, mitä teit ja suunnilleen milloin; palvelin kirjaa jokaisen vaiheen
lokiin.

## Vianetsintä {#troubleshooting}

| Oire | Todennäköinen syy |
|:--------|:-------------|
| `Invoke-RestMethod` aikakatkaistaan | Tailscale on pois päältä, jakoa ei ole hyväksytty, tai isännän kone tai palvelin ei ole käynnissä. |
| Rekisteröinti vastaa 401 | Väärä tai jo käytetty kutsukoodi. Pyydä isännältä uusi. |
| Rekisteröinti vastaa 400 | Rekisteröinti on suljettu, tai käyttäjänimi ei ole 3–16 kirjainta, numeroa tai alaviivaa. |
| Rekisteröinti vastaa 409 | Käyttäjänimi on varattu (missä tahansa kirjainkoossa). Valitse toinen; kutsukoodi toimii yhä. |
| `play.ps1` sanoo `Hash mismatch` | Eri peliversio tai eri DLL-tiedostot. Ne eivät toimi yhdessä. |
| Peli käynnistyy ilman konsoli-ikkunaa eikä pysty kirjautumaan | `dxgi.dll` ei ole `Win64`-kansiossa, tai virustorjunta poisti sen tai siirsi sen karanteeniin. Tarkista, että molemmat DLL-tiedostot ovat paikallaan ja että tiivisteet täsmäävät. |
| Virhe tiedostosta `MSVCP140.dll` tai `VCRUNTIME140_1.dll` | Asenna Visual C++ 2015-2022 Redistributable (x64). |
| Matchmaking tai siirtyminen metsästykseen jumittaa | Kaikki isännän metsästyspaikat voivat olla varattuina (kuusi kerrallaan). Palvelin ei silloin pysty käynnistämään sinulle metsästystä, ja hakusi päättyy epäonnistuneena. Kerro isännälle. |
| Metsästys ei koskaan lataudu, tai sinut lähetetään takaisin | Metsästyspalvelin sulkee itsensä, kun siihen ei ole ollut kukaan yhteydessä yhteensä 50 sekuntiin, ja hidas kentän lataus voi kestää kauemmin. Kerro isännälle. |

## Oikeutesi lähdekoodiin {#your-right-to-the-source}

Palvelin, jolla pelaat, on muokattu versio [Undauntedista](https://github.com/SyST3MDeV/Undaunted),
jonka lisenssi on GNU AGPL-3.0. Koska käytät muokattua palvelinta verkon yli, sinulla on oikeus saada
sen koko lähdekoodi (lisenssin kohta 13). Koska isäntä antaa sinulle DLL-ohjelmatiedostoja, sinulla on
oikeus myös niiden lähdekoodiin (kohta 6).

- Forkimme lähdekoodi on [tämän sivuston repositoriossa]({{ site.github.repository_url }}), haarassa
  `dauntless-revived`. Kysy isännältä, mitä versiota (commit) hänen palvelimensa ajaa.
- Alkuperäisen projektin lähdekoodi on osoitteessa
  [github.com/SyST3MDeV/Undaunted](https://github.com/SyST3MDeV/Undaunted).
- Tunnettu puute: alkuperäinen projekti ei koskaan julkaissut valmiiksi käännetyn `dxgi.dll`-tiedoston
  lähdekoodia. Aiomme korjata tämän toimittamalla oman välittäjän, joka on käännetty lähdekoodista
  (katso vaihe 3).
- DLL sisältää MinHook-kirjaston, jonka lisenssi on BSD 2-Clause.

Sivulla [Kiitokset ja lisenssi]({{ legal_page.url | relative_url }}) on koko kuva. Se ei ole
oikeudellista neuvontaa.
