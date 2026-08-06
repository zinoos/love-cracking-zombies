# Online stellen

## Warum es nicht mit Firebase Hosting allein geht

Firebase Hosting liefert **nur statische Dateien** aus und kann **keine
WebSocket-Verbindungen** durchreichen. Das Spiel braucht aber einen dauerhaft
laufenden Server (Lobbys, 60-Hz-Simulation, 30-Hz-Snapshots).

Deshalb zwei Teile:

| Teil | Wo | Was |
|------|-----|-----|
| Client (HTML/JS/CSS) | Firebase Hosting | statische Dateien |
| Spielserver (Node + `ws`) | **Render** (oder Cloud Run) | WebSockets, Matchlogik |

---

## Aktuell im Betrieb: Wächter auf dem PC

```bash
npm run watchdog
```

Der Wächter hält den Betrieb ohne Zutun aufrecht:

1. startet den Spielserver und startet ihn neu, wenn er abstürzt
2. startet den Cloudflare-Schnelltunnel und liest seine Adresse aus
3. pingt die Adresse alle 30 s an — antwortet sie zweimal nicht, wird der
   Tunnel neu gestartet
4. bei neuer Adresse: baut `dist/` neu und veröffentlicht auf Firebase Hosting

**Warum das nötig war:** ein Schnelltunnel bekommt bei jedem Start eine neue
Zufallsadresse und stirbt gelegentlich weg — der `cloudflared`-Prozess läuft
dann noch, aber die Adresse antwortet nicht mehr. Auf der Webseite stand dann
„Kein Spielserver erreichbar", obwohl der Server lief. Von Hand hiess das jedes
Mal: Tunnel neu starten, Adresse eintragen, neu veröffentlichen.

### Nach jeder Anmeldung automatisch starten

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

Legt eine `.cmd` im Autostart-Ordner an (kein Adminrecht nötig, anders als die
Aufgabenplanung). Entfernen mit `-Entfernen`. Die Ausgabe landet in
`watchdog.log`.

**Grenze:** Das Spiel läuft nur, solange dieser PC an ist. Für echten
Dauerbetrieb siehe Variante 0.

---

## Variante 0 — Render, kostenlos und ohne Kreditkarte (dauerhaft)

`render.yaml` liegt im Repo, Render erkennt es als Blueprint.

### Einmalig

1. Repo zu GitHub schieben.
2. Auf https://render.com mit dem GitHub-Konto anmelden.
3. **New → Blueprint** → das Repo auswählen. Render liest `render.yaml`.
4. Beim Anlegen fragt Render nach `GOOGLE_SERVICE_ACCOUNT` (im Blueprint als
   `sync: false` markiert, also bewusst nicht im Repo). Dort den kompletten
   Inhalt des Dienstkonto-Schlüssels einfügen — eine Zeile, JSON.
5. Danach die Render-URL in den Client eintragen:

```bash
npm run build:hosting -- --server=DEIN-DIENST.onrender.com
npx firebase-tools deploy --only hosting
```

### Was am freien Plan anders ist

- **Kein dauerhaftes Dateisystem.** Deshalb liegt die Bestenliste in Firestore
  (`server/store.js`), nicht in `data/players.json`. Ohne den Schlüssel in
  `GOOGLE_SERVICE_ACCOUNT` fällt der Server auf die lokale Datei zurück — in
  der Cloud wäre die Liste dann nach jedem Neustart leer.
- **Der Dienst schläft nach 15 Minuten ohne Zugriff ein.** Der nächste Aufruf
  weckt ihn, das dauert ungefähr eine Minute. Laufende Lobbys sind dann weg,
  die Bestenliste nicht.
- **Nur eine Instanz.** Der freie Plan skaliert ohnehin nicht — genau richtig,
  denn Lobbys liegen im Arbeitsspeicher eines einzelnen Prozesses.

---

## Variante A — alles auf Cloud Run (braucht Kreditkarte)

Eine URL, ein Dienst, keine Trennung. Der Container ist gebaut und getestet.

### Voraussetzungen

1. **Blaze-Tarif** im Firebase-Projekt aktivieren (Cloud Run gibt es nicht auf
   Spark). Kostet bei diesem Spiel im Leerlauf wenige Cent pro Monat, aber eine
   Kreditkarte ist Pflicht.
   → https://console.firebase.google.com/project/shootergame2d/usage/details
2. **gcloud CLI** installieren: https://cloud.google.com/sdk/docs/install

### Deploy

