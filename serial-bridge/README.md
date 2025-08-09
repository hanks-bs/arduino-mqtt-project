# Serial MQTT Bridge (Windows COM -> Docker MQTT)

Arduino -> (COM3) -> Bridge -> MQTT (mosquitto in docker) -> API (subskrybent) -> UI

## 1. Instalacja

```powershell
cd serial-bridge
copy .env.example .env
npm install
```

## 2. Plik .env

| Zmienna     | Opis                                            |
| ----------- | ----------------------------------------------- |
| COM_PORT    | Port Windows (np. COM3)                         |
| BAUD_RATE   | Domyślnie 9600 – zgodne ze szkicem Arduino      |
| MQTT_BROKER | mqtt://localhost:1883 (broker z docker-compose) |
| MQTT_TOPIC  | Temat publikacji np. arduino/sensordata         |
| LOG_RAW     | 1 aby logować surowe linie                      |

## 3. Uruchomienie

```powershell
node serial-bridge.js
```

## 4. Docker Compose API

W `docker-compose.yml` pozostaw `SERIAL_PORT=disabled`. API nie otwiera portu, tylko zużywa dane z MQTT.

## 5. Format linii z Arduino

Każda linia = pojedynczy JSON zakończony `\n`.

## 6. Test

```powershell
curl http://localhost:5000/api/arduino-data
```

Po pojawieniu się pierwszego JSON historia zacznie się zapełniać.

## 7. Zatrzymanie

Ctrl+C (zamyka port i MQTT).

## 8. Problemy

| Problem     | Rozwiązanie                                                        |
| ----------- | ------------------------------------------------------------------ |
| Port zajęty | Zamknij Serial Monitor w IDE                                       |
| Brak danych | Upewnij się że Arduino wysyła JSON i mostek działa                 |
| Błędny JSON | Sprawdź czy linia zaczyna się od `{` i jest poprawna strukturalnie |

## 9. Migracja na Linux

Możesz potem usunąć mostek i mapować `/dev/ttyUSB0` bezpośrednio do kontenera.
