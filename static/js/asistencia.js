/**
 * asistencia.js — Reconocimiento automático (sin botón de captura).
 * Al detectar un rostro se envía el mismo frame a /api/reconocer.
 */

const toastContainer = document.getElementById("toast-container");

function toast(msg, tipo = "info", ms = 4000) {
  const iconos = { ok: "✅", err: "❌", warn: "⚠️", info: "ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast--${tipo}`;
  t.innerHTML = `
    <span class="toast__ico">${iconos[tipo] || "ℹ️"}</span>
    <span>${msg}</span>
    <button class="toast__close" aria-label="Cerrar">✕</button>
  `;
  t.querySelector(".toast__close").addEventListener("click", () => cerrarToast(t));
  toastContainer.appendChild(t);
  setTimeout(() => cerrarToast(t), ms);
}

function cerrarToast(el) {
  if (!el.parentNode) return;
  el.classList.add("saliendo");
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

const selCamA     = document.getElementById("sel-cam-a");
const btnAct      = document.getElementById("btn-act");
const vidA        = document.getElementById("vid-a");
const phA         = document.getElementById("ph-a");
const cnvA        = document.getElementById("cnv-a");
const spinA       = document.getElementById("spin-a");
const camMarcoA   = document.getElementById("cam-marco-a");
const camEstadoA  = document.getElementById("cam-estado-a");
const camEstadoTx = document.getElementById("cam-estado-txt-a");

const panelRes   = document.getElementById("panel-res");
const panelInstr = document.getElementById("panel-instr");
const estOk      = document.getElementById("est-ok");
const estFail    = document.getElementById("est-fail");
const estErr     = document.getElementById("est-err");
const resNombre  = document.getElementById("res-nombre");
const resHora    = document.getElementById("res-hora");
const resConf    = document.getElementById("res-conf");
const resFecha   = document.getElementById("res-fecha");
const resMsgOk   = document.getElementById("res-msg-ok");
const resErrMsg  = document.getElementById("res-err-msg");
const btnReint   = document.getElementById("btn-reint");
const historial  = document.getElementById("historial");
const listaHist  = document.getElementById("lista-hist");

let stream = null;
let deteccionInterval = null;
let detectando = false;
let ocupado = false;

function setEstadoCam(txt) {
  if (!txt) { camEstadoA.hidden = true; return; }
  camEstadoA.hidden = false;
  camEstadoTx.textContent = txt;
}

btnAct.addEventListener("click", activarCamara);
selCamA.addEventListener("change", () => { if (stream) activarCamara(); });

async function activarCamara() {
  detenerCamara();
  const facing = selCamA.value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    vidA.srcObject = stream;
    phA.style.display = "none";
    vidA.classList.toggle("espejo", facing === "user");
    btnAct.textContent = "🔄 Cambiar cámara";
    ocultarResultado();
    panelInstr.hidden = false;
    vidA.addEventListener("loadeddata", iniciarDeteccion, { once: true });
  } catch (err) {
    if (err.name === "OverconstrainedError") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        vidA.srcObject = stream;
        phA.style.display = "none";
        vidA.addEventListener("loadeddata", iniciarDeteccion, { once: true });
        return;
      } catch (_) { /**/ }
    }
    const msgs = {
      NotAllowedError: "Permiso de cámara denegado. Autoriza en el navegador.",
      NotFoundError:   "No se encontró ninguna cámara en este dispositivo.",
    };
    toast(msgs[err.name] || "No se pudo acceder a la cámara.", "err", 6000);
  }
}

function detenerCamara() {
  detenerDeteccion();
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  vidA.srcObject = null;
  setEstadoCam(null);
}

function detenerDeteccion() {
  clearInterval(deteccionInterval);
  deteccionInterval = null;
}

