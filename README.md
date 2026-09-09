# Sistema de Asistencia por Reconocimiento Facial

Módulo web construido con **Python + Flask** para registrar la asistencia de colaboradores usando reconocimiento facial. Funciona en laptop y en tablet de 11 pulgadas (cámara frontal o trasera, uso táctil).

---

## Estructura del proyecto

```
facial/
├── app.py                  ← Servidor Flask + todas las rutas API
├── config.py               ← Configuración (lee el archivo .env)
├── db.py                   ← Conexión a MySQL y todas las consultas
├── .env                    ← Tus datos reales de MySQL (NO subir a Git)
├── .env.example            ← Plantilla para crear el .env
├── requirements.txt        ← Dependencias de Python
│
├── templates/
│   ├── index.html          ← Pantalla A: registro facial
│   └── asistencia.html     ← Pantalla B: marcar asistencia
│
├── static/
│   ├── css/
│   │   └── estilos.css     ← Estilos responsive (dark theme, mobile-first)
│   └── js/
│       ├── registro.js     ← Lógica de cámara y fotos (Pantalla A)
│       └── asistencia.js   ← Lógica de reconocimiento (Pantalla B)
│
└── uploads/                ← Fotos de colaboradores (se crean solas)
```

---

## Requisitos previos

| Herramienta | Versión mínima | Para qué |
|-------------|---------------|----------|
| Python      | 3.10          | Ejecutar el servidor |
| MySQL       | 5.7 / 8.x     | Base de datos |
| CMake       | 3.x           | Compilar dlib (solo si usas face_recognition) |
| Visual Studio Build Tools | 2019+ | Compilar dlib en Windows |

> Si no quieres instalar dlib/CMake, ve directo a la sección **Instalación sin face_recognition**.

---

## 1. Configurar la base de datos MySQL

Abre MySQL Workbench (o la consola MySQL) y ejecuta el siguiente SQL para crear las tablas:

```sql
CREATE DATABASE IF NOT EXISTS asistencia_facial;
USE asistencia_facial;

CREATE TABLE colaboradores (
    id_colaborador     INT AUTO_INCREMENT PRIMARY KEY,
    codigo_colaborador VARCHAR(20)  NOT NULL UNIQUE,
    nombres            VARCHAR(100) NOT NULL,
    apellidos          VARCHAR(100) NOT NULL,
    dni                VARCHAR(20)  NOT NULL UNIQUE,
    area               VARCHAR(80),
    estado             ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    fecha_registro     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE registro_facial (
    id_registro_facial  INT AUTO_INCREMENT PRIMARY KEY,
    id_colaborador      INT NOT NULL,
    tipo_captura        ENUM('FRONTAL','LATERAL_IZQUIERDA','LATERAL_DERECHA') NOT NULL,
    ruta_imagen         VARCHAR(255) NOT NULL,
    encoding_facial     TEXT NOT NULL,
    fecha_registro      DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    estado              ENUM('ACTIVO','REEMPLAZADO') NOT NULL DEFAULT 'ACTIVO',
    FOREIGN KEY (id_colaborador) REFERENCES colaboradores(id_colaborador),
    UNIQUE KEY uq_colab_tipo (id_colaborador, tipo_captura, estado)
);

CREATE TABLE asistencia (
    id_asistencia   INT AUTO_INCREMENT PRIMARY KEY,
    id_colaborador  INT NOT NULL,
    fecha           DATE NOT NULL,
    hora            TIME NOT NULL,
    nivel_confianza DECIMAL(5,2),
    fecha_registro  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_colaborador) REFERENCES colaboradores(id_colaborador),
    UNIQUE KEY uq_colab_fecha (id_colaborador, fecha)
);

-- Datos de prueba
INSERT INTO colaboradores (codigo_colaborador, nombres, apellidos, dni, area) VALUES
('EMP001', 'Juan',  'Pérez',  '12345678', 'Operaciones'),
('EMP002', 'María', 'García', '87654321', 'Sistemas');
```

