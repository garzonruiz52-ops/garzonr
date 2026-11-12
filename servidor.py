from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
import time
from collections import deque

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CARPETA_FRONTEND = BASE_DIR

app = Flask(__name__, static_folder=CARPETA_FRONTEND)
CORS(app)

historial_mediciones = deque(maxlen=200)

ultima_medicion = {
    "ts": int(time.time() * 1000),
    "temperatura": None,
    "humedadAmb": None,
    "humedadSuelo": None,
    "distancia": None,
    "esNoche": None,
    "ldr": None,
    "riegoActivo": None,
}


def obtener_valor(datos, *claves):
    for clave in claves:
        if clave in datos:
            return datos[clave]
    return None


def normalizar_datos_esp32(datos):
    if not isinstance(datos, dict):
        return None

    def convertir_bool(valor):
        if isinstance(valor, bool):
            return valor
        if isinstance(valor, str):
            return valor.strip().lower() in ("1", "true", "yes", "on")
        if isinstance(valor, (int, float)):
            return bool(valor)
        return None

    ts = obtener_valor(datos, "ts", "timestamp", "tiempo")
    if ts is None:
        ts = int(time.time() * 1000)

    lectura = {
        "ts": int(ts),
        "temperatura": obtener_valor(datos, "temperatura", "temp", "temperaturaC"),
        "humedadAmb": obtener_valor(datos, "humedadAmb", "humedad_ambiental", "humedadAmbiental", "humedad_ambiente"),
        "humedadSuelo": obtener_valor(datos, "humedadSuelo", "humedad_suelo", "lectura_suelo", "humedadSueloPct"),
        "distancia": obtener_valor(datos, "distancia", "distancia_cm", "distanciaCm"),
        "ldr": obtener_valor(datos, "ldr", "lectura_luz", "luz"),
        "riegoActivo": obtener_valor(datos, "riegoActivo", "riego_activo", "riegoActivoBool", "bomba_activa"),
    }

    es_noche = obtener_valor(datos, "esNoche", "es_noche", "noche")
    if es_noche is None:
        es_noche = obtener_valor(datos, "dia")
        if es_noche is not None:
            es_noche = not bool(es_noche)
    if es_noche is None and lectura["ldr"] is not None:
        es_noche = bool(lectura["ldr"] >= 2500)
    if es_noche is not None:
        lectura["esNoche"] = convertir_bool(es_noche)
    else:
        lectura["esNoche"] = None

    if lectura["riegoActivo"] is not None:
        lectura["riegoActivo"] = convertir_bool(lectura["riegoActivo"])

    for clave in ["temperatura", "humedadAmb", "humedadSuelo", "distancia", "ldr"]:
        if lectura[clave] is not None and isinstance(lectura[clave], str):
            try:
                lectura[clave] = float(lectura[clave])
            except ValueError:
                lectura[clave] = None

    return lectura


@app.route("/")
def home():
    return send_from_directory(CARPETA_FRONTEND, "index.html")


@app.route("/<path:path>")
def servir_archivos(path):
    return send_from_directory(CARPETA_FRONTEND, path)


@app.route("/api/datos", methods=["POST"])
@app.route("/api/mediciones", methods=["POST"])
def recibir_mediciones():
    global ultima_medicion
    datos = request.get_json(silent=True)

    if not datos:
        return jsonify({"error": "No se recibieron datos JSON"}), 400

    lectura = normalizar_datos_esp32(datos)
    if lectura is None:
        return jsonify({"error": "Formato JSON inválido"}), 400

    ultima_medicion = lectura
    historial_mediciones.append(lectura)
    print("¡Datos recibidos del ESP32:", lectura)
    return jsonify({"estado": "ok", "ts": lectura["ts"]}), 200


@app.route("/api/datos", methods=["GET"])
@app.route("/api/mediciones", methods=["GET"])
def obtener_mediciones():
    ahora = int(time.time() * 1000)
    respuesta = {
        "ahora": ahora,
        "ultimo": ultima_medicion,
        "historial": list(historial_mediciones),
    }
    return jsonify(respuesta), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

# subir actualizacion_git add . && git commit -m "Actualización" && git push