```bash
gcloud auth login
gcloud config set project shootergame2d
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

gcloud run deploy neon-strike \
  --source . \
  --region europe-west6 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --memory 512Mi
```

**Die drei markierten Flags sind nicht optional:**

- `--max-instances 1` — Lobbys liegen im Arbeitsspeicher. Bei mehreren Instanzen
  landen zwei Spieler mit demselben Code auf verschiedenen Servern und sehen
  sich nicht.
- `--min-instances 1` — sonst fährt Cloud Run auf null herunter und alle
  laufenden Lobbys sind weg.
- `--timeout 3600` — Standard sind 5 Minuten, danach würde die WebSocket-
  Verbindung mitten im Match gekappt.

Danach gibt `gcloud` eine URL wie `https://neon-strike-xxxx-oa.a.run.app` aus —
das ist das fertige Spiel.

### Hübsche Domain davor (optional)

```bash
npm run build:hosting -- --server=neon-strike-xxxx-oa.a.run.app
firebase deploy --only hosting
```

Dann läuft der Client auf `https://shootergame2d.web.app` und verbindet sich
per `wss://` direkt zu Cloud Run.

---

## Variante B — nur Client auf Firebase Hosting

Wenn der Spielserver woanders läuft (eigener Server, Render, Fly.io, …):

```bash
npm run build:hosting -- --server=dein-server.example.com
firebase deploy --only hosting
```

`--server=` trägt die Adresse in `dist/js/config.js` ein. Der Server muss über
**`wss://`** erreichbar sein — eine HTTPS-Seite darf kein unverschlüsseltes
`ws://` öffnen, das blockiert der Browser.

---

## Lokal testen wie in der Cloud

```bash
npm run docker:build
npm run docker:run          # http://localhost:3000
```

Getrennter Aufbau (Client statisch, Server separat) lässt sich so prüfen:

```bash
npm run build:hosting -- --server=localhost:3000
# dist/ mit irgendeinem Static-Server ausliefern, Server per npm start
```

Zum schnellen Gegentest geht auch `?server=host:port` an der URL, z.B.
`http://localhost:5000/?server=localhost:3000`.

---

## Google-Anmeldung

Ist im Projekt `nosershooter` aktiv. Autorisierte Domains:
`localhost`, `nosershooter-2f2c4.web.app`, `nosershooter-2f2c4.firebaseapp.com`.

Kommt eine eigene Domain dazu, muss sie hier ergänzt werden:
Firebase-Konsole → Authentication → Settings → Authorized domains.

Der Spielserver prüft ID-Tokens gegen `AUTH_PROJECT` (Standard `nosershooter`).
Wird das Projekt gewechselt, muss die Umgebungsvariable mitgezogen werden —
sonst werden alle Anmeldungen abgelehnt.

## Hosting-Site `nosershooter` anlegen

`firebase.json` ist bereits auf die Site `nosershooter` gestellt
(→ `https://nosershooter.web.app`). Die Site muss im Projekt einmal existieren:

```bash
firebase login                                   # Konto, dem shootergame2d gehoert
firebase use shootergame2d
firebase hosting:sites:create nosershooter       # einmalig
firebase deploy --only hosting
```

`firebase init` ist nicht noetig — `firebase.json` und `.firebaserc` sind
bereits fertig und getestet. `init` wuerde sie nur interaktiv neu schreiben.

Bestehende Sites anzeigen: `firebase hosting:sites:list`

## Falsches Konto in der CLI

`firebase projects:list` zeigt, welches Konto gerade aktiv ist. Fehlt
`shootergame2d` in der Liste, ist die CLI mit einem anderen Google-Konto
angemeldet als die Firebase-Konsole:

```bash
firebase logout
firebase login
```

Alternativ das CLI-Konto in der Konsole als Mitglied des Projekts eintragen:
Projekteinstellungen → Nutzer und Berechtigungen.

---

## Grenzen dieses Aufbaus

- **Ein Server, ein Prozess.** Es gibt keine Skalierung. Für ein paar Dutzend
  gleichzeitige Spieler reicht das locker (eine Lobby kostet ~1,5 KB pro
  Snapshot bei 30 Hz). Für mehr bräuchte es einen geteilten Zustand, z.B.
  Lobby-Zuordnung über Redis.
- **Kein Neustart ohne Verlust.** Ein Deploy beendet laufende Matches.
- **Lobbys leben nur im Speicher.** Sterne und Bestenliste liegen dagegen in
  Firestore und überleben jeden Neustart. Skins liegen im `localStorage` des
  Browsers.
