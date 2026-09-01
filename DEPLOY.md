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
   servicio **`vensur-api`** (plan **0.5c-512mb**) con **Disk** montado en `/var/data`.
   Dale a **Apply**.
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
| `AUTH_ACCESS_TOKEN_EXPIRES_IN` | `15m` | access token corto |
| `AUTH_PASSWORD_HASH_ROUNDS` | `12` | hash de claves más robusto |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | `14` | rotación de sesión prolongada |
| `AUTH_COOKIE_SAME_SITE` | `lax` | usar `none` si frontend y API van en dominios distintos |
| `AUTH_COOKIE_SECURE` | `true` | obligatorio con HTTPS |
| `AUTH_ALLOW_BEARER_TOKENS` | `false` | bloquea el modo legacy por header |
| `AUTH_EXPOSE_TOKEN_RESPONSE` | `false` | evita exponer token en JSON |
| `TRUST_PROXY` | `1` | ya puesta |
| `DB_PATH` | `/var/data/vensur.db` | persistente entre reinicios |
| `UPLOADS_DIR` | `/var/data/uploads` | persistente entre reinicios |
| `REQUIRE_PERSISTENT_STORAGE` | `true` | la API no arranca si detecta rutas efímeras |
| `DB_BUSY_TIMEOUT_MS` | `7000` | reduce fallos por lock transitorio |
| `DB_SYNCHRONOUS` | `FULL` | prioriza integridad de datos |
| `AUTH_EXPOSE_VERIFICATION_CODE` | `false` | más seguro en producción |
| `BOTS_ENABLED` | `false` | evita ruido y carga innecesaria en DB |
| `ALLOWED_ORIGINS` | *(pon tu dominio de Netlify)* | Ej: `https://vensur.netlify.app` |
| `REQUIRE_STRICT_CORS` | `true` | obliga allowlist CORS explícita |
| `AUTH_REDIS_ENABLED` | `true` *(si tienes Redis)* | rate limit distribuido |
| `AUTH_REDIS_URL` | `redis://...` | URL del Redis gestionado |
| `AUTH_LOGIN_FAIL_WINDOW_MS` | `1800000` | ventana de fallos de login |
| `AUTH_LOGIN_LOCK_L1_AFTER` | `5` | umbral lock corto |
| `AUTH_LOGIN_LOCK_L1_MS` | `120000` | lock 2 min |
| `AUTH_LOGIN_LOCK_L2_AFTER` | `8` | umbral lock medio |
| `AUTH_LOGIN_LOCK_L2_MS` | `600000` | lock 10 min |
| `AUTH_LOGIN_LOCK_L3_AFTER` | `12` | umbral lock fuerte |
| `AUTH_LOGIN_LOCK_L3_MS` | `1800000` | lock 30 min |
| `SECURITY_EVENT_RETENTION_DAYS` | `30` | retención de auditoría |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY` | *(valor fuerte generado)* | clave para cifrar secretos TOTP |
| `AUTH_MFA_SETUP_TOKEN_EXPIRES_IN` | `10m` | duración del token de setup MFA |
| `AUTH_MFA_LOGIN_CHALLENGE_TTL_MS` | `300000` | TTL del desafío MFA de login |
| `AUTH_MFA_LOGIN_MAX_ATTEMPTS` | `6` | máximo intentos por desafío MFA |
| `AUTH_MFA_TOTP_ISSUER` | `VensuR` | nombre visible en app autenticadora |
| `SECURITY_AUDIT_ADMIN_ALLOWLIST` | `usuario1,correo@dominio.com` | cuentas autorizadas a leer auditoría |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | *(opcional)* | Solo si quieres login con Google/Apple |

> Si cambias a plan **Free** o quitas el **Disk**, Render vuelve a usar disco efímero
> y perderás cuentas/publicaciones en redeploys o reinicios.

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
- **Crear cuenta:** con seguridad estricta, configura SMTP real para recibir el código.
   Si necesitas una prueba rápida, activa temporalmente `AUTH_EXPOSE_VERIFICATION_CODE=true`
   y desactívalo de nuevo al terminar.
- El feed, historias (reels), perfil y "en vivo" deberían funcionar.

### Qué puede fallar en modo prueba (y es esperado)

| Cosa | Motivo | Solución |
|---|---|---|
| Se pierden cuentas al rato | servicio sin Disk persistente | usar `DB_PATH` y `UPLOADS_DIR` en `/var/data` + `REQUIRE_PERSISTENT_STORAGE=true` |
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
