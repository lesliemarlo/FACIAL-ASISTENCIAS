"""
db.py
-----
Maneja TODA la comunicación con MySQL.

Principio: cada función abre su propia conexión, hace su trabajo
y la cierra. Así no dejamos conexiones colgadas.

Tablas que usamos (ya existen en tu BD):
  - colaboradores
  - registro_facial
  - asistencia
"""

import json
from datetime import date, datetime

import mysql.connector
from mysql.connector import Error

from config import Config


# ─────────────────────────────────────────────
# Utilidad interna: abrir conexión
# ─────────────────────────────────────────────

def get_connection():
    """Crea y devuelve una conexión nueva a MySQL."""
    return mysql.connector.connect(
        host=Config.MYSQL_HOST,
        port=Config.MYSQL_PORT,
        user=Config.MYSQL_USER,
        password=Config.MYSQL_PASSWORD,
        database=Config.MYSQL_DATABASE,
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
        autocommit=False,   # manejamos las transacciones a mano
    )


# ─────────────────────────────────────────────
# Diagnóstico
# ─────────────────────────────────────────────

def probar_conexion():
    """
    Intenta abrir la conexión y ejecutar SELECT 1.
    Devuelve dict con ok=True/False y un mensaje legible.
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        return {
            "ok": True,
            "mensaje": "Conexión a MySQL correcta.",
            "host": Config.MYSQL_HOST,
            "base": Config.MYSQL_DATABASE,
        }
    except Error as e:
        return {"ok": False, "mensaje": f"Error MySQL: {e}"}
    except Exception as e:
        return {"ok": False, "mensaje": str(e)}
    finally:
        if conn and conn.is_connected():
            conn.close()


# ─────────────────────────────────────────────
# COLABORADORES
# ─────────────────────────────────────────────

def listar_colaboradores():
    """
    Devuelve todos los colaboradores ACTIVOS como lista de dicts.
    Se usa para llenar el selector en la Pantalla A.
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor(dictionary=True)   # dictionary=True → devuelve dicts
        cur.execute(
            """
            SELECT id_colaborador,
                   codigo_colaborador,
                   nombres,
                   apellidos,
                   area
            FROM   colaboradores
            WHERE  estado = 'ACTIVO'
            ORDER  BY apellidos, nombres
            """
        )
        filas = cur.fetchall()
        cur.close()
        return filas
    finally:
        if conn and conn.is_connected():
            conn.close()


def obtener_colaborador(id_colaborador: int):
    """Devuelve un colaborador por su PK, o None si no existe."""
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id_colaborador, codigo_colaborador,
                   nombres, apellidos, area
            FROM   colaboradores
            WHERE  id_colaborador = %s
            """,
            (id_colaborador,),
        )
        fila = cur.fetchone()
        cur.close()
        return fila
    finally:
        if conn and conn.is_connected():
            conn.close()


# ─────────────────────────────────────────────
# REGISTRO FACIAL
# ─────────────────────────────────────────────

def tiene_registro_activo(id_colaborador: int) -> bool:
    """
    Devuelve True si el colaborador ya tiene las 3 capturas ACTIVAS.
    Se usa para preguntar si quiere reemplazarlas.
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(*) FROM registro_facial
            WHERE  id_colaborador = %s AND estado = 'ACTIVO'
            """,
            (id_colaborador,),
        )
        conteo = cur.fetchone()[0]
        cur.close()
        return conteo > 0
    finally:
        if conn and conn.is_connected():
            conn.close()


def marcar_registros_como_reemplazados(id_colaborador: int, conn, cur):
    """
    Marca todos los registros ACTIVOS del colaborador como REEMPLAZADO.
    Recibe la conexión abierta (para que sea parte de la misma transacción).
    """
    cur.execute(
        """
        UPDATE registro_facial
        SET    estado = 'REEMPLAZADO'
        WHERE  id_colaborador = %s AND estado = 'ACTIVO'
        """,
        (id_colaborador,),
    )


def guardar_registro_facial(
    id_colaborador: int,
    tipo_captura: str,
    ruta_imagen: str,
    encoding_facial: list,
    reemplazar: bool = False,
):
    """
    Guarda una captura facial en la BD.

    Parámetros:
      id_colaborador  : PK del colaborador
      tipo_captura    : 'FRONTAL' | 'LATERAL_IZQUIERDA' | 'LATERAL_DERECHA'
      ruta_imagen     : path relativo al archivo guardado en /uploads
      encoding_facial : lista de 128 floats que devuelve face_recognition
      reemplazar      : si True, primero marca los activos como REEMPLAZADO
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        if reemplazar:
            # Solo reemplazamos en la primera llamada (FRONTAL)
            # para no hacer UPDATE por cada captura
            marcar_registros_como_reemplazados(id_colaborador, conn, cur)

        encoding_json = json.dumps(encoding_facial)   # guarda el vector como texto JSON

        cur.execute(
            """
            INSERT INTO registro_facial
                (id_colaborador, tipo_captura, ruta_imagen, encoding_facial, estado)
            VALUES
                (%s, %s, %s, %s, 'ACTIVO')
            """,
            (id_colaborador, tipo_captura, ruta_imagen, encoding_json),
        )
        conn.commit()
        cur.close()
        return cur.lastrowid
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn and conn.is_connected():
            conn.close()


def obtener_encodings_activos():
    """
    Carga todos los encodings ACTIVOS para comparar en el reconocimiento.
    Devuelve lista de dicts:
      { id_colaborador, nombres, apellidos, encoding (lista de floats) }
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT rf.id_colaborador,
                   c.nombres,
                   c.apellidos,
                   rf.encoding_facial
            FROM   registro_facial rf
            JOIN   colaboradores   c  ON c.id_colaborador = rf.id_colaborador
            WHERE  rf.estado = 'ACTIVO'
              AND  c.estado  = 'ACTIVO'
            """
        )
        filas = cur.fetchall()
        cur.close()

        # Convertimos el JSON guardado de vuelta a lista de floats
        for fila in filas:
            fila["encoding"] = json.loads(fila["encoding_facial"])
            del fila["encoding_facial"]

        return filas
    finally:
        if conn and conn.is_connected():
            conn.close()


# ─────────────────────────────────────────────
# ASISTENCIA
# ─────────────────────────────────────────────

def ya_registro_hoy(id_colaborador: int) -> bool:
    """Devuelve True si el colaborador ya tiene asistencia registrada hoy."""
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(*) FROM asistencia
            WHERE  id_colaborador = %s AND fecha = %s
            """,
            (id_colaborador, date.today()),
        )
        conteo = cur.fetchone()[0]
        cur.close()
        return conteo > 0
    finally:
        if conn and conn.is_connected():
            conn.close()


def registrar_asistencia(id_colaborador: int, nivel_confianza: float):
    """
    Inserta una fila en asistencia con fecha y hora actuales.
    Si ya existe registro hoy (UNIQUE KEY), devuelve False en lugar de explotar.
    """
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        ahora = datetime.now()
        cur.execute(
            """
            INSERT INTO asistencia (id_colaborador, fecha, hora, nivel_confianza)
            VALUES (%s, %s, %s, %s)
            """,
            (
                id_colaborador,
                ahora.date(),
                ahora.strftime("%H:%M:%S"),
                round(nivel_confianza, 2),
            ),
        )
        conn.commit()
        cur.close()
        return True
    except mysql.connector.IntegrityError:
        # Viola el UNIQUE KEY uq_colab_fecha → ya existe hoy
        return False
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn and conn.is_connected():
            conn.close()
