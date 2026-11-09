# Daten und Zugänge im lokalen Betrieb

Diese Seite beschreibt, welche Daten der aktuelle Code verarbeitet und wo er sie speichert. Die Speicherorte beziehen sich auf den standardmäßigen Datenordner `data/`. Über `BELEGE_DATA_DIR` kann der lokale Dienst einen anderen Ordner verwenden. Die Implementierung steht in [Server/server.mjs](../Server/server.mjs).

## PDF-Verarbeitung mit Claude

Im [Hauptworkflow](../workflows/01-rechnungsverarbeitung.json) liest n8n den PDF-Anhang als Binärdaten, kodiert ihn als Base64 und sendet das Dokument an die Claude Messages API. Die Anfrage enthält außerdem die Ausleseanweisung und das JSON-Schema. Dadurch wird der vollständige Inhalt der ausgewählten PDF an Anthropic übertragen.

n8n übergibt die Claude-Antwort, die Herkunftsangaben und die PDF-Daten anschließend an den lokalen Excel-Dienst. Der Dienst berechnet einen SHA-256-Fingerabdruck der PDF. Die ursprüngliche PDF bleibt eine Eingabe des Workflows. Das lokale Belegprotokoll speichert ihre ausgelesenen Inhalte und den Fingerabdruck. Die Nutzung und Aufbewahrung der an Anthropic übertragenen Daten richtet sich nach dem jeweils verwendeten Anthropic-Konto und dessen Vereinbarungen.

Der [Demo-Workflow](../workflows/02-demotest.json) verarbeitet vorbereitete synthetische Ausleseereignisse. Er benötigt für diese Ereignisse keinen Claude-Aufruf.

## Lokale Dateien

| Speicherort | Inhalt und Zweck |
| --- | --- |
| `data/rechnungen.xlsx` | Stammdaten, Rechnungen, Positionen und Audit-Log der regulären Verarbeitung |
| `data/demo-rechnungen.xlsx` | Ergebnisse der synthetischen Demo |
| `data/private/evidence/` | Gespeicherte Claude-Antworten, Mail- beziehungsweise Upload-Metadaten, mögliche Fehlermeldungen und PDF-Fingerabdrücke |
| `data/private/pending/` | Offene Schreibvorgänge mit den für eine Wiederholung benötigten Auslesedaten und Herkunftsangaben |
| `data/private/demo-evidence/` und `data/private/demo-pending/` | Entsprechende Dateien für den Demo-Endpunkt |
| `data/private/bridge-token` | Lokales Zugangstoken für die HTTP-Verbindung zwischen n8n und Excel-Dienst |

Die JSON-Dateien unter `evidence` und `pending` enthalten die Claude-Antwort und Mail-Metadaten, darunter gegebenenfalls Absender, Betreff, Nachrichten-ID und Dateiname. Der Dienst nimmt das Feld `pdfBase64` nicht in diese gespeicherten Ereignisse auf. Trotzdem können die gespeicherte Antwort und der Audit-Log personenbezogene Angaben, Anschriften und Bankverbindungen aus dem Beleg enthalten.

Der Excel-Dienst legt seinen privaten Ordner mit Modus `0700` und die Ereignis- und Tokendateien mit `0600` an. Diese Dateirechte dienen der lokalen Zugriffsbeschränkung. Die Dateien werden vom Dienst ohne eigene Dateiverschlüsselung gespeichert.

## Zugangsdaten

Anthropic- und IMAP-Zugänge werden in der eigenen n8n-Instanz als Credentials eingerichtet. Die veröffentlichten Workflow-Dateien enthalten die zu wählenden Credential-Typen. Die tatsächlichen Kontozugänge trägt der Betreiber in n8n ein.

Beim ersten Start erzeugt der lokale Dienst ein zufälliges Verbindungstoken. Der Tokenwert wird in n8n in einem Header-Auth-Credential für `X-Belege-Token` hinterlegt. Geschützte Endpunkte vergleichen diesen Header mit dem gespeicherten Token. Der Dienst bindet standardmäßig an `127.0.0.1:5680`. n8n in Docker Desktop erreicht ihn über `host.docker.internal:5680`. Der Health-Endpunkt kann ohne Token abgefragt werden.

Das Token, API-Schlüssel und IMAP-Passwörter gehören in die jeweilige lokale Konfiguration beziehungsweise Credential-Verwaltung. Die öffentliche Fassung enthält synthetische Beispiele und Code. Arbeitgeber-PDFs, bereitgestellte Vorlagen, Ergebnisdateien und persönliche Testmails werden nicht mitgeliefert.

## Git und n8n-Speicherung

Die [Gitignore-Datei](../.gitignore) schließt unter anderem `data/`, `private/`, `outputs/`, `test-output/`, `.env`-Dateien, Protokolle, SQLite-Dateien, PDFs, XLSX-Dateien und Verarbeitungssperren aus. Sie verhindert das reguläre Hinzufügen entsprechender lokaler Dateien. Bereits veröffentlichte Dateien oder mit erzwungenem Hinzufügen erstellte Commits müssen gesondert geprüft werden.

Die exportierten Workflow-Einstellungen speichern erfolgreiche und fehlgeschlagene Ausführungen nicht als vollständige Ausführungsprotokolle. Das ersetzt keine Prüfung der eigenen n8n-Instanz. Während der Ausführung verarbeitet n8n weiterhin PDF-Binärdaten. Manuelle Tests, Instanzeinstellungen, lokale Sicherungen und zusätzliche Protokollierung können weitere Kopien erzeugen. Die Compose-Datei verwendet für die n8n-Instanz ein eigenes Docker-Volume.

## Wiederholung und Aufbewahrung

Vor einem Schreibvorgang prüft der Dienst, ob zur Arbeitsmappe eine Excel-Sperrdatei mit dem Präfix `~$` besteht. Während seiner eigenen Verarbeitung setzt er zusätzlich eine Datei mit dem Suffix `.processing-lock`. Ist die Arbeitsmappe geöffnet oder schlägt das Schreiben fehl, bleibt der Vorgang unter `pending` erhalten. Nach dem Schließen von Excel kann der Wiederholungsworkflow die gespeicherte Ausleseantwort erneut verarbeiten.

Nach einem erfolgreichen Schreibvorgang entfernt der Dienst die zugehörige Pending-Datei. Die Evidence-Datei bleibt gespeichert. Für Evidence-Dateien, Audit-Zeilen und Arbeitsmappen ist im Code keine automatische Löschfrist eingerichtet.

Prüfe vor einer manuellen Bereinigung, ob das Ergebnis in der Arbeitsmappe nachvollziehbar ist und ob noch offene Vorgänge wiederholt werden müssen. Lösche danach nicht mehr benötigte Belegprotokolle und Testdateien nach den für den eigenen Einsatz festgelegten Aufbewahrungsregeln. Eine zurückgebliebene Verarbeitungssperre nach einem Abbruch sollte erst entfernt werden, wenn feststeht, dass kein Schreibvorgang mehr läuft.