---

## 2. Configurar el archivo .env

Copia el archivo de ejemplo y edítalo con tus datos:

```bash
# En Windows (PowerShell):
Copy-Item .env.example .env
```

Luego abre `.env` en el Bloc de notas y completa:

```env
MYSQL_HOST=localhost          # o el nombre/IP de tu servidor MySQL
MYSQL_PORT=3306
MYSQL_USER=root               # tu usuario de MySQL
MYSQL_PASSWORD=tu_contraseña  # tu contraseña de MySQL
MYSQL_DATABASE=asistencia_facial

FLASK_PORT=5000

# Umbral de reconocimiento (0.50 = estricto, 0.55 = más permisivo)
FACE_DISTANCE_THRESHOLD=0.50
```

> **Nota:** Si tu MySQL está en la misma laptop, `MYSQL_HOST=localhost` funciona.  
> Si está en otra PC de la red, pon su dirección IP.

---

## 3. Crear el entorno virtual e instalar dependencias

Abre una terminal en la carpeta del proyecto y ejecuta:

```powershell
# Crear entorno virtual
python -m venv venv

# Activarlo (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Si da error de permisos, ejecuta primero:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Instalar dependencias base (sin face_recognition por ahora)
pip install Flask==3.0.3 mysql-connector-python==9.1.0 python-dotenv==1.0.1 Pillow==10.4.0 numpy==1.26.4 opencv-python==4.10.0.84
```

---

## 4. Instalar face_recognition (recomendado, mejor precisión)

### Opción A — Instalación completa en Windows

1. **Instala CMake:**  
   Descarga desde https://cmake.org/download/ e instala marcando "Add CMake to PATH".

2. **Instala Visual Studio Build Tools:**  
   Descarga desde https://visualstudio.microsoft.com/visual-cpp-build-tools/  
   Marca la opción **"Desarrollo para el escritorio con C++"**.

3. **Instala dlib y face_recognition:**
   ```powershell
   pip install dlib
   pip install face_recognition==1.3.0
   ```

4. **Verifica la instalación:**
   ```powershell
   python -c "import face_recognition; print('face_recognition OK')"
   ```

### Opción B — Solo OpenCV (sin compilar nada)

Si no puedes instalar dlib, el sistema funciona igual usando OpenCV como fallback. Solo asegúrate de tener instalado `opencv-python`. La precisión es menor, pero funciona para pruebas.

```powershell
pip install opencv-python==4.10.0.84
```

La app detecta automáticamente cuál está disponible y te avisa en la consola al arrancar.

---

## 5. Ejecutar la aplicación

```powershell
# Asegúrate de tener el entorno virtual activado
.\venv\Scripts\Activate.ps1

# Arrancar el servidor
python app.py
```

Deberías ver algo así:

```
  Motor de reconocimiento: face_recognition
  Accede desde la tablet en:  http://192.168.1.XX:5000
 * Running on http://0.0.0.0:5000
```

---

## 6. Abrir en el navegador

| Dispositivo | URL |
|-------------|-----|
| Laptop (misma máquina) | http://localhost:5000 |
| Tablet (en la misma WiFi) | http://\<IP-de-tu-laptop\>:5000 |

> Para saber la IP de tu laptop en Windows: abre PowerShell y escribe `ipconfig`.  
> Busca la línea **"Dirección IPv4"** de tu adaptador WiFi (ejemplo: `192.168.1.15`).

---

## 7. Uso paso a paso

### Pantalla A — Registrar a un colaborador

1. Abre `http://localhost:5000`
2. Busca el colaborador por nombre o código.
3. Selecciónalo en la lista.
4. Si ya tiene registro facial, confirma el reemplazo (el anterior queda en historial).
5. Pulsa **"Continuar a tomar fotos"**.
6. Activa la cámara (elige frontal o trasera).
7. Toma las 3 fotos siguiendo las instrucciones en pantalla:
   - **Frontal:** mira directo a la cámara.
   - **Izquierda:** gira el rostro a tu izquierda.
   - **Derecha:** gira el rostro a tu derecha.