function capturarFrame(ancho = 640, alto = 480, calidad = 0.88) {
  cnvA.width = ancho;
  cnvA.height = alto;
  const ctx = cnvA.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (vidA.classList.contains("espejo")) {
    ctx.translate(ancho, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(vidA, 0, 0, ancho, alto);
  return cnvA.toDataURL("image/jpeg", calidad);
}

function iniciarDeteccion() {
  detenerDeteccion();
  ocupado = false;
  detectando = false;
  setEstadoCam("🔍 Buscando rostro…");
  camMarcoA.classList.add("buscando");
  camMarcoA.classList.remove("detectando");
  deteccionInterval = setInterval(tickDeteccion, 700);
}

async function tickDeteccion() {
  if (detectando || ocupado || !stream) return;
  detectando = true;
  try {
    const frameHQ = capturarFrame(640, 480, 0.88);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch("/api/validar-rostro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ foto: frameHQ, tipo: "FRONTAL" }),
    });
    clearTimeout(tid);
    const json = await resp.json();

    if (json.tiene_rostro || json.motivo === "validacion_omitida") {
      camMarcoA.classList.add("detectando");
      camMarcoA.classList.remove("buscando");
      setEstadoCam("✅ Rostro detectado — verificando…");
      ocupado = true;
      detenerDeteccion();
      await reconocer(frameHQ);
    } else {
      camMarcoA.classList.remove("detectando");
      camMarcoA.classList.add("buscando");
      setEstadoCam("🔍 Centra tu rostro en el marco");
    }
  } catch {
    /* tick fallido: se reintenta */
  } finally {
    detectando = false;
  }
}

async function reconocer(dataURL) {
  detenerDeteccion();   // ← ya lo tienes en tickDeteccion antes de llamar, verifica que se mantenga 
  spinA.hidden = false;
  ocultarResultado();

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 25000);

  try {
    const resp = await fetch("/api/reconocer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ foto: dataURL }),
    });
    clearTimeout(tid);
    const json = await resp.json();
    spinA.hidden = true;

    if (!json.ok) {
      mostrarError(json.mensaje || "Error interno del servidor.");
      toast(json.mensaje || "Error del servidor.", "err", 5000);
      agregarHistorial(null, false);
    } else if (json.reconocido) {
      mostrarReconocido(json);
      if (json.ya_registrado_hoy) {
        toast(`ℹ️ ${json.nombre} ya tenía asistencia registrada hoy.`, "warn", 5000);
      } else {
        toast(`✅ Asistencia registrada: ${json.nombre}`, "ok", 5000);
      }
      agregarHistorial(json.nombre, true);
    } else {
      mostrarNoReconocido();
      toast(json.mensaje || "Persona no reconocida. Asistencia NO registrada.", "err", 5000);
      agregarHistorial(null, false);
    }
  } catch (err) {
    clearTimeout(tid);
    spinA.hidden = true;
    const msg = err.name === "AbortError"
      ? "⏱ Sin respuesta. ¿Está instalado face_recognition?"
      : `Error de red: ${err.message}`;
    mostrarError(msg);
    toast(msg, "err", 6000);
    agregarHistorial(null, false);
  }
}

function mostrarReconocido(datos) {
  estOk.hidden = false;
  estFail.hidden = true;
  estErr.hidden = true;
  resNombre.textContent = datos.nombre;
  resHora.textContent = datos.hora;
  resConf.textContent = datos.nivel_confianza;
  resFecha.textContent = new Date().toLocaleDateString("es-PE") + " — " + datos.hora;
  if (datos.ya_registrado_hoy) {
    resMsgOk.textContent = "ℹ️ Ya tenías asistencia registrada hoy.";
    resMsgOk.className = "res-msg res-msg--warn";
  } else {
    resMsgOk.textContent = "✅ Asistencia registrada correctamente.";
    resMsgOk.className = "res-msg res-msg--ok";
  }
  panelRes.hidden = false;
  panelInstr.hidden = true;
}

function mostrarNoReconocido() {
  estOk.hidden = true;
  estFail.hidden = false;
  estErr.hidden = true;
  panelRes.hidden = false;
  panelInstr.hidden = true;
}

function mostrarError(msg) {
  estOk.hidden = true;
  estFail.hidden = true;
  estErr.hidden = false;
  resErrMsg.textContent = msg;
  panelRes.hidden = false;
  panelInstr.hidden = true;
}

function ocultarResultado() {
  panelRes.hidden = true;
  estOk.hidden = true;
  estFail.hidden = true;
  estErr.hidden = true;
}

btnReint.addEventListener("click", () => {
  ocultarResultado();
  panelInstr.hidden = false;
  if (stream) iniciarDeteccion();
  else activarCamara();
});

function agregarHistorial(nombre, ok) {
  historial.hidden = false;
  const li = document.createElement("li");
  li.className = "historial-item";
  const hora = new Date().toLocaleTimeString("es-PE");
  const badge = document.createElement("span");
  badge.className = ok ? "h-badge h-badge--ok" : "h-badge h-badge--fail";
  badge.textContent = ok ? "✔" : "✗";
  const txt = document.createElement("span");
  txt.textContent = ok ? `${hora} — ${nombre}` : `${hora} — No reconocido`;
  li.appendChild(badge);
  li.appendChild(txt);
  listaHist.prepend(li);
}
