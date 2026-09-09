""" ultimo
app.py
------
Servidor Flask: registro facial (Pantalla A) y asistencia (Pantalla B).

Motor: face_recognition (dlib, encoding de 128 dimensiones).
OpenCV Haar solo detecta SI hay un rostro en vivo; NUNCA genera
el vector de identidad (eso confundía personas).
"""

import base64
import io
import os
import uuid
from datetime import datetime

from flask import Flask, jsonify, render_template, request

try:
    import numpy as np
    from PIL import Image
    DEPS_OK = True
except ImportError as _e:
    DEPS_OK = False
    _DEPS_ERROR = (
        f"Dependencias faltantes ({_e}). "
        "Ejecuta: python -m pip install Pillow numpy opencv-python"
    )

from config import Config
from db import (
    guardar_registro_facial,
    listar_colaboradores,
    obtener_encodings_activos,
    probar_conexion,
    registrar_asistencia,
    tiene_registro_activo,
    ya_registro_hoy,
)

try:
    import face_recognition
    USAR_FACE_RECOGNITION = True
except ImportError:
    USAR_FACE_RECOGNITION = False

if DEPS_OK:
    try:
        import cv2
        CV2_OK = True
    except ImportError:
        CV2_OK = False
else:
    CV2_OK = False


app = Flask(__name__)
app.config["SECRET_KEY"]    = Config.SECRET_KEY
app.config["UPLOAD_FOLDER"] = Config.UPLOAD_FOLDER
os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
##
def _a_array_dlib(imagen_pil: "Image.Image"):
    """Conversión única y segura para CUALQUIER llamada a face_recognition."""
    return np.ascontiguousarray(
        np.array(imagen_pil.convert("RGB"), dtype=np.uint8)
    )
##
def _base64_a_imagen_pil(data_url: str) -> Image.Image:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    datos_bytes = base64.b64decode(data_url)
    return Image.open(io.BytesIO(datos_bytes)).convert("RGB")


def _guardar_imagen_en_disco(imagen_pil: Image.Image, nombre_archivo: str) -> str:
    ruta_completa = os.path.join(Config.UPLOAD_FOLDER, nombre_archivo)
    imagen_pil.save(ruta_completa, "JPEG", quality=90)
    return os.path.join("uploads", nombre_archivo)


def _haar_region(imagen_pil: Image.Image):
    """Caja del rostro más grande (Haar frontal). None si no hay cara."""
    if not CV2_OK:
        return None
    imagen_grande = imagen_pil.resize((640, 480), Image.BILINEAR)
    gris = cv2.equalizeHist(np.array(imagen_grande.convert("L")))
    gris_espejo = cv2.flip(gris, 1)
    params = dict(scaleFactor=1.08, minNeighbors=3, minSize=(40, 40))
    dets = [
        cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml"),
        cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml"),
    ]
    mejor = None
    for det in dets:
        for img_g, espejo in ((gris, False), (gris_espejo, True)):
            caras = det.detectMultiScale(img_g, **params)
            if len(caras) == 0:
                continue
            x, y, w, h = sorted(caras, key=lambda c: c[2] * c[3], reverse=True)[0]
            if espejo:
                x = 640 - x - w
            area = w * h
            if mejor is None or area > mejor[0]:
                sx = imagen_pil.width / 640
                sy = imagen_pil.height / 480
                mejor = (area, int(x * sx), int(y * sy), int(w * sx), int(h * sy))
    if mejor is None:
        return None
    _, x, y, w, h = mejor
    return (x, y, w, h)


def _es_encoding_dlib(encoding) -> bool:
    """Los encodings de dlib tienen 128 floats y valores negativos."""
    try:
        a = np.array(encoding, dtype=np.float64)
    except Exception:
        return False
    if a.size != 128:
        return False
    return float(np.min(a)) < 0

