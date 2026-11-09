# Lokale HTTP-Schnittstelle

Der Excel-Dienst nimmt bereits ausgelesene Belegdaten entgegen. Die Anfrage an Claude führt der Hauptworkflow in n8n aus. Die folgenden Endpunkte gehören zum lokalen Dienst, nicht zur Anthropic API.

## Verbindung und Konfiguration

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| Adresse | `127.0.0.1` | Der Dienst bindet an die lokale Loopback-Adresse. |
| `BELEGE_PORT` | `5680` | Ganzzahliger Port, `0` wählt für Tests einen freien Port. |
| `BELEGE_DATA_DIR` | `data` | Absoluter Pfad oder Pfad relativ zum Projektverzeichnis. |
| Maximale Anfrage | 32 MiB | Grenze für den gesamten JSON-Body einschließlich Base64-PDF. |

Beispiel mit getrenntem Datenverzeichnis:

```bash
BELEGE_PORT=5681 BELEGE_DATA_DIR=/tmp/belege-test npm start
```

Alle Endpunkte außer `GET /health` benötigen den Header `X-Belege-Token`. Der Wert steht nach dem ersten Start in `<Datenverzeichnis>/private/bridge-token`. In n8n wird er als **Header Auth**-Credential eingerichtet. Ein bestehendes leeres Token verhindert den Start und muss vor dem Neustart entfernt werden.

## Endpunkte

| Methode | Pfad | Wirkung |
| --- | --- | --- |
| GET | `/health` | Erreichbarkeit prüfen, ohne Dateiinhalte zurückzugeben. |
| POST | `/process` | Ein Ereignis prüfen und `rechnungen.xlsx` ergänzen. |
| GET | `/pending` | Anzahl offener regulärer JSON-Ereignisse. |
| POST | `/replay` | Offene reguläre Ereignisse erneut verarbeiten. |
| POST | `/demo/process` | Ein synthetisches Ereignis in `demo-rechnungen.xlsx` verarbeiten. |
| GET | `/demo/pending` | Anzahl offener Demo-Ereignisse. |
| POST | `/demo/replay` | Nur offene Demo-Ereignisse wiederholen. |

`/process` und `/demo/process` erwarten `Content-Type: application/json`. Die Wiederholungsendpunkte benötigen keinen Beleg im Body: Sie lesen die lokal gespeicherten Ereignisse. Demo und reguläre Verarbeitung haben getrennte Dateien und Warteschlangen.

## Eingabe eines Belegs

```json
{
  "meta": {
    "mailbox": "Manueller Upload",
    "submittedAt": "DEMO-upload-001",
    "filename": "DEMO-rechnung.pdf",
    "attachmentIndex": 0,
    "processingElapsedMs": 1250
  },
  "pdfBase64": "BASE64_DER_PDF",
  "response": {
    "stop_reason": "end_turn",
    "content": [{"type": "text", "text": "JSON_BELEG_VON_CLAUDE"}]
  }
}
```

Die beiden Platzhalter sind durch echte Daten zu ersetzen. `meta.filename` und entweder eine nicht leere `meta.messageId` oder `meta.submittedAt` müssen als Text vorhanden sein. Für E-Mails können `from`, `subject`, `date` und `mailbox` ergänzt werden. Der Anhangsindex unterscheidet Anhänge derselben Nachricht.

`response` enthält die ursprüngliche Claude-Antwort. Das fachliche Belegschema und das API-Protokoll `beleg-v1` stehen in [Server/schema.mjs](../Server/schema.mjs). Das Prüfprogramm kann zusätzlich die dort beschriebene typisierte Belegstruktur lesen; die [Testdaten](../fixtures.mjs) zeigen vollständige synthetische Beispiele.

Bei einem vorgelagerten Fehler kann stattdessen `error` als Text übergeben werden. Bei fehlender Ausleseantwort entsteht ein Fehleraudit. `pdfBase64` muss, falls vorhanden, Text sein. Der Dienst berechnet daraus den Fingerabdruck und prüft den PDF-Kopf. Gespeicherte Wiederholungen verwenden ihren vorhandenen `pdfHash`.

Die Quellenkennung muss bei einer technischen Wiederholung gleich bleiben. Eine neue Zustellung erhält eine neue Nachrichten- oder Upload-ID. [Datenmodell und Dublettenregeln](datenmodell.md) erklären den Unterschied.

## Antworten und Statuscodes

Eine erfolgreiche HTTP-Antwort bestätigt die Verarbeitung des Ereignisses. Der fachliche Ausgang steht in `ergebnis`, etwa `geschrieben`, `Dublette`, `kein Beleg`, `Objekt unbekannt` oder `Fehler`. Ein HTTP-Status `200` bedeutet daher nicht automatisch, dass eine Rechnung angelegt wurde.

Weitere Antwortfelder sind `auditId`, `rechnungId`, `manuellPruefen`, `pruefhinweis`, `probleme`, `idempotent`, `auditAktualisiert`, `dauer_s` und der lokale Dateipfad `datei`. Die Laufzeit umfasst die von n8n übergebene Verarbeitungsdauer und den aktuellen lokalen Versuch. Wartezeit zwischen gespeicherten Wiederholungen zählt nicht dazu.

| HTTP-Status | Bedeutung |
| --- | --- |
| 200 | Ereignis verarbeitet oder alle gespeicherten Ereignisse erfolgreich wiederholt. |
| 207 | Wiederholung teilweise fehlgeschlagen. `results` enthält Erfolge, `failed` Dateinamen und Fehlermeldungen. Fehlgeschlagene Dateien bleiben gespeichert. |
| 400 | Ungültiges JSON oder unbrauchbare Herkunfts-/Transportfelder. |
| 401 | Verbindungstoken fehlt oder ist falsch. |
| 404 | Pfad unbekannt. |
| 405 | Methode für diesen Pfad falsch; `Allow` nennt die passende Methode. |
| 413 | JSON-Anfrage größer als 32 MiB. |
| 415 | Für den Verarbeitungsendpunkt fehlt der JSON-Medientyp. |
| 503 | Lokale Verarbeitung gescheitert, etwa weil Excel geöffnet ist. |

## Häufige Probleme

**Excel ist geöffnet:** Änderungen in Excel speichern, die Ergebnisdatei schließen und den Wiederholungsworkflow starten. Eine erfolgreiche Wiederholung benötigt keinen neuen Claude-Aufruf. Bei `207` die Einträge unter `failed` einzeln prüfen.

**Port ist bereits belegt:** Der Excel-Dienst läuft möglicherweise bereits. Den vorhandenen Dienst verwenden oder einen anderen `BELEGE_PORT` einstellen. Dazu die Portnummer in den lokalen HTTP-Knoten von n8n ebenfalls ändern.

**n8n erreicht den Dienst nicht:** Der Dienst muss laufen. Bei Docker Desktop auf macOS verwenden die Exporte `host.docker.internal`; bei n8n direkt auf demselben Rechner ist `127.0.0.1` passend. Ein anderer Port muss in beiden Anwendungen übereinstimmen. Das enthaltene Docker-Setup wurde für Docker Desktop auf macOS vorbereitet.

**Rechnung fehlt, aber HTTP war erfolgreich:** In `ergebnis` und im `Audit_Log` nachsehen. Ein unbekanntes Objekt oder ein allgemeines Schreiben erzeugt ausschließlich einen Audit-Eintrag. Eine Dublette verweist auf den vorhandenen Buchungsbeleg.
