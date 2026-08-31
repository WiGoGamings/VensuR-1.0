# Desplegar VensuR (frontend en Netlify + backend en Render)

Guía para subir una **versión de prueba al aire**. Arquitectura:

```
Navegador ─▶ Netlify (sitio estático, Vite)
                 │  /api/*  y  /uploads/*  se reenvían a ▼
                 └────────────────────▶ Render (Express + SQLite)
```

El frontend usa **rutas relativas**; Netlify reenvía `/api/*` y `/uploads/*` al
backend de Render. Así no hay que tocar CORS ni poner URLs absolutas en el código.

---

## 0. Antes de empezar

- El repo ya está en GitHub: `https://github.com/WiGoGamings/VensuR-1.0`
- Ten cuentas gratis en **[Render](https://render.com)** y **[Netlify](https://netlify.com)**
  (puedes entrar con GitHub en ambas).
- Archivos que ya vienen listos en el repo: `render.yaml`, `netlify.toml`, `.nvmrc`.

---

## 1. Backend en Render

1. En Render: **New ▸ Blueprint**.
2. Conecta el repo `VensuR-1.0`. Render detecta `render.yaml` y propone crear el
   servicio **`vensur-api`** (plan **Free**). Dale a **Apply**.
3. Render construye (`npm ci`) y arranca (`npm run start:api`). Tarda ~3–5 min la
   primera vez (compila `better-sqlite3`).
4. Cuando termine, copia la URL del servicio. Queda así:
   `https://vensur-api-xxxx.onrender.com`
5. Comprueba que responde:
   `https://vensur-api-xxxx.onrender.com/api/health` → `{"ok":true,...}`

### Variables de entorno (Render las pone casi todas desde `render.yaml`)

| Variable | Valor | Nota |
|---|---|---|
| `NODE_ENV` | `production` | ya puesta |
| `AUTH_JWT_SECRET` | (Render genera una) | ya puesta |
| `TRUST_PROXY` | `1` | ya puesta |
| `AUTH_EXPOSE_VERIFICATION_CODE` | `true` | ya puesta — **permite crear cuentas sin correo** (el código sale en pantalla). Quítala cuando tengas SMTP real. |
| `BOTS_ENABLED` | `true` | ya puesta — llena el feed con contenido de demo |
| `ALLOWED_ORIGINS` | *(déjala vacía al principio)* | Cuando el sitio de Netlify funcione, ponla = la URL de Netlify (ej: `https://vensur.netlify.app`) y redeploy. |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | *(opcional)* | Solo si quieres login con Google/Apple |

> **Plan Free de Render:** el servicio se "duerme" tras 15 min sin uso; la primera
> petición después tarda ~40 s en despertar (por eso el timeout del frontend está
> en 45 s). Además el disco es **efímero**: cada redeploy/reinicio borra la base de
> datos y las subidas. Los bots vuelven a llenar el feed al arrancar, pero **las
> cuentas y publicaciones que crees se pierden en cada reinicio**. Para que
> persistan: sube el servicio a plan **Starter** y añade un **Disk** montado en
> `/var/data`, luego pon `DB_PATH=/var/data/vensur.db` y `UPLOADS_DIR=/var/data/uploads`.

---

## 2. Frontend en Netlify

1. **Edita `netlify.toml`** (en el repo): reemplaza `TU-SERVICIO-EN-RENDER` por el
   nombre real de tu servicio de Render en las **dos** líneas de `to =`. Ejemplo:
   ```toml
   to = "https://vensur-api-xxxx.onrender.com/api/:splat"
   ...
   to = "https://vensur-api-xxxx.onrender.com/uploads/:splat"
   ```
   Haz `git commit` + `git push`.
2. En Netlify: **Add new site ▸ Import an existing project** ▸ elige `VensuR-1.0`.
3. Netlify lee `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - No hace falta añadir variables de entorno a mano.
4. **Deploy site.** Tarda ~2–3 min.
5. Netlify te da una URL tipo `https://random-name-123.netlify.app`
   (puedes cambiar el nombre en *Site configuration ▸ Change site name*).

---

## 3. Cerrar el círculo (CORS)

1. Con el sitio de Netlify ya funcionando, ve a Render ▸ `vensur-api` ▸
   **Environment** ▸ añade / edita:
   `ALLOWED_ORIGINS = https://TU-SITIO.netlify.app`
2. **Manual Deploy ▸ Clear build cache & deploy** (o solo *Restart*).

---

## 4. Probar

- Abre `https://TU-SITIO.netlify.app`
- **Crear cuenta:** el código de verificación aparece en la propia pantalla
  (`Codigo de verificacion (desarrollo): 123456`). Pégalo y listo.
- El feed, historias (reels), perfil y "en vivo" deberían funcionar.

### Qué puede fallar en modo prueba (y es esperado)

| Cosa | Motivo | Solución |
|---|---|---|
| Primera carga lenta (~40 s) | Render Free "despierta" el servicio | esperar; se queda despierto mientras haya uso |
| Se pierden cuentas al rato | disco efímero de Render Free | plan Starter + Disk (ver arriba) |
| "En vivo": el espectador a veces no conecta | no hay servidor TURN; algunas redes bloquean el P2P | añadir un TURN (ver abajo) |
| Grabación de un "en vivo" no se guarda | archivos grandes por el proxy de Netlify | apuntar el frontend directo a Render (ver abajo) |
| Emails reales de verificación | `MAIL_TRANSPORT=console` | configurar SMTP (ver abajo) |

---

## 5. Opcionales

### 5.1 Correo real (SMTP con Gmail)

1. Render ▸ Environment del servicio ▸ **Build command** → `npm ci && npm i nodemailer`
   (o añade `nodemailer` a `dependencies` en `package.json`).
2. Variables:
   ```
   MAIL_TRANSPORT = smtp
   SMTP_HOST = smtp.gmail.com
   SMTP_PORT = 587
   SMTP_SECURE = false
   SMTP_USER = tucorreo@gmail.com
   SMTP_PASS = (App Password de 16 caracteres, NO tu clave normal)
   MAIL_FROM = VensuR <tucorreo@gmail.com>
   ```
   App Password: cuenta de Google ▸ Seguridad ▸ Verificación en 2 pasos ▸
   Contraseñas de aplicaciones.
3. Quita `AUTH_EXPOSE_VERIFICATION_CODE`.

### 5.2 TURN para "en vivo" entre redes distintas

Regístrate en un TURN gratuito (p. ej. [metered.ca](https://www.metered.ca/tools/openrelay/))
y añade sus `iceServers` en:
- `src/hooks/useLiveViewer.js` → `LIVE_STUN_CONFIG`
- `src/contexts/LiveBroadcastContext.jsx` → `LIVE_STUN_CONFIG`

### 5.3 Frontend directo a Render (sin proxy de Netlify)

Solo si el proxy te da problemas con subidas grandes. En Netlify ▸ Site settings ▸
Environment variables:
```
VITE_API_BASE_URL = https://vensur-api-xxxx.onrender.com
```
y quita los dos `[[redirects]]` de `/api/*` (deja el de `/uploads/*` — las imágenes
lo necesitan). Redeploy. Requiere `ALLOWED_ORIGINS` bien puesto en Render.

---

## 6. Cada actualización

`git push` a `master` → Render y Netlify redepliegan solos (autoDeploy).
