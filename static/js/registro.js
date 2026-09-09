/** ultimooo arreglado: version con fallas laterales
 * registro.js — Pantalla A: registro facial con wizard horizontal.
 *
 * PASO 2 — DETECCIÓN EN VIVO + AUTO-CAPTURA:
 *   Cada ~550 ms se envía el mismo frame que se guardará a /api/validar-rostro.
 *   Cuando el backend acepta el rostro, esa foto se registra de inmediato
 *   (sin recapturar después). No hay botón de captura manual.
 */

// ════════════════════════════════════════════════
// TOASTS
// ════════════════════════════════════════════════
const toastContainer = document.getElementById("toast-container");

function toast(msg, tipo = "info", ms = 4000) {
  const ico = { ok:"✅", err:"❌", warn:"⚠️", info:"ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast--${tipo}`;
  t.innerHTML = `<span class="toast__ico">${ico[tipo]||"ℹ️"}</span><span>${msg}</span>
    <button class="toast__close" aria-label="Cerrar">✕</button>`;
  t.querySelector(".toast__close").onclick = () => cerrarToast(t);
  toastContainer.appendChild(t);
  setTimeout(() => cerrarToast(t), ms);
}
function cerrarToast(el) {
  if (!el.parentNode) return;
  el.classList.add("saliendo");
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

// ════════════════════════════════════════════════
// DOM REFS
// ════════════════════════════════════════════════
const buscador    = document.getElementById("buscador");
const selColab    = document.getElementById("sel-colab");
const colabCard   = document.getElementById("colab-card");
const colabAv     = document.getElementById("colab-av");
const colabNombre = document.getElementById("colab-nombre");
const colabCodigo = document.getElementById("colab-codigo");
const colabArea   = document.getElementById("colab-area");
const avisoReempl = document.getElementById("aviso-reemplazo");
const btnSiReempl = document.getElementById("btn-si-reempl");
const btnNoReempl = document.getElementById("btn-no-reempl");
const btnPaso1    = document.getElementById("btn-paso1");

const selCam      = document.getElementById("sel-cam");
const btnCam      = document.getElementById("btn-cam");
const video       = document.getElementById("video");
const camPh       = document.getElementById("cam-ph");
const camMarco    = document.getElementById("cam-marco");
const camCountdown= document.getElementById("cam-countdown");
const countdownNum= document.getElementById("countdown-num");
const camEstado   = document.getElementById("cam-estado");
const camEstadoTxt= document.getElementById("cam-estado-txt");
const canvas      = document.getElementById("canvas");
const instrIco    = document.getElementById("instr-ico");
const instrTxt    = document.getElementById("instr-txt");
const btnPaso2    = document.getElementById("btn-paso2");
const btnV0       = document.getElementById("btn-v0");

const btnV1       = document.getElementById("btn-v1");
const btnGuardar  = document.getElementById("btn-guardar");
const spinnerG    = document.getElementById("spinner-g");
const msgG        = document.getElementById("msg-g");
const btnNuevo    = document.getElementById("btn-nuevo");
const guardarCta  = document.getElementById("guardar-cta");
const gTitulo     = document.getElementById("g-titulo");
const gDesc       = document.getElementById("g-desc");

const diapos   = document.getElementById("diapositivas");
const stepEls  = [
  document.getElementById("step-0"),
  document.getElementById("step-1"),
  document.getElementById("step-2"),
];

// ════════════════════════════════════════════════
// ESTADO GLOBAL
// ════════════════════════════════════════════════
const PASOS = [
  { tipo: "FRONTAL",           ico: "😐", txt: "Mire directo a la cámara — se tomará sola" },
  { tipo: "LATERAL_IZQUIERDA", ico: "👈", txt: "Gire la cabeza hacia su izquierda" },
  { tipo: "LATERAL_DERECHA",   ico: "👉", txt: "Gire la cabeza hacia su derecha" },
];

let todosColabs    = [];
let colaborador    = null;
let debeReemplazar = false;
let pasoFoto       = 0;
let stream         = null;
let slideActual    = 0;
const fotos        = {};   // { FRONTAL: { url, valida }, ... }

// Estado de la detección en vivo
let deteccionInterval = null;
let cuentaRegresiva   = null;
let contadorActual    = 0;
let detectando        = false;
let frameValidado     = null;  // dataURL del frame que el backend ya aceptó
let pausaHasta        = 0;     // ms epoch: no detectar hasta entonces (cambio de pose)
let ticksPerfilOk     = 0;     // laterales: 1 confirmación basta

// ════════════════════════════════════════════════
// 1. WIZARD
// ════════════════════════════════════════════════
function irSlide(n) {
  slideActual = n;
  diapos.style.transform = `translateX(-${n * 100}%)`;
  stepEls.forEach((el, i) => {
    el.classList.remove("activo", "completado");
    if (i < n)        el.classList.add("completado");
    else if (i === n) el.classList.add("activo");
  });
}

// ════════════════════════════════════════════════
// 2. COLABORADORES
// ════════════════════════════════════════════════
async function cargarColabs() {
  try {
    const r = await fetch("/api/colaboradores");
    const j = await r.json();
    if (!j.ok) throw new Error(j.mensaje);
    todosColabs = j.colaboradores;
    llenarSelect(todosColabs);
  } catch (e) {
    selColab.innerHTML = `<option value="">Error: ${e.message}</option>`;
    toast("No se pudo cargar la lista de colaboradores.", "err");
  }
}

function llenarSelect(lista) {
  selColab.innerHTML = '<option value="">— Seleccione un colaborador —</option>';
  lista.forEach(c => {
    const o = document.createElement("option");
    o.value             = c.id_colaborador;
    o.dataset.nombres   = c.nombres;
    o.dataset.apellidos = c.apellidos;
    o.dataset.codigo    = c.codigo_colaborador;
    o.dataset.area      = c.area || "—";
    o.textContent = `${c.apellidos}, ${c.nombres} (${c.codigo_colaborador})`;
    selColab.appendChild(o);
  });
}

buscador.addEventListener("input", () => {
  const q = buscador.value.toLowerCase();
  llenarSelect(todosColabs.filter(c =>
    c.nombres.toLowerCase().includes(q) ||
    c.apellidos.toLowerCase().includes(q) ||
    c.codigo_colaborador.toLowerCase().includes(q)
  ));
  selColab.value = "";
  ocultarCard();
});

// ════════════════════════════════════════════════
// 3. SELECCIÓN COLABORADOR
// ════════════════════════════════════════════════
selColab.addEventListener("change", async () => {
  ocultarCard();
  avisoReempl.hidden = true;
  btnPaso1.disabled  = true;
  debeReemplazar     = false;
  if (!selColab.value) return;

  const o         = selColab.selectedOptions[0];
  const nombres   = o.dataset.nombres;
  const apellidos = o.dataset.apellidos;

  colaborador = {
    id: parseInt(selColab.value, 10),
    nombres, apellidos,
    iniciales: (nombres[0] + (apellidos[0] || "")).toUpperCase(),
  };

  colabAv.textContent     = colaborador.iniciales;
  colabNombre.textContent = `${nombres} ${apellidos}`;
  colabCodigo.textContent = `Código: ${o.dataset.codigo}`;
  colabArea.textContent   = `Área: ${o.dataset.area}`;
  colabCard.hidden = false;

  try {
    const r = await fetch(`/api/registro/estado/${colaborador.id}`);
    const j = await r.json();
    if (j.ok && j.tiene_registro) {
      avisoReempl.hidden = false;
    } else {
      btnPaso1.disabled = false;
    }
  } catch {
    btnPaso1.disabled = false;
  }
});

function ocultarCard() {
  colabCard.hidden = true;
  colaborador = null;
  colabNombre.textContent = colabCodigo.textContent = colabArea.textContent = "";
}

btnSiReempl.addEventListener("click", () => {
  debeReemplazar    = true;
  avisoReempl.hidden = true;
  btnPaso1.disabled  = false;
});
btnNoReempl.addEventListener("click", () => {
  selColab.value    = "";
  avisoReempl.hidden = true;
  ocultarCard();
  debeReemplazar = false;
});

btnPaso1.addEventListener("click", () => {
  pasoFoto = 0;
  limpiarFotos();
  actualizarInstruccion();
  actualizarPills();
  irSlide(1);
  // Si ya había stream activo, reiniciar la detección
  if (stream) iniciarDeteccionEnVivo();
});

// ════════════════════════════════════════════════
// 4. CÁMARA
// ════════════════════════════════════════════════
selCam.addEventListener("change", () => { if (stream) activarCamara(); });
btnCam.addEventListener("click", activarCamara);

async function activarCamara() {
  detenerDeteccion();
  detenerCamara();

  const facing = selCam.value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    camPh.style.display = "none";
    // Espejo solo en cámara frontal
    video.classList.toggle("espejo", facing === "user");
    btnCam.textContent  = "🔄 Cambiar";

    // Esperar a que el video esté listo y arrancar la detección
    video.addEventListener("loadeddata", iniciarDeteccionEnVivo, { once: true });
  } catch (err) {
    if (err.name === "OverconstrainedError") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        camPh.style.display = "none";
        video.addEventListener("loadeddata", iniciarDeteccionEnVivo, { once: true });
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
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  setEstadoCamara(null);
}

// ════════════════════════════════════════════════
// 5. DETECCIÓN EN VIVO + AUTO-CAPTURA
// ════════════════════════════════════════════════

function capturarFrame(ancho = 960, alto = 720, calidad = 0.9) {
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (video.classList.contains("espejo")) { ctx.translate(ancho, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, ancho, alto);
  return canvas.toDataURL("image/jpeg", calidad);
}

function iniciarDeteccionEnVivo() {
  detenerDeteccion();
  ticksPerfilOk = 0;
  actualizarInstruccion();
  setEstadoCamara("buscando", "🔍 Buscando rostro…");
  deteccionInterval = setInterval(tickDeteccion, 550);
}

function detenerDeteccion() {
  clearInterval(deteccionInterval);
  deteccionInterval = null;
  cancelarCuentaRegresiva();
}

let intentosLateralFallidos = 0;   // nuevo: cuenta cuántas veces seguidas falla el lateral

async function tickDeteccion() {
  if (detectando || !stream) return;
  if (Date.now() < pausaHasta) return;
  if (fotos[PASOS[pasoFoto]?.tipo]?.valida) return;
  if (cuentaRegresiva) return;   // ← CLAVE: si ya hay una cuenta corriendo, no lances otra

  detectando = true;
  try {
    const frameHQ = capturarFrame(960, 720, 0.9);
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 4000);

    const resp = await fetch("/api/validar-rostro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        foto: frameHQ,
        tipo: PASOS[pasoFoto].tipo,
        referencia: fotos.FRONTAL?.url || "",
        exigir_encoding: false,
      }),
    });
    clearTimeout(tid);
    const json = await resp.json();

    if (json.tiene_rostro) {
      intentosLateralFallidos = 0;
      camMarco.classList.add("detectando");
      camMarco.classList.remove("buscando");
      frameValidado = frameHQ;
      const esLateral = PASOS[pasoFoto].tipo !== "FRONTAL";
      setEstadoCamara("ok", esLateral ? "✅ Ángulo correcto — mantén la posición…" : "✅ Rostro detectado — capturando…");
      iniciarCuentaRegresiva(esLateral);
    } else {
     frameValidado = null;
      camMarco.classList.remove("detectando");
      camMarco.classList.add("buscando");
      setEstadoCamara("buscando", json.motivo || "🔍 Centra tu rostro en el marco");
      // Ya no se detiene el proceso — sigue intentando indefinidamente.
      // El botón manual sigue disponible como opción, no como única salida.

      // Si es lateral y lleva muchos intentos fallidos seguidos, ofrecer botón manual
      const esLateral = PASOS[pasoFoto].tipo !== "FRONTAL";
      if (esLateral) {
        intentosLateralFallidos++;
          if (intentosLateralFallidos >= 15) {
          detenerDeteccion();
          toast("⚠️ Intenta con el botón '📷 Capturar manualmente' de abajo.", "warn", 6000);
          setEstadoCamara("buscando", "Usa el botón de captura manual para continuar");
          return;
        }
      }
    }
  } catch {
  } finally {
    detectando = false;
  }
}