##garantiza uint8 contiguo al final:
def _mejorar_imagen_para_deteccion(imagen_pil: "Image.Image") -> "Image.Image":
    """Sube brillo/contraste — ayuda a HOG y a Haar en fotos oscuras."""
    if not CV2_OK:
        return imagen_pil
    arr = np.array(imagen_pil.convert("RGB"), dtype=np.uint8)
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
    l = clahe.apply(l)
    mejorada = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2RGB)
    mejorada = np.ascontiguousarray(mejorada, dtype=np.uint8)   # ← clave
    return Image.fromarray(mejorada)

###
def _ubicaciones_face_recognition(imagen_np, imagen_pil):
    
    #Ubicaciones reales de face_recognition (HOG), con reintentos:
   #1. HOG normal.
   # 2. HOG con upsample (agranda la imagen internamente, ayuda con caras
      # pequeñas o poco definidas).
    #3. HOG sobre la imagen con brillo/contraste mejorado (CLAHE).
   # 4. Última red de seguridad: región de Haar como hint para
      # face_encodings (menos preciso, pero sigue siendo un encoding real
     #  de dlib, no inventado).


   # Prioriza la imagen con brillo/contraste mejorado (CLAHE), porque en
   # la práctica las capturas suelen venir oscuras. Si con eso no
   # encuentra nada, prueba la original como respaldo.
    

    imagen_mejorada = _mejorar_imagen_para_deteccion(imagen_pil)
    np_mejorada = np.ascontiguousarray(np.array(imagen_mejorada), dtype=np.uint8)

    locs = face_recognition.face_locations(
        np_mejorada, model="hog", number_of_times_to_upsample=2
    )
    if locs:
        return locs, np_mejorada

    locs = face_recognition.face_locations(imagen_np, model="hog")
    if locs:
        return locs, imagen_np

    region = _haar_region(imagen_mejorada)
    if region:
        x, y, w, h = region
        pad = int(min(w, h) * 0.2)
        return [(max(0, y - pad), x + w + pad, y + h + pad, max(0, x - pad))], np_mejorada

    return [], imagen_np


def _obtener_encoding_real(imagen_pil: "Image.Image"):
    """
    Encoding de 128 dimensiones de face_recognition, o None.
    """
    if not USAR_FACE_RECOGNITION:
        return None

    imagen_np = _a_array_dlib(imagen_pil)   # ← se define aquí, ANTES de cualquier uso

    try:
        locs, imagen_para_encoding = _ubicaciones_face_recognition(imagen_np, imagen_pil)
        print(f"[DEBUG] tamaño imagen: {imagen_pil.size}, ubicaciones encontradas: {locs}")

        if not locs:
            return None

        imagen_para_encoding = np.ascontiguousarray(imagen_para_encoding, dtype=np.uint8)
        print(f"[DEBUG SHAPE] shape={imagen_para_encoding.shape}, dtype={imagen_para_encoding.dtype}, locs={locs}")

        encodings = face_recognition.face_encodings(imagen_para_encoding, locs, num_jitters=1)
        if not encodings:
            print("[DEBUG] hubo ubicación pero face_encodings no generó vector")
            return None

        return encodings[0].tolist()

    except Exception as e:
        print(f"[DEBUG] EXCEPCIÓN real: {e}")
        return None
    ###cualquier excepción interna de face_recognition se está tragando en silencio (except Exception: return None), así que si sigue sin funcionar después del cambio de arriba, no tenemos forma de ver por qué. Agrega esto en _obtener_encoding_real:
