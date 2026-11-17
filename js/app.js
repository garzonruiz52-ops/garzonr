// Cargar usuarios guardados si existen
try {
    const usrsGuardados = localStorage.getItem('tomnova_usuarios');
    if (usrsGuardados) {
        const parsed = JSON.parse(usrsGuardados);
        if (Array.isArray(parsed) && parsed.length > 0) {
            BASE_DATOS_USUARIOS = parsed;
        }
    }

    const repGuardados = localStorage.getItem('tomnova_reportes');
    if (repGuardados) {
        const parsedReports = JSON.parse(repGuardados);
        if (Array.isArray(parsedReports)) {
            BASE_DATOS_REPORTES.length = 0;
            BASE_DATOS_REPORTES.push(...parsedReports);
        }
    }

    const sesionGuardada = localStorage.getItem('tomnova_sesion');
    if (sesionGuardada) {
        const parsedSession = JSON.parse(sesionGuardada);
        if (parsedSession && parsedSession.email) {
            const usuarioGuardado = BASE_DATOS_USUARIOS.find(u => u.email.toLowerCase() === parsedSession.email.toLowerCase());
            if (usuarioGuardado) {
                usuarioSesionActual = usuarioGuardado;
            }
        }
    }
} catch(err) {}

if (usuarioSesionActual) {
    try {
        localStorage.setItem('tomnova_sesion', JSON.stringify(usuarioSesionActual));
    } catch(err) {}
}

let reporteSeleccionadoId = null;
document.addEventListener("DOMContentLoaded", () => {
    const cfgRiegoOn = document.getElementById('cfg-riego-on');
    if (cfgRiegoOn) cfgRiegoOn.value = CONFIG.riegoOn;

    if (usuarioSesionActual) {
        aplicarPermisosRol();
    }

    renderizarAlertas();
    setInterval(() => {
        if (!document.getElementById('app-container').classList.contains('oculto')) {
            sondearESP32();
        }
    }, CONFIG.REFRESH_RATE);
});

// ---------- Datos reales del ESP32 ----------
let ultimoTsProcesado = 0;
let ultimaLectura = null;
let bufferLecturas = [];
const MAX_PUNTOS_GRAFICA = 15;
const MAX_FILAS_HISTORIAL = 10;

const formatearHora = ts => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmt = (v, dec = 1) => (v === null || v === undefined ? '--' : Number(v).toFixed(dec));

async function sondearESP32() {
    const resp = await obtenerDatosESP32();
    if (!resp) {
        actualizarEstadoConexion(false, null);
        return;
    }

    const historial = Array.isArray(resp.historial) ? resp.historial : [];
    const nuevas = historial
        .filter(l => Number(l?.ts ?? 0) > ultimoTsProcesado)
        .map(normalizarLectura);

    nuevas.forEach(procesarLectura);

    if (nuevas.length > 0) {
        ultimaLectura = nuevas[nuevas.length - 1];
        ultimoTsProcesado = Number(ultimaLectura.ts || 0);
        actualizarEstadoConexion(true, ultimaLectura.ts);
        actualizarDashboard(ultimaLectura);
        evaluarGenerarAlertas(ultimaLectura);
        return;
    }

    if (resp.ultimo) {
        const ultimo = normalizarLectura(resp.ultimo);
        const conectado = !!ultimo && (resp.ahora - Number(ultimo.ts || 0)) <= TIMEOUT_ESP32_MS;
        actualizarEstadoConexion(conectado, ultimo.ts);

        if (conectado && Number(ultimo.ts || 0) > ultimoTsProcesado) {
            ultimoTsProcesado = Number(ultimo.ts || 0);
            ultimaLectura = ultimo;
            actualizarDashboard(ultimo);
            evaluarGenerarAlertas(ultimo);
        }
    }
}

