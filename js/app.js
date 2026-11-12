// Cargar usuarios guardados si existen
try {
    const usrsGuardados = localStorage.getItem('tomnova_usuarios');
    if (usrsGuardados) {
        const parsed = JSON.parse(usrsGuardados);
        if (Array.isArray(parsed) && parsed.length > 0) {
            BASE_DATOS_USUARIOS = parsed;
        }
    }
} catch(err) {}
let reporteSeleccionadoId = null;
document.addEventListener("DOMContentLoaded", () => {
    const cfgRiegoOn = document.getElementById('cfg-riego-on');
    if (cfgRiegoOn) cfgRiegoOn.value = CONFIG.riegoOn;

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
    aplicarPermisosRol();
}
function manejarRegistro(event) {
    event.preventDefault();
    const nuevo = { nombre: document.getElementById('reg-nombre').value, email: document.getElementById('reg-email').value, pass: document.getElementById('reg-pass').value, rol: "Agricultor", estado: "Activo" };
    BASE_DATOS_USUARIOS.push(nuevo);
    usuarioSesionActual = nuevo;
    alert("Registro exitoso.");
    aplicarPermisosRol();
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
    sondearESP32();
}

function cerrarSesion() {
    usuarioSesionActual = null;
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
            riegoSubText.innerText = 'Sin dato de humedad del suelo';
        } else if (regando) {
            riegoDot.className = "dot-indicator red";
            riegoSubText.innerHTML = `<strong style="color: var(--accent-red);">¡RIEGO ACTIVO!</strong> Suelo al ${fmt(humSuelo)}% (umbral de apertura: ${CONFIG.riegoOn}%)`;
        } else {
            riegoDot.className = "dot-indicator green";
            riegoSubText.innerText = `Riego en espera: abre por debajo de ${CONFIG.riegoOn} % (Actual: ${fmt(humSuelo)}%)`;
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
        ponerPill('prox-status-pill', 'prox-status-text', 'neutral', 'Sin datos');
    } else {
        const cerca = d.distancia < CONFIG.proxThreshold;
        ponerPill('prox-status-pill', 'prox-status-text', cerca ? 'warning' : 'success', cerca ? 'Objeto cercano' : 'Zona despejada');
    }
}

async function enviarPreguntaIA(event) {
    event.preventDefault();
    const inp = document.getElementById('ia-input-text');
    const txt = inp.value.trim();
    if (!txt) return;
    const box = document.getElementById('ia-messages-box');
    box.innerHTML += `<div class="chat-msg user"><i class="fa-solid fa-user user-icon"></i><div class="msg-bubble">${txt}</div></div>`;
    inp.value = '';
    setTimeout(() => {
        box.innerHTML += `<div class="chat-msg bot"><i class="fa-solid fa-robot bot-icon"></i><div class="msg-bubble"><strong>Tomnova IA:</strong> Entendido sobre "${txt}". El sistema opera con normalidad.</div></div>`;
        box.scrollTop = box.scrollHeight;
    }, 800);
}

function enviarReporteAdmin(event) {
    event.preventDefault();

    const asunto = document.getElementById('rep-asunto').value.trim();
    const mensaje = document.getElementById('rep-mensaje').value.trim();

    if (!asunto || !mensaje) {
        alert('Completa el asunto y el mensaje antes de enviar.');
        return;
    }

    const nuevoReporte = {
        id: Date.now(),
        asunto,
        mensaje,
        agricultor: usuarioSesionActual ? usuarioSesionActual.nombre : 'Agricultor',
        fecha: new Date().toLocaleString('es-CO'),
        estado: 'Pendiente',
        mensajes: [{
            emisor: 'agricultor',
            autor: usuarioSesionActual ? usuarioSesionActual.nombre : 'Agricultor',
            texto: mensaje,
            fecha: new Date().toLocaleString('es-CO')
        }]
    };

    BASE_DATOS_REPORTES.push(nuevoReporte);

    document.getElementById('rep-asunto').value = '';
    document.getElementById('rep-mensaje').value = '';

    alert('Reporte enviado con éxito.');
    cambiarSeccion('soporte-admin', document.getElementById('btn-menu-soporte'));
    renderizarPanelAdmin();
}