/**
 * Confirmación corta y se guarda el mismo frame ya validado.
 */
function iniciarCuentaRegresiva(esLateral) {
  if (cuentaRegresiva) return;   // ← CLAVE: nunca crear una segunda mientras haya una activa

  contadorActual = esLateral ? 3 : 1;
  countdownNum.textContent = contadorActual;
  camCountdown.hidden = false;

  cuentaRegresiva = setInterval(() => {
    contadorActual--;
    if (contadorActual < 0) contadorActual = 0;   // ← nunca negativo
    countdownNum.textContent = contadorActual;


    //mensaje 1 de proceso de foto
     if (contadorActual <= 0) {
      cancelarCuentaRegresiva();
      setEstadoCamara("ok", "📸 Procesando tu foto…");
      confirmarConEncoding(capturarFrame(960, 720, 0.9));
    }
  }, 700);
}

function cancelarCuentaRegresiva() {
  clearInterval(cuentaRegresiva);
  cuentaRegresiva = null;
  camCountdown.hidden = true;
}
let intentosEncodingFallidos = 0;

async function confirmarConEncoding(frame) {
  detenerDeteccion();
  setEstadoCamara("ok", "🔎 Verificando tu rostro, un momento…");

  const avisoLento = setTimeout(() => {
    setEstadoCamara("ok", "⏳ Procesando, sigue esperando…");
  }, 3000);

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch("/api/validar-rostro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        foto: frame,
        tipo: PASOS[pasoFoto].tipo,
        referencia: fotos.FRONTAL?.url || "",
        exigir_encoding: true,
      }),
    });
    clearTimeout(tid);
    clearTimeout(avisoLento);
    const json = await resp.json();

    if (json.tiene_rostro && json.encoding) {
      window._ultimoEncoding = json.encoding;
      tomarFotoAutomatica(frame);
    } else {
      toast(json.motivo || "No se pudo verificar. Reintentando…", "warn", 2500);
      setEstadoCamara("buscando", "Vuelve a intentarlo, mantén la posición firme");
      pausaHasta = Date.now() + 400;
      iniciarDeteccionEnVivo();
    }
  } catch (e) {
    clearTimeout(avisoLento);
    toast("Tiempo agotado verificando. Reintentando…", "warn", 2500);
    iniciarDeteccionEnVivo();
  }
}

