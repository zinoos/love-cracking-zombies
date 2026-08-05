# NEON STRIKE — 2D Online Arena Shooter

Top-Down-Multiplayer-Shooter mit Lobby-Codes, vier Spielmodi, 17 Maps und
server-autoritativer Simulation. Läuft komplett lokal — keine externen Assets,
keine CDN-Abhängigkeiten.

## Starten

```bash
npm install
npm start
```

Dann `http://localhost:3000` öffnen. Der Server gibt beim Start zusätzlich die
LAN-Adresse aus — darüber können Mitspieler im selben Netz beitreten.

Fürs Internet: siehe **[DEPLOY.md](DEPLOY.md)**. Kurzfassung — Firebase Hosting
kann keine WebSockets, der Spielserver muss auf Cloud Run laufen.

## Spielablauf

1. **Anmelden** mit Google (oder als Gast weiterspielen — dann ohne Sterne).
2. **Name** im Hauptmenü eintragen (wird in `localStorage` gespeichert).
3. **Skinlocker** — Uniformfarbe, Effektfarbe und Tarnmuster wählen. Die Figur ist
   ein Cartoon-Soldat von oben (Helm, Uniform, Rucksack, Stiefel); die gewählte
   Farbe färbt Helm, Uniform, Arme und Beine mit.
4. **Gruppe erstellen** → 6-stelliger Raumcode erscheint, per Klick kopierbar.
5. Mitspieler wählen **Gruppe beitreten** und tippen den Code ein.
6. Host wählt den Modus und startet. Max. 6 Spieler pro Lobby.

## Modi

| Modus | Spieler | Ziel | Zeitlimit |
|-------|---------|------|-----------|
| Alle gegen Alle | 2–6 | 12 Kills | 5:00 |
| 1 vs 1 | 2 | 8 Kills | 4:00 |
| 2 vs 2 | 4 | 15 Team-Kills | 5:00 |
| 3 vs 3 | 6 | 20 Team-Kills | 5:00 |

Läuft die Zeit ab, gewinnt die höhere Punktzahl (bei Gleichstand: Unentschieden).

## Steuerung

| Taste | Aktion |
|-------|--------|
| `W` `A` `S` `D` | Bewegen |
| Maus | Zielen |
| Linksklick | Schießen / zuschlagen / Mine zünden |
| Rechtsklick | Granate werfen (2 pro Match) |
| `R` | Nachladen |
| `Shift` | Dash — 2,4 s Cooldown, bei schweren Waffen 4,8 s |
| `Tab` | Scoreboard |
| `M` | Sound an/aus |
| `Esc` | Match verlassen |

## Waffen

Vor jedem Match werden **drei zufällige Waffen zur Wahl** gestellt — eine davon
gilt für die Runde. Wer nicht wählt, bekommt eine der drei zugelost.

Dreizehn Waffen. Jede hat eine **eigene Mechanik**, keine ist eine Zahlenvariante
einer anderen. Wer viel Schaden oder Reichweite hat, zahlt mit Tempo, Magazin
oder Nachladezeit.

