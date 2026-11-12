// Datos reales: el ESP32 envía sus lecturas al servidor (POST /api/datos)
// y el panel las consulta aquí (GET /api/datos). No se genera ningún dato simulado.

// Si pasan más de este tiempo sin lecturas nuevas, se considera desconectado.
const TIMEOUT_ESP32_MS = 15000;

async function obtenerDatosESP32() {
    try {
        const resp = await fetch('/api/datos', { cache: 'no-store' });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (err) {
        return null; // servidor inaccesible
    }
}

// Convierte una lectura cruda del ESP32 al formato que usa el panel.
// Los campos que el ESP32 no envíe quedan en null (nunca se inventan).
function normalizarLectura(l) {
    const num = v => (typeof v === 'number' ? v : null);

    let esNoche = null;
    if (typeof l.esNoche === 'boolean') {
        esNoche = l.esNoche;
    } else if (typeof l.ldr === 'number') {
        // Ajusta el sentido si tu LDR está cableado al revés
        esNoche = l.ldr >= CONFIG.ldrThreshold;
    }

    return {
        ts: l.ts,
        temperatura: num(l.temperatura),
        humedadAmb: num(l.humedadAmb),
        humedadSuelo: num(l.humedadSuelo),
        distancia: num(l.distancia),
        esNoche: esNoche,
        riegoActivo: typeof l.riegoActivo === 'boolean' ? l.riegoActivo : null
    };
}