//reemplazo de
function tomarFotoAutomatica(dataURL) {
  if (!stream) return;
  const tipo = PASOS[pasoFoto].tipo;
  if (fotos[tipo]?.valida) return;

  const url = dataURL || frameValidado || capturarFrame(640, 480, 0.88);
    fotos[tipo] = { url, valida: true, encoding: window._ultimoEncoding || null };  //
  mostrarMiniatura(tipo, url, true);
  frameValidado = null;

  toast(`${PASOS[pasoFoto].ico} ${etiquetaTipo(tipo)} capturada ✅`, "ok", 2500);
  flashCaptura();

  avanzarPaso();
  actualizarInstruccion();
  actualizarPills();
  verificarListo();

  camMarco.classList.remove("detectando");
  camMarco.classList.add("buscando");

  ticksPerfilOk = 0;
   if (!PASOS.every(p => fotos[p.tipo]?.valida)) {
    pausaHasta = Date.now() + 2000;   // antes 1100 — más margen para que el video refleje el nuevo giro
    setEstadoCamara("buscando", PASOS[pasoFoto].tipo === "LATERAL_IZQUIERDA"
      ? "👈 Ahora gira la cabeza a la izquierda"
      : "👉 Ahora gira la cabeza a la derecha");
      iniciarDeteccionEnVivo();  //reinicia el escaneo automático para el siguiente paso
  }
}