| Waffe | Mag | Schaden | TTK | Reichweite | Tempo | Eigene Mechanik |
|-------|-----|---------|-----|-----------|-------|-----------------|
| Schwert | ∞ | 35 | 0,99 s | **68 px** | **222 px/s** | **Rundumschlag 360°**, 0,5 s unsichtbar nach jedem Kill |
| MP | 35 | 15 | 0,45 s | 300 px | 196 px/s | zweitschnellste Bewegung, höchste Feuerrate |
| Pistole | 15 | 25 | 0,75 s | 400 px | 185 px/s | volles Tempo, 15 Schuss, schnellstes Nachladen |
| Revolver | 5 | 40 | 1,10 s | 420 px | 181 px/s | **letzte Patrone macht 80**, Rückstoß trägt dich |
| Schrotflinte | 6 | 8×9 | 0,80 s | 210 px | 174 px/s | breitester Schrotkegel, nur auf Tuchfühlung |
| Armbrust | 1 | 55 | 1,55 s | 580 px | 170 px/s | **lautlos** — verrät dich im Busch nicht |
| Sergio | 1 | 34 | — | 280 px | 189 px/s | **Schallplatte prallt ab und kommt zurück**, trifft zweimal |
| AK-47 | 20 | 18 | 0,65 s | 460 px | 167 px/s | größte Reichweite der Automatikwaffen |
| Minenleger | 1 | **99** Splash | 1,60 s | 310 px | 159 px/s | **fliegt über Wände, unsichtbar, von Hand gezündet** |
| Scharfschütze | 5 | 70 | 1,25 s | **780 px** | 155 px/s | Durchschlag, kein Schadensabfall |
| Granatwerfer | 5 | 55 Splash | 0,90 s | 560 px | 148 px/s | prallt von Wänden ab, Zeitzünder |
| Flammenwerfer | 200 | 2×5 | 0,45 s | 240 px | 133 px/s | setzt in Brand — 9 Schaden/s für 3,5 s |
| Minigun | 100 | 9 | 1,16 s | 400 px | 115 px/s | 0,55 s Anlaufzeit |
| Bazooka | 4 | 75 Splash | 1,50 s | 900 px | **107 px/s** | sprengt Wände |

Grundtempo **185 px/s**. Die Kugelwaffen treffen härter als früher — Gefechte
sind kürzer, der erste saubere Treffer zählt.

Reichweite ist die zentrale Stellschraube: `bulletLife = range / bulletSpeed`.
Wer an einer Waffe dreht, ändert nur `range` — Tempo und Lebensdauer bleiben
konsistent.

### Sonderfälle

**Schwert** ist ein **Rundumschlag**: er trifft alles im Umkreis von 68 px,
auch was hinter dem Träger steht. Kein Geschoss, keine Munition, Wände
blockieren den Hieb. **35 Schaden** bei **0,495 s** zwischen zwei Hieben — drei
Treffer bis zum Kill, knapp eine Sekunde am Gegner kleben. Der Soldat dreht sich
dafür sichtbar einmal um sich selbst (0,26 s) und zieht dabei einen Lichtring.

Nach **jedem Kill mit dem Schwert** ist der Träger **0,5 Sekunden unsichtbar**:
Gegner bekommen ihn nicht mehr geschickt — weder die Figur noch die Effekte
seines Hiebs. Er selbst und seine Mitspieler sehen ihn als Schemen, das HUD
zählt die Restzeit herunter. Ein halber Atemzug, um aus der Schusslinie zu
kommen — kein Verschwinden. Beim Respawn verfällt die Tarnung.

**Sergio** ist ein DJ mit Pult vor der Brust. Er wirft eine Schallplatte, die
geradeaus fliegt, bis zu dreimal von Wänden **abprallt** und nach 280 px
umkehrt — auf dem Rückweg fliegt sie durch Wände zurück in seine Hand. Sie
trifft auf Hin- und Rückweg je einmal, denselben Gegner also höchstens zweimal
pro Wurf. **Nachgeladen wird nicht:** erst wenn die Platte wieder in der Hand
liegt, ist der nächste Wurf frei. Wer daneben wirft, steht so lange ohne Waffe
da. Stirbt der Werfer, löst sich die Platte auf.

**Minenleger**: erster Linksklick wirft die Mine — sie fliegt in gerader Linie
**über Wände hinweg**, aber nur **310 px** weit. Nach der Landung ist sie scharf
(0,35 s Verzögerung). Gegner sehen sie nicht und können darüberlaufen. Der zweite
Linksklick zündet sie: **99 Schaden im ganzen Radius** von 96 px, ohne Abfall
zum Rand hin — wer voll bei Leben ist, überlebt mit 1 HP. **Nachschub gibt es
erst nach der Explosion.** Wer stirbt, verliert seine gelegte Mine.

