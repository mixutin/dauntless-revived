---
title: Steam Deck
parent: Asennus
nav_order: 4
description: "Dauntless Revived Steam Deckillä: natiivi Linux-käynnistin, 800p-grafiikka-asetus ja Protonin välivideoiden vianetsintä."
lang: fi
ref: setup/steam-deck
locale: fi_FI
---

# Steam Deck

**Kokeellinen tuki.** Dauntless Revived ajaa alkuperäisen Windowsin x86_64 Dauntless 1.4.4 -pelin Protonilla. Itse käynnistin toimii natiivina x86_64-Linux-ohjelmana. Automaattitestit on tehty, mutta oikeaa Steam Deck -pelisessiota ei vielä ole vahvistettu. Tämä ei ole Steam Deck Verified -merkintä.

## Asennus työpöytätilassa

1. Siirry **työpöytätilaan**. Käytä SteamOS:n mukana tulevaa Steamia ja Protonia. Älä poista käyttöjärjestelmän kirjoitussuojausta tai asenna järjestelmään paketteja `pacman`-komennolla vain tätä varten.
2. Lataa uusin Linuxin **x64 tar.gz** -paketti ja `SHA256SUMS.txt` [GitHub-julkaisuista](https://github.com/mixutin/dauntless-revived/releases/latest). Siirrettävä tar-paketti ei tarvitse AppImagen FUSE-tukea. Tarkista tiedoston SHA-256.
3. Pura paketti pysyvään kansioon, esimerkiksi `~/.local/opt/dauntless-revived`, ja käynnistä `DauntlessRevivedLauncher`. Aja natiivi **Linux-käynnistin**, älä Windows-asennusohjelmaa Protonilla.
4. Valitse työpöydän Steamissa **Games → Add a Non-Steam Game → Browse**, lisää Linux-käynnistin peliin ja määritä Steam Inputissa oikea kosketuslevy hiireksi sekä painallus vasemmaksi klikkaukseksi. Käytä tarvittaessa kosketusnäyttöä tai Steam + X -näppäimistöä.
5. Palaa **pelitilaan**. Käynnistä lisätty sovellus, liitä nykyisellä palvelinkutsulla ja tilillä ja lataa tai tarkista omat pelitiedostot. Jätä käynnistin käyntiin pelin ajaksi, koska se välittää julkisen palvelimen liikenteen.

Peli tarvitsee edelleen Steam Protonin tai Proton-GE:n. Jos yhteensopivuusympäristöä ei löydy, käynnistä sovellus asettamalla `DAUNTLESS_REVIVED_PROTON` osoittamaan Protonin `proton`-skriptiin.

## Steam Deckin grafiikka

Uudella Deck-asennuksella käynnistin tunnistaa SteamOS:n tai Valven laitteen ja valitsee automaattisesti **Steam Deck · Tasapainoinen (800p)**. Vanhat pelaajakohtaiset asetukset säilyvät. Asetuksen voi valita myös käsin kohdasta **Asetukset → Grafiikka**.

| Asetus | Arvo |
|:--|:--|
| Näyttö | 1280 × 800, 16:10, reunaton koko näyttö |
| Sisäinen resoluutio | 85 % |
| Piirtoetäisyys / reunojenpehmennys / tekstuurit | 2 / 2 / 2 |
| Varjot / jälkikäsittely / tehosteet / varjostus | 1 / 1 / 1 / 1 |
| Kasvillisuus | 0 |
| Tekstuurimuistin suoratoistopooli | 768 Mt |
| Valotus | Pelin oma automatiikka säilyy |

Voit kokeilla 40 FPS -rajaa Deckin suorituskykyvalikossa ja pienentää asetuksia tarvittaessa. Nämä asetukset eivät takaa tiettyä ruudunpäivitysnopeutta. Valinnainen 1280×720-turvaikkuna (Poet fix) ohittaa Deckin 800p-näyttöasetuksen.

## Mustat tai puuttuvat välivideot Linuxissa

Pelin `Logo.mp4` on H.264/AAC-videota ja Ubuntu-lokeissa näkyi `dxva_video_decode_accelerator_win.cc`-virheitä. Videokiihdytys on mahdollinen ongelman syy, mutta tämä ei yksin todista ongelman ratkenneen kaikissa välivideoissa.

Grafiikka-asetusten **Linux-videoiden yhteensopivuus** -valinta käyttää kahta peruttavaa käynnistysasetusta:

- Peliprosessin ympäristömuuttuja `WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER=1` kiertää Protonin tunnettua Media Foundation -DXGI-ongelmaa.
- Peli saa parametrin `-nocefaccelpaint`, joka poistaa CEF:n kiihdytetyn piirtotilan.

Uudet asetukset koskevat Linuxin peliprosessia, eivät Windows-käynnistystä. Käynnistä peli uudelleen. Jos toiminta huononee, kytke asetus pois päältä. Jos ongelma jatkuu, kokeile ajantasaista Proton-GE:tä ja kerää virhetilanteen kuvaus sekä tunnistetiedoista puhdistetut lokit.

**Tilanne:** Asetusten kirjoitus ja käynnistysparametrit on testattu automaattisesti. Oikeaa Steam Deck -pelisessiota tai kaikkien välivideoiden toimivuutta ei vielä ole vahvistettu. Muut Linux-ohjeet: [Linux-käynnistin](linux.html).