function actualizarEstadoConexion(conectado, ts) {
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    const reloj = document.getElementById('clock-display');

    if (dot) dot.className = conectado ? 'dot online' : 'dot offline';
    if (txt) txt.innerText = conectado ? 'ESP32 conectado' : 'ESP32 sin conexión';

    if (reloj) {
        reloj.innerText = new Date().toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

// Registra una lectura nueva en la gráfica y en la tabla de historial
function procesarLectura(l) {
    bufferLecturas.push(l);
    if (bufferLecturas.length > MAX_PUNTOS_GRAFICA) bufferLecturas.shift();

    if (typeof chartGeneral !== 'undefined' && chartGeneral) {
        if (chartGeneral.data.labels.length >= MAX_PUNTOS_GRAFICA) {
            chartGeneral.data.labels.shift();
            chartGeneral.data.datasets[0].data.shift();
            chartGeneral.data.datasets[1].data.shift();
        }
        chartGeneral.data.labels.push(formatearHora(l.ts));
        chartGeneral.data.datasets[0].data.push(l.humedadSuelo);
        chartGeneral.data.datasets[1].data.push(l.temperatura);
        chartGeneral.update('none');
    }

    const tbody = document.getElementById('historial-tbody');
    if (tbody) {
        const regando = estaRegando(l);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${formatearHora(l.ts)}</strong></td>
            <td><span class="val-blue">${fmt(l.humedadSuelo)} %</span></td>
            <td><span class="val-red">${fmt(l.temperatura)} °C</span></td>
            <td>${fmt(l.humedadAmb)} %</td>
            <td><span class="val-amber">${l.esNoche === null ? '--' : `<i class="fa-solid ${l.esNoche ? 'fa-moon' : 'fa-sun'}"></i> ${l.esNoche ? 'Noche' : 'Día'}`}</span></td>
            <td>${fmt(l.distancia, 0)} cm</td>
            <td>${regando === null ? '--' : regando ? '<span class="badge-riego-active"><i class="fa-solid fa-droplet"></i> ACTIVO</span>' : '<span class="badge-riego-inactive"><i class="fa-solid fa-circle-minus"></i> Inactivo</span>'}</td>
        `;
        if (tbody.children.length >= MAX_FILAS_HISTORIAL) tbody.removeChild(tbody.lastChild);
        tbody.insertBefore(tr, tbody.firstChild);
    }
}

// Tras recrear la gráfica (al volver al panel) se vuelve a llenar con lecturas reales
function repoblarGrafica() {
    if (typeof chartGeneral === 'undefined' || !chartGeneral) return;
    chartGeneral.data.labels = bufferLecturas.map(l => formatearHora(l.ts));
    chartGeneral.data.datasets[0].data = bufferLecturas.map(l => l.humedadSuelo);
    chartGeneral.data.datasets[1].data = bufferLecturas.map(l => l.temperatura);
    chartGeneral.update('none');
}

// true/false según el ESP32; si no lo informa, se deduce por el umbral; null si no hay dato
function estaRegando(l) {
    if (typeof l.riegoActivo === 'boolean') return l.riegoActivo;
    if (l.humedadSuelo !== null) return l.humedadSuelo < CONFIG.riegoOn;
    return null;
}

function renderizarAlertas() {
    const container = document.getElementById('alerts-container');
    const badge = document.getElementById('badge-alertas');
    if (!container) return;
    container.innerHTML = '';
    if (badge) {
        badge.innerText = listaAlertasActivas.length;
        badge.style.display = listaAlertasActivas.length > 0 ? 'inline-block' : 'none';
    }
    if (listaAlertasActivas.length === 0) {
        container.innerHTML = `<div class="no-alerts-card"><i class="fa-solid fa-circle-check"></i><h3>¡Todo bajo control!</h3><p>No tienes alertas pendientes.</p></div>`;
        return;
    }
    listaAlertasActivas.forEach(alerta => {
        const item = document.createElement('div');
        item.className = `alert-item ${alerta.tipo}`;
        item.innerHTML = `
            <div class="alert-left-content">
                <i class="fa-solid ${alerta.tipo === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'} alert-icon"></i>
                <div class="alert-content">
                    <h4>${alerta.titulo}</h4>
                    <p>${alerta.mensaje}</p>
                    <span class="alert-time"><i class="fa-regular fa-clock"></i> ${alerta.tiempo}</span>
                </div>
            </div>
            <button class="btn-dismiss-alert" title="Quitar alerta" onclick="eliminarAlertaIndividual(${alerta.id})"><i class="fa-solid fa-xmark"></i></button>
        `;
        container.appendChild(item);
    });
}

function eliminarAlertaIndividual(id) {
    listaAlertasActivas = listaAlertasActivas.filter(a => a.id !== id);
    renderizarAlertas();
}

function eliminarTodasLasAlertas() {
    listaAlertasActivas = [];
    renderizarAlertas();
}

function evaluarGenerarAlertas(datos) {
    const humSuelo = datos.humedadSuelo;
    if (humSuelo === null) return;
    if (humSuelo < CONFIG.riegoOn && !listaAlertasActivas.some(a => a.titulo.includes("Humedad"))) {
        listaAlertasActivas.unshift({ id: Date.now(), tipo: 'warning', titulo: 'Humedad del suelo crítica', mensaje: `Lectura: ${humSuelo.toFixed(1)}%.`, tiempo: 'Justo ahora' });
        renderizarAlertas();
    }
}

function cambiarVistaAuth(vista) {
    if (vista === 'registro') {
        document.getElementById('login-form').classList.add('oculto');
        document.getElementById('registro-form').classList.remove('oculto');
    } else {
        document.getElementById('registro-form').classList.add('oculto');
        document.getElementById('login-form').classList.remove('oculto');
    }
}

function manejarLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    const encontrado = BASE_DATOS_USUARIOS.find(
        u => u.email.toLowerCase() === email.toLowerCase() && u.pass === pass
    );

    if (!encontrado) {
        alert('Credenciales incorrectas. Verifica tu correo y contraseña.');
        return;
    }

    usuarioSesionActual = encontrado;
    try {
        localStorage.setItem('tomnova_sesion', JSON.stringify(usuarioSesionActual));
    } catch(err) {}
    aplicarPermisosRol();
    if (usuarioSesionActual.rol === 'Administrador') {
        renderizarPanelAdmin();
    }
}
function manejarRegistro(event) {
    event.preventDefault();
    const nombre = document.getElementById('reg-nombre').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value.trim();

    if (!nombre || !email || !pass) {
        alert('Completa nombre, correo y contraseña antes de registrarte.');
        return;
    }

    const emailExiste = BASE_DATOS_USUARIOS.some(u => u.email.toLowerCase() === email.toLowerCase());
    if (emailExiste) {
        alert('Ya existe una cuenta registrada con ese correo electrónico.');
        return;
    }

    const nuevo = { nombre, email, pass, rol: "Agricultor", estado: "Activo" };
    BASE_DATOS_USUARIOS.push(nuevo);
    usuarioSesionActual = nuevo;
    try {
        localStorage.setItem('tomnova_usuarios', JSON.stringify(BASE_DATOS_USUARIOS));
        localStorage.setItem('tomnova_sesion', JSON.stringify(usuarioSesionActual));
    } catch(err) {}
    alert("Registro exitoso.");
    aplicarPermisosRol();
    if (usuarioSesionActual.rol === 'Administrador') {
        renderizarPanelAdmin();
    }
}

function aplicarPermisosRol() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').classList.remove('oculto');
    const esAdmin = usuarioSesionActual.rol === "Administrador";
    document.getElementById('prof-name').innerText = usuarioSesionActual.nombre;
    document.getElementById('prof-email').innerText = usuarioSesionActual.email;
    document.getElementById('prof-role').innerText = usuarioSesionActual.rol;
    
    const descPriv = document.getElementById('role-privileges-desc');
    if (descPriv) {
        if (esAdmin) {
            descPriv.innerHTML = '<strong>Privilegios activos:</strong> Acceso total de gestión y supervisión de cuentas y reportes del sistema.';
        } else {
            descPriv.innerHTML = '<strong>Privilegios activos:</strong> Monitoreo agronómico en tiempo real, control de riego y envío de novedades al administrador.';
        }
    }
    
    const roleTextElem = document.getElementById('sidebar-role-text');
    const roleBadgeElem = roleTextElem ? roleTextElem.closest('.user-role-badge') : null;
    const roleIconElem = document.getElementById('sidebar-role-icon');
    
    if (roleTextElem) {
        roleTextElem.innerText = `Rol: ${usuarioSesionActual.rol}`;
    }
    if (roleBadgeElem) {
        if (esAdmin) {
            roleBadgeElem.classList.add('admin-active');
        } else {
            roleBadgeElem.classList.remove('admin-active');
        }
    }
    if (roleIconElem) {
        roleIconElem.className = esAdmin ? "fa-solid fa-user-shield" : "fa-solid fa-user";
    }
    
    document.querySelectorAll('.solo-agricultor').forEach(b => b.style.display = esAdmin ? 'none' : 'flex');
    document.querySelectorAll('.solo-admin').forEach(b => b.style.display = esAdmin ? 'flex' : 'none');
    
    cambiarSeccion(esAdmin ? 'admin-panel' : 'panel', document.getElementById(esAdmin ? 'btn-menu-admin-panel' : 'btn-menu-panel'));
    if (!esAdmin) inicializarGraficas();
    renderizarAlertas();
    renderizarMisReportes();
    sondearESP32();
}

function cerrarSesion() {
    usuarioSesionActual = null;
    try {
        localStorage.removeItem('tomnova_sesion');
    } catch(err) {}
    document.getElementById('app-container').classList.add('oculto');
    document.getElementById('auth-container').style.display = 'flex';
}

function cambiarSeccion(nombre, btn) {
    if (nombre === 'admin-panel' || nombre === 'admin-reportes') { renderizarPanelAdmin(); }
    document.querySelectorAll('.seccion-view').forEach(s => s.classList.add('oculto'));
    const sec = document.getElementById(`sec-${nombre}`);
    if (sec) sec.classList.remove('oculto');
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (nombre === 'panel') setTimeout(inicializarGraficas, 100);
}

function guardarAjustes(event) {
    event.preventDefault();
    
    CONFIG.riegoOn = parseFloat(document.getElementById('cfg-riego-on').value) || 80;
    CONFIG.riegoOff = parseFloat(document.getElementById('cfg-riego-off').value) || 90;
    CONFIG.tempDiaMin = parseFloat(document.getElementById('cfg-temp-dia-min').value) || 20;
    CONFIG.tempDiaMax = parseFloat(document.getElementById('cfg-temp-dia-max').value) || 26;
    CONFIG.tempNocheMin = parseFloat(document.getElementById('cfg-temp-noche-min').value) || 14;
    CONFIG.tempNocheMax = parseFloat(document.getElementById('cfg-temp-noche-max').value) || 18;
    CONFIG.humMin = parseFloat(document.getElementById('cfg-hum-min').value) || 60;
    CONFIG.humMax = parseFloat(document.getElementById('cfg-hum-max').value) || 80;
    CONFIG.ldrThreshold = parseFloat(document.getElementById('cfg-ldr-threshold').value) || 2500;
    CONFIG.proxThreshold = parseFloat(document.getElementById('cfg-prox-threshold').value) || 30;

    const subTextRiego = document.getElementById('riego-sub-text');
    if (subTextRiego) {
        subTextRiego.innerText = `Riego en espera: abre por debajo de ${CONFIG.riegoOn} %`;
    }

    alert("¡Ajustes guardados correctamente! Los umbrales se han aplicado al panel principal.");
    cambiarSeccion('panel', document.getElementById('btn-menu-panel'));
}

function ponerPill(pillId, textId, clase, texto) {
    const pill = document.getElementById(pillId);
    const txt = document.getElementById(textId);
    if (pill) pill.className = `status-pill ${clase}`;
    if (txt) txt.innerText = texto;
}

function actualizarDashboard(d) {
    const humSuelo = d.humedadSuelo;

    document.getElementById('val-hum-suelo-hero').innerText = `${fmt(humSuelo)} %`;
    document.getElementById('progress-fill').style.width = `${humSuelo === null ? 0 : Math.max(0, Math.min(humSuelo, 100))}%`;
    document.getElementById('val-temp').innerText = `${fmt(d.temperatura)} °C`;
    document.getElementById('val-hum-amb').innerText = `${fmt(d.humedadAmb)} %`;
    document.getElementById('val-luz-text').innerText = d.esNoche === null ? '--' : (d.esNoche ? 'Noche' : 'Día');
    document.getElementById('val-dist-text').innerText = `${fmt(d.distancia, 0)} cm`;

    const regando = estaRegando(d);
    const riegoDot = document.getElementById('riego-dot');
    const riegoSubText = document.getElementById('riego-sub-text');
    if (riegoDot && riegoSubText) {
        if (regando === null) {
            riegoDot.className = "dot-indicator green";
            riegoSubText.innerText = 'Servo: cierra compuerta • Esperando datos del ESP32';
        } else if (regando) {
            riegoDot.className = "dot-indicator red";
            riegoSubText.innerText = `Servo: abre compuerta • Suelo al ${fmt(humSuelo)}% (umbral de apertura: ${CONFIG.riegoOn}%)`;
        } else {
            riegoDot.className = "dot-indicator green";
            riegoSubText.innerText = `Servo: cierra compuerta • Riego en espera: abre por debajo de ${CONFIG.riegoOn} % (Actual: ${fmt(humSuelo)}%)`;
        }
    }

    if (d.temperatura === null) {
        ponerPill('temp-status-pill', 'temp-status-text', 'neutral', 'Sin datos');
    } else {
        const min = d.esNoche ? CONFIG.tempNocheMin : CONFIG.tempDiaMin;
        const max = d.esNoche ? CONFIG.tempNocheMax : CONFIG.tempDiaMax;
        const ok = d.temperatura >= min && d.temperatura <= max;
        ponerPill('temp-status-pill', 'temp-status-text', ok ? 'success' : 'warning', ok ? `Dentro del rango (${min}–${max} °C)` : `Fuera del rango (${min}–${max} °C)`);
    }

    if (d.humedadAmb === null) {
        ponerPill('hum-status-pill', 'hum-status-text', 'neutral', 'Sin datos');
    } else {
        const ok = d.humedadAmb >= CONFIG.humMin && d.humedadAmb <= CONFIG.humMax;
        ponerPill('hum-status-pill', 'hum-status-text', ok ? 'success' : 'warning', ok ? 'Dentro del rango' : `Fuera del rango (${CONFIG.humMin}–${CONFIG.humMax} %)`);
    }

    const luzIcon = document.getElementById('luz-icon');
    if (luzIcon) luzIcon.className = `fa-solid ${d.esNoche ? 'fa-moon' : 'fa-sun'}`;
    if (d.esNoche === null) {
        ponerPill('luz-status-pill', 'luz-status-text', 'neutral', 'Sin datos');
    } else {
        ponerPill('luz-status-pill', 'luz-status-text', 'success', d.esNoche ? 'Lámpara encendida' : 'Lámpara apagada');
    }

    if (d.distancia === null) {
        ponerPill('prox-status-pill', 'prox-status-text', 'neutral', 'Zumbador inactivo');
    } else {
        const cerca = d.distancia < CONFIG.proxThreshold;
        ponerPill('prox-status-pill', 'prox-status-text', cerca ? 'warning' : 'success', cerca ? 'Zumbador activo' : 'Zumbador inactivo');
    }

    const bombaAgua = typeof d.bombaAgua === 'boolean' ? d.bombaAgua : (typeof d.riegoActivo === 'boolean' ? d.riegoActivo : null);
}

function guardarReportesEnStorage() {
    try {
        localStorage.setItem('tomnova_reportes', JSON.stringify(BASE_DATOS_REPORTES));
    } catch (err) {}
}

function obtenerReportesDelUsuario() {
    if (!usuarioSesionActual) return [];

    return BASE_DATOS_REPORTES.filter(reporte => {
        const emailActual = (usuarioSesionActual.email || '').toLowerCase();
        const nombreActual = (usuarioSesionActual.nombre || '').toLowerCase();
        const emailReporte = (reporte.usuarioEmail || '').toLowerCase();
        const nombreReporte = (reporte.usuarioNombre || '').toLowerCase();
        return emailReporte === emailActual || nombreReporte === nombreActual;
    }).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
}

function renderizarMisReportes() {
    const container = document.getElementById('mis-reportes-cards-container');
    if (!container) return;

    const misReportes = obtenerReportesDelUsuario();
    if (!misReportes.length) {
        container.innerHTML = `
            <div class="no-alerts-card">
                <i class="fa-solid fa-paper-plane"></i>
                <h3>Sin novedades enviadas</h3>
                <p>Aún no has registrado ningún reporte para el administrador.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = misReportes.map(reporte => `
        <div class="report-card">
            <div class="report-card-header">
                <div>
                    <span class="report-tag ${reporte.estado === 'Resuelta' ? 'success' : reporte.estado === 'En Proceso' ? 'warning' : 'pending'}">${reporte.estado || 'Pendiente'}</span>
                    <h4>${reporte.asunto}</h4>
                </div>
                <span class="report-date">${new Date(reporte.fecha).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <p class="report-message-preview">${reporte.mensaje}</p>
            <div class="report-card-actions">
                <button class="btn-secondary" onclick="abrirModalReporte(${reporte.id})">Abrir seguimiento</button>
            </div>
        </div>
    `).join('');
}

function renderizarPanelAdmin() {
    const tabla = document.getElementById('usuarios-tbody');
    const totalUsers = document.getElementById('stat-total-users');
    const totalAdmins = document.getElementById('stat-total-admins');

    if (totalUsers) totalUsers.innerText = BASE_DATOS_USUARIOS.length;
    if (totalAdmins) totalAdmins.innerText = BASE_DATOS_USUARIOS.filter(u => u.rol === 'Administrador').length;

    if (tabla) {
        tabla.innerHTML = BASE_DATOS_USUARIOS.map((usuario, index) => `
            <tr>
                <td>${usuario.nombre}</td>
                <td>${usuario.email}</td>
                <td>${usuario.rol}</td>
                <td><span class="badge-tag">${usuario.estado || 'Activo'}</span></td>
                <td>
                    ${usuario.rol !== 'Administrador' ? `<button class="btn-promote" onclick="ascenderUsuario(${index})">Ascender</button>` : '<span style="color: #64748b; font-weight: 700;">Admin</span>'}
                    <button class="btn-delete" onclick="eliminarUsuario(${index})">Eliminar</button>
                </td>
            </tr>
        `).join('');
    }

    const reportsContainer = document.getElementById('admin-reports-cards-container');
    const badge = document.getElementById('badge-reportes');
    if (!reportsContainer) return;

    const reportes = [...BASE_DATOS_REPORTES].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    if (badge) {
        badge.innerText = reportes.length;
        badge.style.display = reportes.length > 0 ? 'inline-block' : 'none';
    }

    if (!reportes.length) {
        reportsContainer.innerHTML = `
            <div class="no-alerts-card">
                <i class="fa-solid fa-inbox"></i>
                <h3>No hay reportes</h3>
                <p>Cuando un agricultor envíe una novedad, aparecerá aquí.</p>
            </div>
        `;
        return;
    }

    reportsContainer.innerHTML = reportes.map(reporte => `
        <div class="report-card">
            <div class="report-card-header">
                <div>
                    <span class="report-tag ${reporte.estado === 'Resuelta' ? 'success' : reporte.estado === 'En Proceso' ? 'warning' : 'pending'}">${reporte.estado || 'Pendiente'}</span>
                    <h4>${reporte.asunto}</h4>
                </div>
                <span class="report-date">${reporte.usuarioNombre || 'Usuario'} • ${new Date(reporte.fecha).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <p class="report-message-preview">${reporte.mensaje}</p>
            <div class="report-card-actions">
                <button class="btn-secondary" onclick="abrirModalReporte(${reporte.id})">Responder</button>
            </div>
        </div>
    `).join('');
}

function abrirModalReporte(id) {
    const reporte = BASE_DATOS_REPORTES.find(r => Number(r.id) === Number(id));
    if (!reporte) return;

    reporteSeleccionadoId = Number(id);
    const modal = document.getElementById('modal-reporte');
    const title = document.getElementById('modal-chat-title');
    const meta = document.getElementById('modal-chat-meta');
    const body = document.getElementById('modal-chat-body');
    const status = document.getElementById('modal-status-select');
    const replyText = document.getElementById('modal-reply-text');

    if (title) title.innerText = reporte.asunto;
    if (meta) meta.innerText = `${reporte.usuarioNombre || 'Usuario'} • ${new Date(reporte.fecha).toLocaleDateString('es-CO', { dateStyle: 'medium' })}`;
    if (status) status.value = reporte.estado || 'Pendiente';
    if (replyText) replyText.value = '';

    const mensajes = Array.isArray(reporte.mensajes) ? reporte.mensajes : [{ tipo: 'usuario', texto: reporte.mensaje, fecha: reporte.fecha }];
    body.innerHTML = mensajes.map(msg => {
        const esAdmin = msg.tipo === 'admin';
        return `
            <div class="chat-bubble ${esAdmin ? 'admin' : 'user'}">
                <div class="chat-header-line">
                    <strong>${esAdmin ? 'Administrador' : (reporte.usuarioNombre || 'Agricultor')}</strong>
                    <span>${new Date(msg.fecha).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <p>${msg.texto}</p>
            </div>
        `;
    }).join('');

    if (modal) modal.classList.remove('oculto');
}

function cerrarModalReporte() {
    const modal = document.getElementById('modal-reporte');
    if (modal) modal.classList.add('oculto');
    reporteSeleccionadoId = null;
}

function enviarReporteAdmin(event) {
    event.preventDefault();

    if (!usuarioSesionActual) {
        alert('Debes iniciar sesión para enviar un reporte.');
        return;
    }

    const asunto = document.getElementById('rep-asunto')?.value.trim();
    const mensaje = document.getElementById('rep-mensaje')?.value.trim();

    if (!asunto || !mensaje) {
        alert('Completa el asunto y el mensaje antes de enviar el reporte.');
        return;
    }

    const nuevoReporte = {
        id: Date.now(),
        usuarioEmail: usuarioSesionActual.email,
        usuarioNombre: usuarioSesionActual.nombre,
        asunto,
        mensaje,
        estado: 'Pendiente',
        fecha: new Date().toISOString(),
        mensajes: [{ tipo: 'usuario', texto: mensaje, fecha: new Date().toISOString() }]
    };

    BASE_DATOS_REPORTES.push(nuevoReporte);
    guardarReportesEnStorage();
    renderizarMisReportes();
    renderizarPanelAdmin();

    const form = document.querySelector('#sec-soporte-admin form');
    if (form) form.reset();

    alert('Reporte enviado correctamente al administrador.');
}

function enviarRespuestaModal() {
    if (!reporteSeleccionadoId) {
        alert('Selecciona un reporte antes de responder.');
        return;
    }

    const respuesta = document.getElementById('modal-reply-text')?.value.trim();
    const statusValue = document.getElementById('modal-status-select')?.value || 'Pendiente';
    if (!respuesta) {
        alert('Escribe una respuesta antes de enviar.');
        return;
    }

    const reporte = BASE_DATOS_REPORTES.find(r => Number(r.id) === Number(reporteSeleccionadoId));
    if (!reporte) return;

    reporte.estado = statusValue;
    reporte.mensajes = Array.isArray(reporte.mensajes) ? reporte.mensajes : [];
    reporte.mensajes.push({
        tipo: 'admin',
        texto: respuesta,
        fecha: new Date().toISOString()
    });

    guardarReportesEnStorage();
    renderizarPanelAdmin();
    renderizarMisReportes();
    abrirModalReporte(reporte.id);
    alert('Respuesta enviada al agricultor.');
}

function ascenderUsuario(index) {
    BASE_DATOS_USUARIOS[index].rol = 'Administrador';
    try {
        localStorage.setItem('tomnova_usuarios', JSON.stringify(BASE_DATOS_USUARIOS));
    } catch(err) {}
    renderizarPanelAdmin();
    alert("Usuario ascendido a Administrador exitosamente.");
}

function eliminarUsuario(index) {
    if (confirm("¿Estás seguro de eliminar este usuario?")) {
        BASE_DATOS_USUARIOS.splice(index, 1);
        try {
            localStorage.setItem('tomnova_usuarios', JSON.stringify(BASE_DATOS_USUARIOS));
        } catch(err) {}
        renderizarPanelAdmin();
    }
}