**Schwere Waffen** (Flammenwerfer, Granatwerfer, Minigun, Bazooka) haben den
doppelten Dash-Cooldown.

**Granaten:** jeder hat 2 pro Match, Wurf per Rechtsklick. 1 s Zünder, 80 Schaden
im Zentrum, prallen von Wänden ab und zerstören Wände *und* Büsche. Eigener
Schaden zählt zu 60 %, Teammates nehmen keinen Schaden. Die Wurfweite folgt der
Cursordistanz, damit die Granate dort landet, wo gezielt wurde.

**Zerstörbares Terrain:** Bazooka und Granaten sprengen Innenwände zu begehbarem
Schutt und rasieren Büsche weg. Die Außenmauer bleibt stehen. Der Server ist
autoritativ und schickt geänderte Kacheln im Snapshot; der Client zeichnet nur
den betroffenen Ausschnitt neu.

## Sichtfeld

Man sieht **nur nach vorn**, wie ein Mensch: ein Kegel von 106°, der sich mit
der Blickrichtung mitdreht. Reichweite 620 px. Direkt um sich herum (95 px)
nimmt man alles wahr, auch von hinten.

**Gedächtnis:** einmal erkundetes Gelände bleibt schwach sichtbar, damit man
sich orientieren kann. Gegner dort sieht man trotzdem nicht — nur das Layout.
Liegt als 32×32-Pixel-Canvas in Kachelauflösung und kostet praktisch nichts.

Die Kanten sind weichgezeichnet (halb aufgelöste Nebelebene) und die
Blickrichtung wird leicht nachgezogen, damit die Kante beim Drehen nicht springt.

Der Server setzt das durch — Gegner außerhalb des Kegels werden gar nicht erst
gesendet. Auch die Bots sehen nur ihren Kegel und schwenken beim Laufen den Kopf.

## Sterne & Bestenliste

Anmeldung mit Google (oder als Gast ohne Sterne). Nach jedem Match wird nach
Kills sortiert, die **obere Hälfte gewinnt** Sterne, die **untere verliert**:

| Spieler | Verteilung |
|---------|-----------|
| 2 | +3 · −1 |
| 4 | +5 · +1 · −1 · −3 |
| 6 | +7 · +3 · +1 · −1 · −3 · −5 |

Formel: `(Mitte − Platz) × 2`, Platz 1 zusätzlich +2, im Teammodus +2 fürs
Siegerteam. **Unter 0 Sterne geht es nie.** Bots und Gäste sammeln nichts.

**Auf der Liste steht jeder, der sich je angemeldet hat** — auch ohne
gespieltes Match (dann mit 0 Sternen und dem Hinweis `NOCH KEIN SPIEL`).
Sortiert nach Sternen, dann Siegen, Kills, Spielen, Name.

Der Server ist alleinige Quelle: Clients melden nie eigene Punktestände. Das
Google-ID-Token wird serverseitig gegen Googles öffentliche Zertifikate geprüft
(`server/auth.js`), die Stände liegen in `data/players.json`.

## Spielregeln

- **Schaden:** ab der jeweiligen Falloff-Distanz sinkt der Schaden bis auf das
  Waffenminimum. Die Sniper hat keinen Abfall, die Schrotflinte den stärksten.
- **Büsche:** Wer darin steht, ist für Gegner unsichtbar — außer er schießt
  (0,7 s sichtbar), steht näher als 62 px oder teilt sich den Busch. Die
  Armbrust ist lautlos und verrät nicht.
- **Wände:** blockieren Kugeln *und* Sicht. Der Server sendet Gegner erst gar
  nicht, wenn keine Sichtlinie besteht (kein Wallhack möglich).
- **Packs:** grün = +45 HP, gelb = volles Magazin + Granate. Respawnen nach
  14 bzw. 10 s.