/**
 * Efecto flash blanco al tomar la foto.
 */
function flashCaptura() {
  const flash = document.createElement("div");
  flash.style.cssText = `
    position:absolute;inset:0;background:#fff;opacity:.7;
    border-radius:inherit;pointer-events:none;z-index:20;
    animation:flashAnim .35s ease forwards;
  `;
  // Inyectar keyframes si no existen
  if (!document.getElementById("flash-kf")) {
    const s = document.createElement("style");
    s.id = "flash-kf";
    s.textContent = "@keyframes flashAnim{0%{opacity:.7}100%{opacity:0}}";
    document.head.appendChild(s);
  }
  const wrap = document.getElementById("cam-wrap");
  wrap.appendChild(flash);
  flash.addEventListener("animationend", () => flash.remove(), { once: true });
}


// ════════════════════════════════════════════════
// 7. RETOMAR FOTO
// ════════════════════════════════════════════════
document.querySelectorAll(".btn-retomar").forEach(btn => {
  btn.addEventListener("click", () => {
    const tipo = btn.dataset.tipo;
    delete fotos[tipo];
    limpiarMiniatura(tipo);
    pasoFoto = PASOS.findIndex(p => p.tipo === tipo);
    actualizarInstruccion();
    actualizarPills();
    btnPaso2.disabled = true;
    toast(`Foto ${etiquetaTipo(tipo)} eliminada. Retomando…`, "warn", 3000);
    // Reiniciar detección para el nuevo paso
    if (stream) iniciarDeteccionEnVivo();
  });
});