###fuerza el mismo formato justo antes de llamar a face_encodings (por si el array que llega desde _ubicaciones_face_recognition no quedó perfectamente limpio):
def _comparar_encodings(encoding_captura: list, registros: list):
    """
    Mejor coincidencia por colaborador (min distancia entre sus 3 fotos).
    Ignora encodings viejos de OpenCV (sin valores negativos).
    Umbral + margen respecto a la 2.ª persona para no marcar impostores.
    """
    if not registros or not _es_encoding_dlib(encoding_captura):
        return None, 0.0

    enc_cap = np.array(encoding_captura, dtype=np.float64)
    umbral = Config.FACE_DISTANCE_THRESHOLD
    por_persona = {}

    for reg in registros:
        if not _es_encoding_dlib(reg.get("encoding")):
            continue
        enc_bd = np.array(reg["encoding"], dtype=np.float64)
        if enc_bd.size != 128:
            continue
        distancia = float(np.linalg.norm(enc_bd - enc_cap))
        cid = reg["id_colaborador"]
        if cid not in por_persona or distancia < por_persona[cid]["dist"]:
            por_persona[cid] = {
                "id_colaborador": cid,
                "nombres": reg["nombres"],
                "apellidos": reg["apellidos"],
                "dist": distancia,
            }

    if not por_persona:
        return None, 0.0

    orden = sorted(por_persona.values(), key=lambda x: x["dist"])
    mejor = orden[0]
    if mejor["dist"] > umbral:
        return None, max(0.0, (1.0 - mejor["dist"]) * 100.0)

    if len(orden) > 1:
        segundo = orden[1]
        if (segundo["dist"] - mejor["dist"]) < 0.08 and segundo["dist"] <= umbral + 0.06:
            return None, max(0.0, (1.0 - mejor["dist"]) * 100.0)

    confianza = max(0.0, (1.0 - mejor["dist"]) * 100.0)
    return mejor, confianza


def _mae_pose(imagen_a: Image.Image, imagen_b: Image.Image) -> float:
    if not CV2_OK:
        return 999.0

    def prep(im):
        g = np.array(im.convert("L").resize((64, 48), Image.BILINEAR), dtype=np.uint8)
        g = cv2.equalizeHist(g)
        return g[8:40, 10:54].astype(np.float32)

    return float(np.mean(np.abs(prep(imagen_a) - prep(imagen_b))))


def _detectar_direccion_giro(imagen_pil: Image.Image) -> str:
    """
    'frente' | 'izquierda' | 'derecha' | 'ninguno'
    Exige un giro claramente notorio (vista 3/4, no perfil completo
    pero definitivamente NO frontal).
    """
    if not USAR_FACE_RECOGNITION:
        return "ninguno"
    try:
        imagen_np = _a_array_dlib(imagen_pil)
        locs = face_recognition.face_locations(imagen_np, model="hog")
        if not locs:
            return "ninguno"

        # CRÍTICO: si hay varias detecciones (falsos positivos del fondo),
        # quedarnos SOLO con la más grande — esa es la cara real de la
        # persona frente a la cámara, no ruido del patrón de la pared.
        def area(loc):
            top, right, bottom, left = loc
            return (bottom - top) * (right - left)

        locs_ordenadas = sorted(locs, key=area, reverse=True)
        rostro_principal = [locs_ordenadas[0]]

        # Filtro de sanidad: si la "cara" más grande es minúscula
        # respecto al frame, probablemente sigue siendo ruido — rechazar.
        top, right, bottom, left = rostro_principal[0]
        alto_cara = bottom - top
        alto_imagen = imagen_np.shape[0]
        if alto_cara < alto_imagen * 0.15:
            return "ninguno"

        lista = face_recognition.face_landmarks(imagen_np, rostro_principal)
        if not lista:
            return "ninguno"
        lm = lista[0]

        chin = lm.get("chin", [])
        nose_pts = lm.get("nose_tip") or lm.get("nose_bridge") or []
        if not chin or not nose_pts:
            return "ninguno"

        chin_xs = [p[0] for p in chin]
        left_edge, right_edge = min(chin_xs), max(chin_xs)
        face_width = right_edge - left_edge
        if face_width <= 0:
            return "ninguno"

        nose_x = sum(p[0] for p in nose_pts) / len(nose_pts)
        centro = (left_edge + right_edge) / 2
        offset = (nose_x - centro) / face_width

        # ========== NUEVA LÓGICA CON UMBRALES ASIMÉTRICOS Y DEBUG ==========
        # Umbrales calibrados para el rostro de la usuaria
        # Si tu rostro es diferente, ajusta estos valores
        UMBRAL = 0.20
        print(f"[DEBUG GIRO] offset={offset:.3f}")
        if abs(offset) < UMBRAL:
            return "frente"
        return "derecha" if offset > 0 else "izquierda"
        
        # ==================================================================

    except Exception:
        return "ninguno"