function renderizarPanelAdmin() {
    const tbodyUsers = document.getElementById('usuarios-tbody');
    if (tbodyUsers) {
        tbodyUsers.innerHTML = '';
        BASE_DATOS_USUARIOS.forEach((u, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${u.nombre}</strong></td>
                <td>${u.email}</td>
                <td><span class="badge-tag">${u.rol}</span></td>
                <td><span class="status-pill success"><span class="pill-dot"></span> ${u.estado}</span></td>
                <td>
                    ${u.rol !== 'Administrador' ? `<button class="btn-promote" onclick="ascenderUsuario(${index})"><i class="fa-solid fa-shield-halved"></i> Ascender</button>` : ''}
                    ${u.email !== usuarioSesionActual.email ? `<button class="btn-delete" onclick="eliminarUsuario(${index})"><i class="fa-solid fa-trash"></i> Eliminar</button>` : ''}
                </td>
            `;
            tbodyUsers.appendChild(tr);
        });
        document.getElementById('stat-total-users').innerText = BASE_DATOS_USUARIOS.length;
        document.getElementById('stat-total-admins').innerText = BASE_DATOS_USUARIOS.filter(u => u.rol === 'Administrador').length;
    }

    const containerReports = document.getElementById('admin-reports-cards-container');
    if (containerReports) {
        containerReports.innerHTML = '';
        if (BASE_DATOS_REPORTES.length === 0) {
            containerReports.innerHTML = `<div class="no-alerts-card"><i class="fa-solid fa-inbox"></i><h3>No hay reportes</h3><p>Los agricultores no han enviado novedades.</p></div>`;
            return;
        }
        BASE_DATOS_REPORTES.forEach(rep => {
            const item = document.createElement('div');
            item.className = 'report-card-item';
            item.onclick = () => abrirModalReporte(rep.id);
            item.innerHTML = `
                <div class="report-card-info">
                    <div class="report-card-title">${rep.asunto}</div>
                    <div class="report-card-meta">
                        <span><i class="fa-solid fa-user"></i> ${rep.agricultor}</span>
                        <span><i class="fa-solid fa-clock"></i> ${rep.fecha}</span>
                        <span class="badge-tag">${rep.estado}</span>
                    </div>
                    <div class="report-card-preview">${rep.mensaje}</div>
                </div>
                <div class="report-card-actions">
                    <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem;"><i class="fa-solid fa-comments"></i> Ver Chat</button>
                </div>
            `;
            containerReports.appendChild(item);
        });
    }
}

function ascenderUsuario(index) {
    BASE_DATOS_USUARIOS[index].rol = 'Administrador';
    renderizarPanelAdmin();
    alert("Usuario ascendido a Administrador exitosamente.");
}

function eliminarUsuario(index) {
    if (confirm("¿Estás seguro de eliminar este usuario?")) {
        BASE_DATOS_USUARIOS.splice(index, 1);
        renderizarPanelAdmin();
    }
}

function abrirModalReporte(id) {
    reporteSeleccionadoId = id;
    const rep = BASE_DATOS_REPORTES.find(r => r.id === id);
    if (!rep) return;
    document.getElementById('modal-chat-title').innerText = rep.asunto;
    document.getElementById('modal-chat-meta').innerText = `${rep.agricultor} • ${rep.fecha}`;
    document.getElementById('modal-status-select').value = rep.estado;
    
    const body = document.getElementById('modal-chat-body');
    body.innerHTML = '';
    rep.mensajes.forEach(m => {
        const wrap = document.createElement('div');
        wrap.className = `chat-bubble-wrapper ${m.emisor === 'admin' ? 'admin' : 'agricultor'}`;
        wrap.innerHTML = `
            <div class="chat-bubble-header">${m.autor}</div>
            <div class="chat-bubble-content">${m.texto}</div>
            <div class="chat-bubble-time">${m.fecha}</div>
        `;
        body.appendChild(wrap);
    });
    body.scrollTop = body.scrollHeight;
    document.getElementById('modal-reporte').classList.remove('oculto');
}

function cerrarModalReporte() {
    document.getElementById('modal-reporte').classList.add('oculto');
}

function enviarRespuestaModal() {
    const txt = document.getElementById('modal-reply-text').value.trim();
    const nuevoEstado = document.getElementById('modal-status-select').value;
    if (!txt) return;
    const rep = BASE_DATOS_REPORTES.find(r => r.id === reporteSeleccionadoId);
    if (rep) {
        rep.estado = nuevoEstado;
        rep.mensajes.push({ emisor: 'admin', autor: usuarioSesionActual.nombre, texto: txt, fecha: new Date().toLocaleString('es-CO') });
        abrirModalReporte(rep.id);
        document.getElementById('modal-reply-text').value = '';
        renderizarPanelAdmin();
        alert("Respuesta enviada al agricultor.");
    }
}