// ════════════════════════════════════════════════
// 8. HELPERS DE UI
// ════════════════════════════════════════════════
function setEstadoCamara(tipo, txt) {
  if (!txt) { camEstado.hidden = true; return; }
  camEstado.hidden = false;
  camEstadoTxt.textContent = txt;
}

function actualizarInstruccion() {
  const p = PASOS[pasoFoto];
  if (!p) return;
  instrIco.textContent = p.ico;
  instrTxt.textContent = p.txt;
}

function actualizarPills() {
  PASOS.forEach((p, i) => {
    const pill = document.getElementById(`pill-${p.tipo}`);
    pill.classList.remove("foto-pill--activa", "foto-pill--lista", "foto-pill--error");
    if (fotos[p.tipo]?.valida)  pill.classList.add("foto-pill--lista");
    else if (i === pasoFoto)     pill.classList.add("foto-pill--activa");
  });
}

function verificarListo() {
  const listo = PASOS.every(p => fotos[p.tipo]?.valida);
  btnPaso2.disabled = !listo;
  if (listo) {
    instrIco.textContent = "✅";
    instrTxt.textContent = "¡Las 3 fotos están verificadas! Pulsa Siguiente.";
    detenerDeteccion();
    setEstadoCamara("ok", "✅ Todas las fotos listas");
    toast("¡Las 3 fotos están listas! Pulsa Siguiente para guardar.", "ok", 4000);
  }
}

function avanzarPaso() {
  intentosLateralFallidos = 0;
  intentosEncodingFallidos = 0;
  const sig = PASOS.findIndex((p, i) => i > pasoFoto && !fotos[p.tipo]);
  if (sig !== -1) { pasoFoto = sig; return; }
  const falta = PASOS.findIndex(p => !fotos[p.tipo]);
  if (falta !== -1) pasoFoto = falta;
}

function etiquetaTipo(tipo) {
  return {
    FRONTAL: "Frontal",
    LATERAL_IZQUIERDA: "Lateral izquierda",
    LATERAL_DERECHA:   "Lateral derecha",
  }[tipo] || tipo;
}

function mostrarMiniatura(tipo, dataURL, valida) {
  const fig   = document.getElementById(`mini-${tipo}`);
  const vacio = fig.querySelector(".mini-vacio");
  const btn   = fig.querySelector(".btn-retomar");
  let img     = fig.querySelector("img");
  if (!img) { img = document.createElement("img"); img.alt = tipo; vacio.before(img); }
  img.src = dataURL;
  img.className = valida ? "" : "foto-invalida";
  vacio.style.display = "none";
  btn.hidden = false;
}

function limpiarMiniatura(tipo) {
  const fig   = document.getElementById(`mini-${tipo}`);
  const vacio = fig.querySelector(".mini-vacio");
  const btn   = fig.querySelector(".btn-retomar");
  const img   = fig.querySelector("img");
  if (img) img.remove();
  vacio.style.display = "";
  btn.hidden = true;
}

function limpiarFotos() {
  PASOS.forEach(p => { delete fotos[p.tipo]; limpiarMiniatura(p.tipo); });
  btnPaso2.disabled = true;
}

function mostrarMsgInline(el, txt, clase) {
  el.textContent = txt;
  el.className   = `alerta ${clase}`;
  el.hidden      = false;
}

// ════════════════════════════════════════════════
// 9. NAVEGACIÓN DEL WIZARD
// ════════════════════════════════════════════════
btnV0.addEventListener("click", () => {
  irSlide(0);
  detenerDeteccion();
  detenerCamara();
});

btnPaso2.addEventListener("click", () => {
  detenerDeteccion();

  PASOS.forEach(p => {
    const div   = document.getElementById(`res-${p.tipo}`);
    const vacio = div.querySelector(".mini-vacio");
    let img     = div.querySelector("img");
    if (fotos[p.tipo]) {
      if (!img) {
        img = document.createElement("img");
        img.alt = p.tipo;
        Object.assign(img.style, {
          width:"100%", aspectRatio:"3/4", objectFit:"cover",
          borderRadius:"9px", border:"2.5px solid var(--c-ok)",
        });
        div.prepend(img);
      }
      img.src = fotos[p.tipo].url;
      if (vacio) vacio.style.display = "none";
    }
  });

  msgG.hidden      = true;
  btnNuevo.hidden  = true;
  guardarCta.style.display = "";
  btnGuardar.disabled = false;
  gTitulo.textContent = "Listo para guardar";
  gDesc.textContent   = "Las 3 fotos fueron capturadas y verificadas. Pulsa el botón.";
  irSlide(2);
  detenerCamara();
});