8. Si alguna foto no quedó bien, pulsa **"Retomar"** debajo de la miniatura.
9. Cuando las 3 fotos estén listas, pulsa **"Guardar registro facial"**.

### Pantalla B — Marcar asistencia

1. Abre `http://localhost:5000/asistencia`
2. Activa la cámara.
3. El colaborador se coloca frente a la cámara.
4. Pulsa **"Capturar y verificar"**.
5. El sistema compara el rostro con los registros activos:
   - ✅ **Reconocido:** muestra nombre, hora y guarda asistencia en MySQL.
   - ⚠️ **Ya registrado hoy:** muestra aviso, no duplica el registro.
   - ❌ **No reconocido:** muestra mensaje de error, no guarda nada.

---

## 8. Acceso desde tablet (importante)

La API `getUserMedia` del navegador **requiere HTTPS o localhost**. Esto significa:

- Desde la **misma laptop**: funciona directo en `http://localhost:5000`.
- Desde una **tablet en la misma red WiFi**: el navegador puede bloquear la cámara porque la conexión es HTTP (no HTTPS).

**Solución para tablet sin instalar certificados:**

1. En Chrome (Android/tablet): ve a `chrome://flags`
2. Busca **"Insecure origins treated as secure"**
3. Agrega `http://192.168.1.15:5000` (la IP de tu laptop)
4. Reinicia Chrome.

En iPad/Safari, necesitarás un certificado SSL. La opción más sencilla es usar **ngrok** (genera una URL HTTPS gratuita que apunta a tu localhost):

```powershell
# Instalar ngrok desde https://ngrok.com/download
# Luego:
ngrok http 5000
# Te dará una URL tipo https://abc123.ngrok.io — úsala en la tablet
```

---

## 9. Solución de problemas frecuentes

| Problema | Causa probable | Solución |
|----------|---------------|----------|
| `RuntimeError: Falta la variable MYSQL_USER` | No existe el `.env` | Copia `.env.example` a `.env` y complétalo |
| `Access denied for user 'root'` | Contraseña incorrecta en `.env` | Verifica `MYSQL_PASSWORD` en el `.env` |
| `ModuleNotFoundError: No module named 'face_recognition'` | dlib no instalado | Usa Opción B (OpenCV) o instala CMake + dlib |
| Cámara no aparece en tablet | HTTP bloqueado por el navegador | Aplica el paso de Chrome flags o usa ngrok |
| `No se detectó ningún rostro` | Mala iluminación o rostro muy lateral | Mejora la iluminación y centra el rostro |
| Puerto 5000 ocupado | Otro proceso usa ese puerto | Cambia `FLASK_PORT=5001` en el `.env` |

---

## 10. Variables de entorno disponibles

| Variable | Valor por defecto | Descripción |
|----------|------------------|-------------|
| `MYSQL_HOST` | `localhost` | Servidor MySQL |
| `MYSQL_PORT` | `3306` | Puerto MySQL |
| `MYSQL_USER` | *(requerido)* | Usuario MySQL |
| `MYSQL_PASSWORD` | *(vacío)* | Contraseña MySQL |
| `MYSQL_DATABASE` | *(requerido)* | Nombre de la BD |
| `FLASK_PORT` | `5000` | Puerto del servidor Flask |
| `FACE_DISTANCE_THRESHOLD` | `0.50` | Umbral de reconocimiento (0.45–0.60) |

---

## Archivos que NO se suben a Git

El `.gitignore` ya excluye:
- `.env` (tiene tu contraseña)
- `uploads/` (fotos de colaboradores, datos personales)
- `venv/` (entorno virtual)
- `__pycache__/`