##
def _hay_rostro_vivo(imagen_pil: "Image.Image") -> bool:
    if USAR_FACE_RECOGNITION:
        try:
            locs, _ = _ubicaciones_face_recognition(_a_array_dlib(imagen_pil), imagen_pil) ##cambioultimo
            if locs:
                return True
        except Exception:
            pass
    return _haar_region(imagen_pil) is not None

# ─────────────────────────────────────────────────────────
# PÁGINAS
# ─────────────────────────────────────────────────────────

@app.route("/")
def pantalla_registro():
    return render_template("index.html")


@app.route("/asistencia")
def pantalla_asistencia():
    return render_template("asistencia.html")


@app.route("/api/salud")
def api_salud():
    resultado = probar_conexion()
    resultado["motor"] = "face_recognition" if USAR_FACE_RECOGNITION else "no_disponible"
    codigo = 200 if resultado["ok"] else 500
    return jsonify(resultado), codigo


@app.route("/api/colaboradores")
def api_colaboradores():
    try:
        colaboradores = listar_colaboradores()
        return jsonify({"ok": True, "colaboradores": colaboradores})
    except Exception as e:
        return jsonify({"ok": False, "mensaje": str(e)}), 500


@app.route("/api/registro/estado/<int:id_colaborador>")
def api_estado_registro(id_colaborador):
    try:
        tiene = tiene_registro_activo(id_colaborador)
        return jsonify({"ok": True, "tiene_registro": tiene})
    except Exception as e:
        return jsonify({"ok": False, "mensaje": str(e)}), 500