- **Respawn:** 3 s, danach 1,6 s unverwundbar.
- **Regeneration:** 14 HP/s, 5 s nach dem letzten Treffer.

## Maps

Siebzehn deterministisch generierte, quadratische 32×32-Kachel-Arenen
(1280×1280 px), 180°-rotationssymmetrisch für faire Spawns:

| Map | Charakter |
|-----|-----------|
| Crossfire | Kreuzkorridore, viel Wand |
| Foundry | Säulenraster, offen |
| Thicket | Buschwerk mit Sichtschneisen |
| Bunker | große Räume mit Türen |
| Labyrinth | DFS-Maze mit breiten Gängen |
| Arena | offene Mitte, Deckungsring |
| Canyon | diagonale Wandbänder |
| Grove | Felsen und Buschcluster |
| Zitadelle | Festungsringe mit vier Toren |
| Sumpf | Buschinseln, kaum feste Wand |
| Werft | lange Hallen mit Durchbrüchen |
| Krater | Ringwall um offene Mitte |
| Kaserne | Stuben am Raster, breite Flure |
| Schlucht | enge Serpentinen |
| Turm | verschachtelte Ringe |
| Dschungel | Buschlabyrinth mit Lichtungen |
| Ruine | eingestürzte Mauerzüge, überwuchert |

Jede Map wird gegen Bots durchgespielt, bevor sie bleibt: Wand- und Buschanteil,
begehbare Fläche, Spawns, und ob in allen vier Modi tatsächlich gekämpft wird.
Zu verwinkelte Karten führen mit dem Sichtkegel dazu, dass sich zwei Spieler ein
ganzes Match lang verfehlen — Thicket, Turm und Kaserne mussten deshalb geöffnet
werden.

Die Map wird pro Match zufällig gezogen. Server und Client erzeugen sie aus der
Map-ID mit demselben Seed — es geht keine Geometrie über das Netz.

## Flüssigkeit

Zwei Stellschrauben, weil Ruckeln zwei verschiedene Ursachen haben kann:

**Netz.** Gegner werden absichtlich leicht verzögert dargestellt, damit zwischen
zwei Snapshots interpoliert werden kann. Diese Verzögerung wird laufend an die
gemessene Schwankung der Ankunftszeiten angepasst (90–320 ms). Läuft der Puffer
trotzdem leer, wird bis zu 140 ms mit der letzten Geschwindigkeit fortgeschrieben,
statt einzufrieren und dann zu springen. Die Ping-Anzeige zeigt die Schwankung
mit an (`42 ms ±18`) — sie sagt mehr über das Spielgefühl aus als der Ping.

**Darstellung.** Wird das Zeichnen zäh, fallen automatisch Weichzeichner,
Strahlendichte und Nebelauflösung zurück; erholt sich die Bildrate, geht es
wieder hoch. Manuell über `RENDER.setQuality(0|1|2)`, `-1` schaltet zurück auf
automatisch.

Gemessen bei 1600×900 mit 6 Spielern: die reine Zeichenzeit liegt bei ~3 ms und
ändert sich zwischen den Stufen kaum — der Gewinn steckt im Compositing.
Über 2,5 s: **85 Bilder auf „hoch", 133 auf „niedrig"** (34 → 53 fps).

## Features

- Server-autoritative Simulation mit 60 Hz Tick, 30 Hz Snapshots
- Client-Prediction + Reconciliation für die eigene Figur, adaptive
  Interpolation (90–320 ms) für alle anderen
- Sichtlinien- und Sichtkegel-Filter serverseitig, Fog-of-War mit Schattenwurf
  und Geländegedächtnis clientseitig
- Bots mit Zielvorhaltung, Strafing, Deckungssuche, Waffenkenntnis und
  Health-Pack-Logik
- Lobby-Chat, Team-Wechsel, Teams mischen, Kick, Bot hinzufügen
- Killfeed, Live-Scoreboard, Multikill- und Serien-Ansagen, Schadenszahlen
- Cartoon-Soldaten komplett in Canvas gezeichnet, 13 eigene Waffenmodelle —
  kein einziges Bild-Asset
