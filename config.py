"""
config.py
---------
Lee la configuración de MySQL y de la app desde el archivo .env.
Nunca pongas tu contraseña directamente aquí; usa el .env.
"""

import os
from dotenv import load_dotenv

# Carga las variables del archivo .env al entorno de Python
load_dotenv()


def _requerido(nombre: str) -> str:
    """Devuelve el valor de la variable de entorno o lanza error si falta."""
    valor = os.getenv(nombre, "").strip()
    if not valor:
        raise RuntimeError(
            f"Falta la variable '{nombre}' en el archivo .env. "
            "Copia .env.example a .env y completa tus datos."
        )
    return valor


class Config:
    """Toda la configuración centralizada en un solo lugar."""

    # --- MySQL ---
    MYSQL_HOST     = os.getenv("MYSQL_HOST", "localhost")
    MYSQL_PORT     = int(os.getenv("MYSQL_PORT", "3306"))
    MYSQL_USER     = _requerido("MYSQL_USER")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
    MYSQL_DATABASE = _requerido("MYSQL_DATABASE")

    # --- Carpeta donde se guardan las fotos de los colaboradores ---
    UPLOAD_FOLDER = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "uploads"
    )

    # --- Flask ---
    SECRET_KEY = os.getenv("SECRET_KEY", "cambiar-en-produccion")
    FLASK_PORT  = int(os.getenv("FLASK_PORT", "5000"))

    # Distancia dlib: 0 = misma cara, ~0.6 = personas distintas.
    # 0.5 es el equilibrio habitual de face_recognition.
    FACE_DISTANCE_THRESHOLD = float(os.getenv("FACE_DISTANCE_THRESHOLD", "0.50"))