@app.route("/api/registro/guardar", methods=["POST"])
def api_guardar_registro():
    """
    Genera encodings REALES con face_recognition.
    FRONTAL es obligatorio. Laterales: si HOG no puede, se reutiliza
    el encoding frontal (misma persona, vector válido).
    
    Ahora acepta encodings pre-validados desde el Paso 2 (vivo),
    priorizándolos sobre recalcular en backend.
    """
    if not DEPS_OK:
        return jsonify({"ok": False, "mensaje": _DEPS_ERROR}), 503
    
    if not USAR_FACE_RECOGNITION:
        return jsonify({
            "ok": False,
            "mensaje": (
                "face_recognition no está instalado. "
                "Sin él no se pueden distinguir personas. "
                "Usa Python 3.11 y: pip install face_recognition"
            ),
        }), 503

    datos = request.get_json(force=True)
    id_colaborador = datos.get("id_colaborador")
    reemplazar = datos.get("reemplazar", False)
    fotos = datos.get("fotos", {})

    if not id_colaborador:
        return jsonify({"ok": False, "mensaje": "Falta id_colaborador."}), 400

    tipos_requeridos = ["FRONTAL", "LATERAL_IZQUIERDA", "LATERAL_DERECHA"]
    for tipo in tipos_requeridos:
        if tipo not in fotos or not fotos[tipo]:
            return jsonify({"ok": False, "mensaje": f"Falta la foto {tipo}."}), 400

    # ⬇️ INICIO DEL BLOQUE CON INDENTACIÓN CORRECTA (nivel del método)
    encoding_frontal = None
    resultados = []
    primera_foto = True

    for tipo in tipos_requeridos:
        try:
            # Obtener el dato de la foto (puede ser string o dict)
            foto_entry = fotos[tipo]
            
            # Acepta tanto {"url":..., "encoding":...} como string plano
            if isinstance(foto_entry, dict):
                foto_b64 = foto_entry.get("url", "")
                encoding_enviado = foto_entry.get("encoding")
            else:
                foto_b64 = foto_entry
                encoding_enviado = None

            imagen_pil = _base64_a_imagen_pil(foto_b64)

            # Prioridad 1: encoding YA validado en vivo (Paso 2)
            if encoding_enviado and _es_encoding_dlib(encoding_enviado):
                encoding = encoding_enviado
            else:
                # Respaldo: recalcular (no debería hacer falta si el flujo normal se siguió)
                encoding = _obtener_encoding_real(imagen_pil)

            if tipo == "FRONTAL":
                if encoding is None or not _es_encoding_dlib(encoding):
                    return jsonify({
                        "ok": False,
                        "mensaje": (
                            "No se pudo leer el rostro FRONTAL para el perfil. "
                            "Retoma esa foto de frente, con buena luz y el rostro centrado."
                        ),
                    }), 422
                encoding_frontal = encoding
            else:
                if encoding is None or not _es_encoding_dlib(encoding):
                    encoding = encoding_frontal

            nombre_archivo = f"{id_colaborador}_{tipo}_{uuid.uuid4().hex[:8]}.jpg"
            ruta = _guardar_imagen_en_disco(imagen_pil, nombre_archivo)
            guardar_registro_facial(
                id_colaborador=id_colaborador,
                tipo_captura=tipo,
                ruta_imagen=ruta,
                encoding_facial=encoding,
                reemplazar=(reemplazar and primera_foto),
            )
            primera_foto = False
            resultados.append({"tipo": tipo, "ok": True})
            
        except Exception as e:
            return jsonify({
                "ok": False,
                "mensaje": f"Error al procesar {tipo}: {str(e)}",
            }), 500

    return jsonify({
        "ok": True,
        "mensaje": "Registro facial guardado correctamente.",
        "motor": "face_recognition",
        "capturas": resultados,
    })


@app.route("/api/reconocer", methods=["POST"])
def api_reconocer():
    if not DEPS_OK:
        return jsonify({"ok": False, "mensaje": _DEPS_ERROR}), 503
    if not USAR_FACE_RECOGNITION:
        return jsonify({
            "ok": False,
            "mensaje": "face_recognition no está instalado; no se puede reconocer identidad.",
        }), 503

    datos = request.get_json(force=True)
    foto_b64 = datos.get("foto")
    if not foto_b64:
        return jsonify({"ok": False, "mensaje": "No se recibió ninguna foto."}), 400

    try:
        imagen_pil = _base64_a_imagen_pil(foto_b64)
        encoding_captura = _obtener_encoding_real(imagen_pil)
        if encoding_captura is None or not _es_encoding_dlib(encoding_captura):
            return jsonify({
                "ok": True,
                "reconocido": False,
                "mensaje": (
                    "No se detectó un rostro válido. "
                    "Mira de frente a la cámara con buena iluminación."
                ),
            })

        registros = obtener_encodings_activos()
        if not registros:
            return jsonify({
                "ok": True,
                "reconocido": False,
                "mensaje": "No hay colaboradores con registro facial activo.",
            })

        colab, confianza = _comparar_encodings(encoding_captura, registros)
        if colab is None:
            return jsonify({
                "ok": True,
                "reconocido": False,
                "mensaje": "Persona no reconocida — no fue posible validar la identidad.",
            })

        id_colaborador = colab["id_colaborador"]
        nombre_completo = f"{colab['nombres']} {colab['apellidos']}"
        ya_hoy = ya_registro_hoy(id_colaborador)
        if not ya_hoy:
            registrar_asistencia(id_colaborador, confianza)

        return jsonify({
            "ok": True,
            "reconocido": True,
            "nombre": nombre_completo,
            "hora": datetime.now().strftime("%H:%M:%S"),
            "ya_registrado_hoy": ya_hoy,
            "nivel_confianza": round(confianza, 1),
            "motor": "face_recognition",
        })
    except Exception as e:
        return jsonify({"ok": False, "mensaje": f"Error interno: {str(e)}"}), 500