- Fünf Tarnmuster: einfarbig, Streifen, Flecktarn, Rangstreifen, Splittertarn
- Partikel, Blutdecals, Hülsen, Mündungsfeuer, echte Flammenzungen, Screenshake,
  Leichen-Animation
- Minimap, Fadenkreuz mit Rückstoß-Spread und Reichweitenanzeige, Trefferanzeige
- Prozedural synthetisierte Sounds (WebAudio, keine Audiodateien)
- Auto-Reconnect, Ping- und Jitter-Anzeige

## Firebase / Analytics

Anmeldung läuft über das Projekt `nosershooter`, Analytics über `shootergame2d`
(zwei getrennte Firebase-Apps im selben Client).

- Das SDK liegt in `node_modules/firebase` und wird vom eigenen Server unter
  `/vendor/firebase/…` ausgeliefert — **kein CDN**, das Spiel bleibt LAN-tauglich.
- `public/js/firebase.js` initialisiert beide Apps und prüft `isSupported()`,
  bevor Analytics startet. Fehlt das SDK oder das Internet, sind alle Aufrufe
  No-Ops — das Spiel läuft unverändert weiter.
- Gemeldete Events: `login`, `logout`, `lobby_create`, `lobby_join`,
  `weapon_picked`, `leaderboard_open`, `match_start`, `match_end`.
- Eigene Events: `FB.log('name', { … })`.

**Opt-out:** `localStorage.setItem('ns_analytics','off')` (oder `FB.setEnabled(false)`)
schaltet Analytics ab. Für einen öffentlichen Betrieb in der EU braucht es
zusätzlich ein Consent-Banner.

**Zum API-Key:** Firebase-Web-Keys sind öffentlich — sie identifizieren das
Projekt, sie autorisieren nichts. Der Schutz kommt aus Security Rules und aus
den Key-Restriktionen in der Google-Cloud-Konsole.

## Projektstruktur

```
server.js            HTTP + WebSocket, Raumverwaltung, Spielschleife
server/match.js      Match-Simulation, Waffen, Treffer, Sichtbarkeit, Snapshots
server/bots.js       Bot-KI
server/auth.js       Prüfung der Google-ID-Tokens
server/stars.js      Sterne und Bestenliste
shared/constants.js  Balancing-Werte, Waffen, Modi (Server + Client)
shared/maps.js       Map-Generatoren (Server + Client)
shared/physics.js    Kollision, Sichtlinie, Raycast (Server + Client)
public/index.html    Alle Screens
public/style.css     UI
public/js/config.js  Adresse des Spielservers
public/js/net.js     WebSocket-Client
public/js/auth.js    Google-Anmeldung
public/js/main.js    Input, Prediction, Events, Spielschleife
public/js/render.js  Canvas-Renderer, Fog-of-War, Minimap, Waffenmodelle
public/js/fx.js      Partikel & Effekte
public/js/ui.js      Menüs, Lobby, HUD, Bestenliste
public/js/audio.js   Sound-Synthese
scripts/build-hosting.js   Baut dist/ für Firebase Hosting
```

## Balancing anpassen

Alle Werte stehen in `shared/constants.js` und gelten sofort für Server und
Client (Seite neu laden, Server neu starten).

## Grenzen dieses Aufbaus

- **Ein Server, ein Prozess.** Lobbys liegen im Arbeitsspeicher. Für ein paar
  Dutzend gleichzeitige Spieler reicht das (eine Lobby kostet ~1,5 KB pro
  Snapshot bei 30 Hz); für mehr bräuchte es geteilten Zustand, z.B. über Redis.
- **Kein Neustart ohne Verlust.** Ein Deploy beendet laufende Matches.
- **Skins** liegen nur im `localStorage` des Browsers, nicht am Konto.
