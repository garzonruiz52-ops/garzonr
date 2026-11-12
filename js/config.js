const CONFIG = {
    PROYECTO: "Tomnova",
    PUERTO: 5000,
    REFRESH_RATE: 1500,
    GEMINI_API_KEY: "TU_API_KEY_AQUI",
    riegoOn: 85,
    riegoOff: 90,
    tempDiaMin: 21,
    tempDiaMax: 27,
    tempNocheMin: 15,
    tempNocheMax: 18,
    humMin: 60,
    humMax: 80,
    ldrThreshold: 2500,
    proxThreshold: 50
};

const BASE_DATOS_USUARIOS = [
    { nombre: "Juan Pablo Garzón", email: "admin@fincasalvador.com", pass: "admin123", rol: "Administrador", estado: "Activo" },
    { nombre: "Pedro Pérez", email: "agricultor@fincasalvador.com", pass: "123456", rol: "Agricultor", estado: "Activo" },
    { nombre: "Geidy Gutiérrez", email: "geidy@fincasalvador.com", pass: "123456", rol: "Agricultor", estado: "Activo" }
];

const BASE_DATOS_REPORTES = [];

let listaAlertasActivas = [];

let usuarioSesionActual = null;