@app.route("/api/validar-rostro", methods=["POST"])
def api_validar_rostro():
    if not DEPS_OK:
        return jsonify({"ok": True, "tiene_rostro": True, "motivo": "validacion_omitida"})

    datos = request.get_json(force=True)
    foto_b64 = datos.get("foto", "")
    tipo = datos.get("tipo", "FRONTAL")
    ref_b64 = datos.get("referencia", "")
    exigir_encoding = datos.get("exigir_encoding", False)

    if not foto_b64:
        return jsonify({"ok": False, "tiene_rostro": False, "motivo": "Sin imagen"})

    try:
        imagen_pil = _base64_a_imagen_pil(foto_b64)

        if not _hay_rostro_vivo(imagen_pil):
            return jsonify({"ok": True, "tiene_rostro": False, "motivo": "Centra tu rostro en el marco"})

        if tipo == "FRONTAL":
            # NUEVO: rechazar si claramente está girada, para que un
            # reinicio del wizard no acepte una pose lateral como frontal.
            direccion = _detectar_direccion_giro(imagen_pil)
            if direccion in ("izquierda", "derecha"):
                return jsonify({
                    "ok": True,
                    "tiene_rostro": False,
                    "motivo": "Colócate mirando de frente a la cámara",
                })

        if tipo in ("LATERAL_IZQUIERDA", "LATERAL_DERECHA"):
            requerida = "izquierda" if tipo == "LATERAL_IZQUIERDA" else "derecha"
            detectada = _detectar_direccion_giro(imagen_pil)

            if detectada == ("derecha" if requerida == "izquierda" else "izquierda"):
                return jsonify({"ok": True, "tiene_rostro": False, "motivo": "Estás girando al lado contrario"})
            if detectada != requerida:
                msg = "Gira más la cabeza hacia tu izquierda" if tipo == "LATERAL_IZQUIERDA" else "Gira más la cabeza hacia tu derecha"
                return jsonify({"ok": True, "tiene_rostro": False, "motivo": msg})

            if ref_b64:
                try:
                    dif = _mae_pose(imagen_pil, _base64_a_imagen_pil(ref_b64))
                    if dif < 14:
                        msg = "Gira más la cabeza hacia tu izquierda" if tipo == "LATERAL_IZQUIERDA" else "Gira más la cabeza hacia tu derecha"
                        return jsonify({"ok": True, "tiene_rostro": False, "motivo": msg})
                except Exception:
                    pass

        if not exigir_encoding:
            return jsonify({"ok": True, "tiene_rostro": True, "motivo": f"{tipo.lower()}_pose_ok"})

        encoding = _obtener_encoding_real(imagen_pil)
        if encoding is None or not _es_encoding_dlib(encoding):
            return jsonify({
                "ok": True,
                "tiene_rostro": False,
                "motivo": "No se pudo generar el identificador facial. Mantén la posición un momento más.",
            })

        return jsonify({"ok": True, "tiene_rostro": True, "motivo": f"{tipo.lower()}_ok", "encoding": encoding})

    except Exception as e:
        return jsonify({"ok": True, "tiene_rostro": False, "motivo": str(e)})

if __name__ == "__main__":
    modo = "face_recognition" if USAR_FACE_RECOGNITION else "NO INSTALADO — el reconocimiento no distinguirá personas"
    print(f"  Motor de reconocimiento: {modo}")
    print(f"  Accede desde la tablet en:  http://<IP-de-tu-laptop>:{Config.FLASK_PORT}")
    #app.run(host="0.0.0.0", port=Config.FLASK_PORT, debug=True)

    #obliga al servidor a atender una petición a la vez
    app.run(host="0.0.0.0", port=Config.FLASK_PORT, debug=True, threaded=False, use_reloader=True)