btnV1.addEventListener("click", () => {
  irSlide(1);
  msgG.hidden = true;
  // Reactivar detección si la cámara sigue activa
  if (stream) iniciarDeteccionEnVivo();
});

// ════════════════════════════════════════════════
// 10. GUARDAR
// ════════════════════════════════════════════════
btnGuardar.addEventListener("click", async () => {
  if (!colaborador) return;

  btnGuardar.disabled      = true;
  guardarCta.style.display = "none";
  spinnerG.hidden          = false;
  msgG.hidden              = true;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);

  try {
    const resp = await fetch("/api/registro/guardar", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  ctrl.signal,
            body: JSON.stringify({
        id_colaborador: colaborador.id,
        reemplazar:     debeReemplazar,
                fotos: {
          FRONTAL:           { url: fotos.FRONTAL.url, encoding: fotos.FRONTAL.encoding },
          LATERAL_IZQUIERDA: { url: fotos.LATERAL_IZQUIERDA.url, encoding: fotos.LATERAL_IZQUIERDA.encoding },
          LATERAL_DERECHA:   { url: fotos.LATERAL_DERECHA.url, encoding: fotos.LATERAL_DERECHA.encoding },
        },
      }),
    });
    clearTimeout(tid);
    const json = await resp.json();

    spinnerG.hidden = true;

    if (json.ok) {
      mostrarMsgInline(
        msgG,
        `✅ Registro guardado para ${colaborador.nombres} ${colaborador.apellidos}. Motor: ${json.motor}.`,
        "alerta--success"
      );
      gTitulo.textContent = "¡Registro completado!";
      gDesc.textContent   = "El perfil facial fue guardado en la base de datos.";
      btnNuevo.hidden     = false;
      toast(`✅ Perfil facial de ${colaborador.nombres} guardado correctamente.`, "ok", 5000);
    } else {
      guardarCta.style.display = "";
      btnGuardar.disabled      = false;
      mostrarMsgInline(msgG, `❌ ${json.mensaje}`, "alerta--error");
      toast(json.mensaje, "err", 6000);
    }
  } catch (err) {
    clearTimeout(tid);
    spinnerG.hidden          = true;
    guardarCta.style.display = "";
    btnGuardar.disabled      = false;
    const msg = err.name === "AbortError"
      ? "⏱ Tiempo agotado (30 s). Ejecuta: python -m pip install Pillow numpy opencv-python"
      : `Error de red: ${err.message}`;
    mostrarMsgInline(msgG, msg, "alerta--error");
    toast(msg, "err", 7000);
  }
});

// ════════════════════════════════════════════════
// 11. NUEVO REGISTRO
// ════════════════════════════════════════════════
btnNuevo.addEventListener("click", () => {
  detenerDeteccion();
  detenerCamara();
  selColab.value      = "";
  buscador.value      = "";
  colaborador         = null;
  debeReemplazar      = false;
  pasoFoto            = 0;
  avisoReempl.hidden  = true;
  btnPaso1.disabled   = true;
  ocultarCard();
  limpiarFotos();
  llenarSelect(todosColabs);
  spinnerG.hidden          = true;
  msgG.hidden              = true;
  btnNuevo.hidden          = true;
  guardarCta.style.display = "";
  btnGuardar.disabled      = false;
  irSlide(0);
});

//boton
// Al final de registro.js
const btnCapturaManual = document.getElementById("btn-captura-manual");

btnCapturaManual.addEventListener("click", async () => {
  if (!stream) { toast("Activa la cámara primero.", "warn", 3000); return; }
  const tipo = PASOS[pasoFoto]?.tipo;
  if (!tipo || fotos[tipo]?.valida) return;

  detenerDeteccion();
  intentosLateralFallidos = 0;
  const frame = capturarFrame(960, 720, 0.9);
  toast("Verificando…", "info", 2000);
  await confirmarConEncoding(frame);   // pasa por la MISMA validación real, no se salta nada
});
// ════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════
cargarColabs();
