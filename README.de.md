# VEGA Delivery

Open-Source-Auslieferungsplanung für kleine und mittlere Lieferteams: **Adressbuch**, **Produkte**
und **Bestellungen** pflegen, daraus **Touren** planen, eine **für Auto optimierte Route mit
Turn-by-Turn-Navigation** in der Fahrer-App erhalten, jede Zustellung protokollieren (zugestellt,
Annahme verweigert mit Grund, Abbruch …) und Kunden die Lieferung per **Live-Tracking-Link**
verfolgen lassen – benachrichtigt per **E-Mail und WhatsApp**.

> English version: [README.md](README.md)

Lizenz: **AGPL-3.0-only** – wer eine veränderte Version als Dienst anbietet, muss die Änderungen veröffentlichen.

## Funktionen

- **Adressbuch** – Kunden mit geokodierter Adresse (Pin auf der Karte korrigierbar), Kontakt,
  Einwilligung zur Benachrichtigung, Zustellhinweisen, Zeitfenstern, CSV-Import/-Export.
- **Produkte** – Kategoriebaum und Produkte (Art.-Nr., Einheit, Preis, MwSt., EAN-13).
- **Bestellungen** – Positionen aus Produkten oder frei, Liefertermin und Zeitfenster, Status,
  Neu-Terminierung, Lieferlabels als PDF.
- **Touren** – offene Bestellungen eines Tages einplanen (mehrere Bestellungen eines Kunden = ein
  Stopp), Reihenfolge fürs Auto optimieren (exakt bis 13 Stopps, darüber 2-opt/Or-opt, weiche
  Zeitfenster, fixierte Positionen), manuell umsortieren, Fahrer zuweisen, freigeben, Ladeliste
  und Labels als PDF, Live-Ansicht während der Fahrt.
- **Zustellstatus & Gründe – frei erweiterbar** – Buttons in der App (zugestellt, beim Nachbarn,
  Abstellort, nicht angetroffen, Annahme verweigert, Abbruch, Teilzustellung, eigene …) mit
  Pflichtnachweisen je Status: Grund, Foto, Unterschrift, Empfängername, Barcode-Scan. Alles wird
  je Kunde und Tour protokolliert.
- **Barcodes** – EAN-13-Liefercode je Bestellung (gleichbleibend pro Kunde *oder* wechselnd pro
  Lieferung) und der **Kunden-Indikator als EAN-8 Composite (ISO/IEC 24723)**: Kundennummer im
  Strichcode, Name im 2D-Teil (Umlaute GS1-konform kodiert). Ein einseitiges **Kunden-Barcodeblatt**
  bleibt beim Kunden – sein Scan ist der Zustellnachweis, ohne neues Label pro Bestellung.
- **Tracking-Link** – öffentliche Seite je Stopp; die Live-Position des Fahrzeugs erscheint erst,
  wenn der Kunde unter den nächsten *N* (Standard 3) Stopps ist, danach das Zustellergebnis.
- **Automatische und manuelle Benachrichtigungen** – bei Tourstart bekommt jeder Kunde „Lieferung
  kommt heute“, die nächsten 3 Kunden „Gleich sind wir da“ mit Live-Link (Tracking wird aktiviert);
  das Fenster rückt mit jedem erledigten Stopp weiter. Manueller Versand aus Backoffice und App.
  Vorlagen je Sprache bearbeitbar.
- **Sicherheitssperre** – im Produktivbetrieb bleibt das Backend gesperrt, solange die `.env`
  Beispielwerte oder schwache Passwörter enthält.
- **Mehrsprachig** – Englisch und Deutsch (Oberfläche, Nachrichten, Tracking-Seite, Apps), volle
  Unicode-/Umlaut-Unterstützung.
- **Branding** – eigenes Logo in `branding/`, Name und Farbe über die `.env`.
- **Karten** – frei (OpenStreetMap/OpenFreeMap) oder Mapbox, umschaltbar mit `MAP_PROVIDER`.

## Schnellstart (Docker)

```bash
git clone <dein-fork> vega-delivery && cd vega-delivery
./scripts/generate-env.sh https://lieferung.example.de   # .env mit Zufallswerten
# .env anpassen: VALHALLA_TILE_URLS (Region), SMTP_*, WHATSAPP_*, MAP_PROVIDER …
docker compose up -d
docker compose logs -f valhalla   # erster Start lädt OSM-Daten und baut die Routing-Tiles
```

Das Backoffice läuft unter `http://127.0.0.1:3100` (davor einen Reverse-Proxy mit HTTPS, siehe
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)). Anmeldung mit `admin` und dem Passwort, das
`generate-env.sh` ausgibt.

Erste Schritte:
1. **Einstellungen → Allgemein**: Firmenname und Depot (Start/Ende der Touren).
2. **Team**: Fahrer anlegen – jeder erhält einen persönlichen QR-Anmeldecode für die App.
3. **Adressbuch** und **Produkte**, dann **Bestellungen**.
4. **Touren**: Tour für ein Datum anlegen, Bestellungen hinzufügen, *Route optimieren*, Fahrer
   zuweisen, *Freigeben*.
5. Der Fahrer scannt den QR-Code in der App und startet die Tour.

Alle Einstellungen sind in [`.env.example`](.env.example) beschrieben; die Dokumentation liegt
in [`docs/`](docs) (Englisch), eine Dokumentations-Webseite mit Screenshots in
[`website/`](website/index.html) (Englisch).
