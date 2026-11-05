# LESLIE — Módulo de Reconocimiento Facial y Validación de Asistencia

Módulo web para registrar el perfil facial de un colaborador (3 ángulos) y validar su identidad en tiempo real para registrar su asistencia diaria mediante reconocimiento facial.

> 📄 **Documentación fuente (PDF):** [LINK DE GOOGLE DRIVE PDF](https://drive.google.com/file/d/1Yl_YuAUotgnfmPIPFO8mPpzoeN47k6FD/view?usp=sharing)

---

## Tabla de contenidos

1. [Descripción general](#1-descripción-general)
2. [Arquitectura](#2-arquitectura)
3. [Tecnologías y versiones](#3-tecnologías-y-versiones)
4. [Modelo de datos](#4-modelo-de-datos)
5. [Flujo: Registro facial](#5-flujo-registro-facial)
6. [Flujo: Registro de asistencia](#6-flujo-registro-de-asistencia)
7. [Reglas de validación](#7-reglas-de-validación)
8. [Instalación y configuración](#8-instalación-y-configuración)
9. [Ejecución y acceso desde tablet (ngrok)](#9-ejecución-y-acceso-desde-tablet-ngrok)
10. [Solución de problemas conocidos](#10-solución-de-problemas-conocidos)
11. [Matriz de pruebas funcionales](#11-matriz-de-pruebas-funcionales)
12. [Consulta SQL de asistencias](#12-consulta-sql-de-asistencias)
13. [Evidencias](#13-evidencias)

---

## 1. Descripción general

El sistema cuenta con **dos pantallas independientes**:

| Pantalla | Función |
|---|---|
| **Registro Facial** | Selecciona un colaborador existente y captura su perfil facial en tres ángulos (frontal, lateral izquierda, lateral derecha), con validación automática en vivo antes de aceptar cada foto. |
| **Registro de Asistencia** | Compara el rostro frente a la cámara contra los perfiles faciales activos y registra la asistencia **solo si** la identidad es confirmada. |

---

## 2. Arquitectura

```
Interfaz (HTML + JavaScript, cámara vía getUserMedia)
        ↓
Rutas API de Flask (/api/...)
        ↓
Módulo de reconocimiento facial (Python + face_recognition)
        ↓
Procesamiento / validación
  - Detección de rostro (HOG, face_recognition)
  - Validación de ángulo (landmarks faciales)
  - Generación de encoding de 128 dimensiones
        ↓
Capa de acceso a datos (db.py — mysql-connector-python)
        ↓
MySQL (base de datos asistencia_facial)
        ↓
Registro de asistencia
```

El frontend **nunca** accede directamente a la base de datos: toda comunicación pasa por rutas API de Flask, que delegan en `db.py` para cualquier operación con MySQL.

---

## 3. Tecnologías y versiones

| Componente | Tecnología | Versión |
|---|---|---|
| Lenguaje | Python | 3.11 |
| Framework web | Flask | 3.0.3 |
| Reconocimiento facial | face_recognition (dlib) | 1.3.0 |
| Procesamiento de imágenes | OpenCV | 4.10.0 |
| Manejo de imágenes | Pillow | 10.4.0 |
| Cálculo numérico | NumPy | 1.26.4 (serie 1.x, requerido por compatibilidad con dlib) |
| Base de datos | MySQL | 8.x |
| Conector de BD | mysql-connector-python | 9.1.0 |
| Frontend | HTML5 + CSS3 + JavaScript (vanilla) | — |
| Acceso a cámara | Web API `getUserMedia` | Estándar W3C |

**Dependencias de sistema (Windows):** CMake y Visual Studio Build Tools (componente *Desarrollo para escritorio con C++*), requeridos para compilar dlib.

---

## 4. Modelo de datos

Base de datos: `asistencia_facial`

### Tabla `colaboradores`

| Campo | Tipo | Long. | Oblig. | Clave |
|---|---|---|---|---|
| id_colaborador | INT | — | Sí | PK |
| codigo_colaborador | VARCHAR | 20 | Sí | UNIQUE |
| nombres | VARCHAR | 100 | Sí | — |
| apellidos | VARCHAR | 100 | Sí | — |
| dni | VARCHAR | 20 | Sí | UNIQUE |
| area | VARCHAR | 80 | No | — |
| estado | ENUM('ACTIVO','INACTIVO') | — | Sí | — |
| fecha_registro | DATETIME | — | Sí (auto) | — |

### Tabla `registro_facial`

| Campo | Tipo | Long. | Oblig. | Clave | Notas |
|---|---|---|---|---|---|
| id_registro_facial | INT | — | Sí | PK | — |
| id_colaborador | INT | — | Sí | FK → colaboradores.id_colaborador | — |
| tipo_captura | ENUM('FRONTAL','LATERAL_IZQUIERDA','LATERAL_DERECHA') | — | Sí | — | — |
| ruta_imagen | VARCHAR | 255 | Sí | — | Ruta de la imagen en `uploads/` |
| encoding_facial | TEXT | — | Sí | — | Vector de 128 dimensiones (JSON) generado por face_recognition |
| fecha_registro | DATETIME | — | Sí (auto) | — | — |
| fecha_actualizacion | DATETIME | — | No | — | — |
| estado | ENUM('ACTIVO','REEMPLAZADO') | — | Sí | — | — |

**Restricción:** `UNIQUE(id_colaborador, tipo_captura, estado)` — evita duplicidad de capturas activas del mismo tipo para un colaborador.

### Tabla `asistencia`

| Campo | Tipo | Long. | Oblig. | Clave | Notas |
|---|---|---|---|---|---|
| id_asistencia | INT | — | Sí | PK | — |
| id_colaborador | INT | — | Sí | FK → colaboradores.id_colaborador | — |
| fecha | DATE | — | Sí | — | — |
| hora | TIME | — | Sí | — | — |
| nivel_confianza | DECIMAL | 5,2 | Sí | — | Porcentaje de coincidencia del reconocimiento |
| fecha_registro | DATETIME | — | Sí (auto) | — | — |

**Restricción:** `UNIQUE(id_colaborador, fecha)` — evita más de una asistencia por colaborador en el mismo día.

> **Justificación de diseño:** se usa una tabla `asistencia` propia y minimalista en lugar de `detalle_tareo`, porque este módulo se entrega de forma independiente al proyecto integrador (cuyas tablas `periodos` y `quincenas` aún no están disponibles). `id_colaborador` apunta a la misma tabla `colaboradores` del modelo general y `fecha`/`hora` equivalen a los campos de `detalle_tareo`, por lo que la integración futura solo requiere un mapeo de columnas.

---

## 5. Flujo: Registro facial

1. El usuario busca y selecciona un colaborador existente.
2. El sistema verifica si ya tiene un registro facial activo; si es así, pide confirmación para reemplazarlo.
3. Se activa la cámara y el sistema guía paso a paso:
   - **Frontal:** mirar directo a la cámara; el rostro se detecta y captura automáticamente.
   - **Lateral izquierda / derecha:** girar la cabeza hacia el lado indicado; el ángulo se valida con landmarks faciales (posición de la nariz respecto al ancho del rostro).
4. Cada captura pasa por validación en vivo (rostro + ángulo correcto). Si no es válida, el sistema indica qué corregir y reintenta automáticamente.
5. Con las 3 capturas completas se muestra una vista previa para confirmación visual.
6. Al guardar, se genera el encoding facial (128 dimensiones) de cada foto y se almacena en `registro_facial`.
7. El sistema confirma el registro exitoso.

---

## 6. Flujo: Registro de asistencia

1. El usuario activa la cámara en la pantalla de Asistencia.
2. El sistema detecta un rostro automáticamente.
3. Se genera el encoding facial de 128 dimensiones de la captura.
4. Se compara contra todos los encodings activos en la BD, calculando la distancia entre vectores.
5. **Si hay coincidencia** dentro del umbral (y con margen suficiente respecto a la segunda mejor coincidencia, para evitar falsos positivos entre personas parecidas):
   - Se identifica al colaborador.
   - Se verifica que no tenga asistencia registrada ese día.
   - Se registra la asistencia con fecha, hora y nivel de confianza.
   - Se muestra nombre, hora, nivel de confianza y confirmación.
6. **Si no hay coincidencia válida:** se muestra *"Persona no reconocida — no fue posible validar la identidad."* y no se registra asistencia.

---

## 7. Reglas de validación

### Registro facial
- El colaborador debe existir y estar activo.
- Debe seleccionarse un colaborador válido antes de continuar.
- Las 3 capturas son obligatorias; no se puede guardar si falta alguna.
- Cada captura valida presencia de rostro y, en laterales, un giro real (mínimo ~40–45°).
- Si ya existe un registro activo, se solicita confirmación explícita para reemplazarlo (las capturas anteriores pasan a `REEMPLAZADO`, **no se eliminan**).

### Reconocimiento y asistencia
- Debe existir al menos un registro facial activo para poder comparar.
- Debe detectarse un rostro válido antes de procesar.
- El encoding debe generarse correctamente (128 dimensiones, vector de dlib).
- Debe haber coincidencia suficiente (umbral de distancia configurable) y margen claro frente a la segunda mejor coincidencia.
- Sin coincidencia válida, no se registra asistencia.
- Control de duplicidad: un solo registro por colaborador por día (restricción `UNIQUE` en BD + verificación previa en la aplicación).

---

## 8. Instalación y configuración

### Requisitos previos
- Python **3.11** (no compatible con 3.13)
- MySQL 8.x
- CMake
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/es/visual-cpp-build-tools/) (componente *Desarrollo para el escritorio con C++*)
- ngrok (para acceso desde tablet)

> **Por qué Python 3.11:** `face_recognition` depende de `dlib` (C++ que requiere compilación). Los wheels precompilados para Windows corresponden a Python 3.11 (cp311); en 3.13 la instalación falla con `ModuleNotFoundError: No module named '_dlib_pybind11'`.

### Paso 1 — Base de datos
Ejecutar en MySQL Workbench el script SQL completo que crea las tablas `colaboradores`, `registro_facial` y `asistencia` (ver [sección 4](#4-modelo-de-datos)).

### Paso 2 — Entorno virtual

```powershell
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
```

Si aparece un error de permisos:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Paso 3 — Dependencias base

```powershell
pip install -r requirements.txt
```

### Paso 4 — dlib y face_recognition (manual, no incluido en `requirements.txt`)

```powershell
pip install cmake
pip install https://github.com/z-mahmud22/Dlib_Windows_Python3.x/raw/main/dlib-19.24.1-cp311-cp311-win_amd64.whl
pip install face_recognition==1.3.0
```

Verificar:

```powershell
python -c "import face_recognition; print('OK')"
```

### Paso 5 — Archivo `.env` (raíz del proyecto, junto a `app.py`)

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=tu_contraseña_real_de_mysql
MYSQL_DATABASE=asistencia_facial
FLASK_PORT=5000
FACE_DISTANCE_THRESHOLD=0.45
```

> ⚠️ No subas el archivo `.env` al repositorio (agrégalo a `.gitignore`).

---

## 9. Ejecución y acceso desde tablet (ngrok)

El sistema corre en modo local, sin servidor en la nube:

```powershell
python app.py
```

Acceso desde la misma laptop: **http://localhost:5000**

Para usarlo desde una tablet de 11", el navegador exige **HTTPS** para acceder a la cámara. ngrok lo resuelve sin configurar certificados:

1. Crear cuenta gratuita en [ngrok.com](https://ngrok.com) y descargar el ejecutable para Windows.
2. Configurar el token (una sola vez):
   ```powershell
   ngrok config add-authtoken TU_TOKEN
   ```
3. Con `python app.py` corriendo, abrir una segunda terminal:
   ```powershell
   ngrok http 5000
   ```
4. ngrok genera una URL pública HTTPS (ej. `https://abc123.ngrok-free.app`) que redirige al servidor local.
5. Abrir esa URL en el navegador de la tablet; la cámara funciona sin advertencias.

> **Recuerda:** la URL gratuita de ngrok cambia cada vez que se reinicia el túnel. Si cierras la terminal de ngrok, debes generar una nueva URL y volver a abrirla en la tablet.

---

## 10. Solución de problemas conocidos

| Problema | Causa | Solución |
|---|---|---|
| `ModuleNotFoundError: No module named '_dlib_pybind11'` | El venv usa Python 3.13 en vez de 3.11 | Recrear el venv con `py -3.11 -m venv venv` |
| `Unsupported image type, must be 8bit gray or RGB image` | NumPy 2.x instalado (incompatible con el wheel de dlib) | `pip uninstall numpy -y` y luego `pip install "numpy<2"` |
| `module 'cv2' has no attribute 'CascadeClassifier'` | Se instaló OpenCV 5.x en vez de la serie 4.x | `pip uninstall opencv-python -y` y luego `pip install opencv-python==4.10.0.84` |
| Cámara no se activa en tablet | Conexión HTTP no segura | Usar ngrok (ver [sección 9](#9-ejecución-y-acceso-desde-tablet-ngrok)) |

---

## 11. Matriz de pruebas funcionales

| N.º | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 1 | Registrar colaborador | Colaborador identificado correctamente | ✅ Aprobado |
| 2 | Captura frontal | Captura almacenada correctamente | ✅ Aprobado |
| 3 | Captura lateral izquierda | Captura almacenada correctamente | ✅ Aprobado |
| 4 | Captura lateral derecha | Captura almacenada correctamente | ✅ Aprobado |
| 5 | Registro sin una captura | Sistema impide completar registro | ✅ Aprobado |
| 6 | Colaborador ya registrado | Sistema controla duplicidad/actualización | ✅ Aprobado |
| 7 | Reconocimiento de colaborador registrado | Persona identificada | ✅ Aprobado |
| 8 | Persona reconocida | Asistencia registrada | ✅ Aprobado |
| 9 | Persona no reconocida | Asistencia no registrada | ✅ Aprobado |
| 10 | Consulta de asistencia | Registro disponible en BD | ✅ Aprobado |
| 11 | Datos inválidos | Sistema muestra validación | ✅ Aprobado |
| 12 | Error de conexión BD | Sistema informa el error adecuadamente | ✅ Aprobado |

---

## 12. Consulta SQL de asistencias

```sql
SELECT a.id_asistencia, c.nombres, c.apellidos, a.fecha, a.hora, a.nivel_confianza
FROM asistencia a
JOIN colaboradores c ON c.id_colaborador = a.id_colaborador
ORDER BY a.fecha_registro DESC;
```

---

## 13. Evidencias

Las capturas de pantalla completas (registro facial, reconocimiento exitoso, caso no reconocido, control de duplicidad y consultas en MySQL Workbench) se encuentran en el PDF fuente:

📄 **[LINK DE GOOGLE DRIVE PDF](https://drive.google.com/file/d/1Yl_YuAUotgnfmPIPFO8mPpzoeN47k6FD/view?usp=sharing)**

Resumen de lo evidenciado:
- Selección de colaborador y aviso de reemplazo cuando ya existe un registro facial activo.
- Captura guiada de las 3 fotos (frontal, izquierda, derecha) con vista previa y guardado.
- Filas generadas en `registro_facial` (3 por colaborador).
- Asistencia registrada con nombre, hora y nivel de confianza.
- Segundo intento el mismo día: solo se conserva el primer registro.
- Persona sin registro facial: "Persona no reconocida" y **ninguna** fila nueva en `asistencia`.

---
