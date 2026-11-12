# Tomnova IoT Finca Salvador

Panel de monitoreo que muestra **únicamente datos reales** enviados por el ESP32.

## Cómo funciona

```
ESP32  --POST JSON-->  servidor.py (/api/datos)  <--GET cada 3 s--  Panel web
```

1. Ejecuta `python servidor.py` (puerto 5000).
2. El ESP32 envía sus lecturas por HTTP POST a `http://<IP-del-PC>:5000/api/datos`.
3. Abre `http://localhost:5000` e inicia sesión. Hasta que llegue la primera lectura el panel muestra `--` y "ESP32 sin conexión".

El ESP32 y el PC deben estar en la misma red. Usa la IP LAN del PC (no `localhost`).

## Formato del JSON

Todos los campos son opcionales; los que no se envíen se muestran como `--`.

| Campo          | Tipo    | Descripción                                             |
|----------------|---------|---------------------------------------------------------|
| `temperatura`  | número  | °C                                                      |
| `humedadAmb`   | número  | % humedad ambiental                                     |
| `humedadSuelo` | número  | % humedad del suelo                                     |
| `distancia`    | número  | cm (ultrasonido)                                        |
| `esNoche`      | boolean | true si es de noche                                     |
| `ldr`          | número  | Lectura cruda del LDR. Solo se usa si no envías `esNoche`: se considera noche si `ldr >= ldrThreshold` (config.js) |
| `riegoActivo`  | boolean | Estado real de la bomba/válvula. Si no se envía, se deduce por el umbral de riego |

Ejemplo:

```json
{"temperatura":23.4,"humedadAmb":67.2,"humedadSuelo":81.5,"distancia":120,"esNoche":false,"riegoActivo":false}
```

## Ejemplo para el ESP32 (Arduino)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* SERVIDOR = "http://192.168.1.50:5000/api/datos"; // IP de tu PC

void enviarLectura(float temp, float humAmb, float humSuelo, int dist, bool noche, bool riego) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVIDOR);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"temperatura\":" + String(temp, 1) +
                ",\"humedadAmb\":" + String(humAmb, 1) +
                ",\"humedadSuelo\":" + String(humSuelo, 1) +
                ",\"distancia\":" + String(dist) +
                ",\"esNoche\":" + (noche ? "true" : "false") +
                ",\"riegoActivo\":" + (riego ? "true" : "false") + "}";
  http.POST(body);
  http.end();
}
```

Envía una lectura cada 3–5 segundos. Si pasan más de 15 s sin lecturas, el panel marca el ESP32 como desconectado (`TIMEOUT_ESP32_MS` en `js/datos.js`).

## Notas

- El historial se guarda en memoria del servidor (últimas 200 lecturas); al reiniciar `servidor.py` se pierde.
- Prueba sin ESP32: `curl -X POST http://localhost:5000/api/datos -d '{"temperatura":23.4,"humedadSuelo":81.5}'`
