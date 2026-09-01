# VensuR

Aplicacion React + Vite con backend Node/Express para autenticacion real, perfiles privados y publicacion de contenido (historias y posts).

## Stack actual

- Frontend: React + React Router
- Backend: Express
- Base de datos: SQLite (better-sqlite3)
- Auth: access JWT corto + refresh token rotatorio en cookie HttpOnly + bcrypt
- Uploads: multer (imagenes y videos)

## Requisitos

- Node.js 20+
- npm

## Instalacion

```bash
npm install
```

Opcional: crea tu archivo local de variables desde el ejemplo.

```powershell
Copy-Item .env.example .env
```

## Ejecucion en desarrollo

```bash
npm run dev:full
```

Ese comando levanta:

- Web Vite en `http://127.0.0.1:5173`
- API en `http://127.0.0.1:8787`

Tambien puedes ejecutar por separado:

```bash
npm run dev:api
npm run dev
```

## Variables recomendadas

- `AUTH_JWT_SECRET`: secreto JWT para la API. **Obligatorio en produccion** (>= 24 caracteres); el servidor no arranca sin el si `NODE_ENV=production`.
- `AUTH_ACCESS_TOKEN_EXPIRES_IN`: vida del access token (recomendado `15m`).
- `AUTH_PASSWORD_HASH_ROUNDS`: costo bcrypt para nuevas claves (default `11`; recomendado `12` en produccion).
- `AUTH_REFRESH_TOKEN_TTL_DAYS`: vida de refresh token (default `14`).
- `AUTH_COOKIE_SAME_SITE` / `AUTH_COOKIE_SECURE` / `AUTH_COOKIE_DOMAIN` / `AUTH_COOKIE_PATH`: endurecimiento de cookie de sesion.
- `AUTH_ALLOW_BEARER_TOKENS`: compatibilidad legacy por `Authorization: Bearer`. Recomendado `false` en produccion.
- `AUTH_EXPOSE_TOKEN_RESPONSE`: incluir token en JSON de auth. Recomendado `false` en produccion.
- `API_PORT`: puerto de la API (por defecto `8787`).
- `DB_PATH` / `UPLOADS_DIR`: rutas de la BD SQLite y uploads. En produccion deben vivir en almacenamiento persistente.
- `REQUIRE_PERSISTENT_STORAGE`: cuando esta en `true` (default en produccion), la API exige `DB_PATH` y `UPLOADS_DIR` explicitos y rechaza rutas efimeras.
- `DB_BUSY_TIMEOUT_MS` / `DB_SYNCHRONOUS`: ajustes de robustez de SQLite (`busy_timeout` y `synchronous`; default `5000` y `FULL`).
- `ALLOWED_ORIGINS`: lista separada por comas de origenes permitidos por CORS. En produccion debe definirse con dominios explicitos.
- `REQUIRE_STRICT_CORS`: recomendado `true` en produccion; si no hay `ALLOWED_ORIGINS`, la API no arranca.
- `TRUST_PROXY`: `1`/`true` si la API corre detras de un proxy inverso (para leer bien la IP del cliente).
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX`: ventana y maximo de peticiones a `/api/auth/*` por IP (por defecto 40 cada 15 min).
- `AUTH_LOGIN_FAIL_WINDOW_MS` + `AUTH_LOGIN_LOCK_L*_*`: bloqueo progresivo de login por IP+identificador (anti brute force).
- `AUTH_REDIS_ENABLED` / `AUTH_REDIS_URL`: activa store distribuido (Redis) para rate limiting y lock anti brute force; si falla, cae a memoria.
- `AUTH_SECURITY_KEY_PREFIX`: prefijo de llaves de seguridad en Redis.
- `SECURITY_EVENT_RETENTION_DAYS`: retencion de auditoria de eventos de seguridad en SQLite.
- `AUTH_MFA_SECRET_ENCRYPTION_KEY`: clave para cifrar secretos TOTP de MFA (obligatoria en produccion).
- `AUTH_MFA_SETUP_TOKEN_EXPIRES_IN`: vida del token temporal de setup MFA (default `10m`).
- `AUTH_MFA_LOGIN_CHALLENGE_TTL_MS`: ventana del desafio MFA al iniciar sesion (default `300000`).
- `AUTH_MFA_LOGIN_MAX_ATTEMPTS`: intentos maximos por desafio MFA (default `6`).
- `AUTH_MFA_TOTP_ISSUER`: nombre mostrado en apps autenticadoras (default `VensuR`).
- `SECURITY_AUDIT_ADMIN_ALLOWLIST`: allowlist (username/email/id) para leer `/api/security/audit-events`.
- `BOTS_ENABLED`: `true`/`false`. Por defecto activos fuera de produccion.
- `MAIL_TRANSPORT`: `console` (default, imprime el codigo), `file` (guarda en `server/outbox/`) o `smtp`.
- `MAIL_FROM`: remitente de los correos.
- `AUTH_EXPOSE_VERIFICATION_CODE`: expone el codigo de verificacion en respuestas auth (util para pruebas sin SMTP). En produccion mantenerlo en `false` salvo pruebas controladas y temporales.
- SMTP (con `MAIL_TRANSPORT=smtp`, requiere `npm i nodemailer`): `SMTP_URL` o `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`.
- `VITE_API_BASE_URL`: opcional; en dev no hace falta porque Vite ya hace proxy.
- `GOOGLE_CLIENT_ID`: Client ID OAuth de Google (backend). **No se usa el client secret**; solo se valida el `idToken`.
- `APPLE_CLIENT_ID`: Service ID de Apple Sign In (backend).
- `VITE_GOOGLE_CLIENT_ID`: Client ID OAuth de Google (frontend).
- `VITE_APPLE_CLIENT_ID`: Service ID de Apple Sign In (frontend).
- `VITE_APPLE_REDIRECT_URI`: callback configurado en Apple para popup/login.

## OAuth social (Google y Apple)

La app ya incluye endpoints de login social:

- `POST /api/auth/oauth/google` (valida `idToken` con Google en backend).
- `POST /api/auth/oauth/apple` (valida `idToken` con Apple en backend).

Para producción:

- Configura `GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CLIENT_ID` con el mismo valor.
- Configura `APPLE_CLIENT_ID` y `VITE_APPLE_CLIENT_ID` con el mismo Service ID.
- Define `VITE_APPLE_REDIRECT_URI` exactamente igual al Return URL configurado en Apple.
- Usa HTTPS y dominio real para ambos proveedores.

## Funcionalidades de usuarios reales

- Registro con correo, usuario y clave.
- Login con usuario o correo.
- Sesion persistente con cookies HttpOnly (access + refresh rotatorio) y logout con revocacion.
- MFA TOTP opcional (2FA) con desafio en login para cuentas que lo activen.
- Ruta de perfil privada (`/perfil`).
- Edicion de perfil (nombre visible y biografia).
- Creacion de publicaciones reales por usuario.
- Subida opcional de imagen/video en publicaciones.
- Creacion de historias privadas del usuario.

## Endpoints MFA y auditoria

- `POST /api/auth/mfa/setup`: inicia setup TOTP para usuario autenticado.
- `POST /api/auth/mfa/enable`: confirma y activa MFA con codigo TOTP.
- `POST /api/auth/mfa/disable`: desactiva MFA validando codigo TOTP actual.
- `POST /api/auth/mfa/verify-login`: completa login cuando la API responde `MFA_REQUIRED`.
- `GET /api/auth/mfa/status`: estado MFA de la cuenta actual.
- `GET /api/security/audit-events`: eventos de auditoria (solo usuarios en `SECURITY_AUDIT_ADMIN_ALLOWLIST`).

## Rutas principales de frontend

- `/acceso`: registro e inicio de sesion.
- `/perfil`: perfil privado (requiere sesion).
- `/`: feed de publicaciones.

## Persistencia local

- Base de datos SQLite: `server/data/vensur.db`
- Uploads: `server/uploads`

Para despliegues productivos (ej. Render), usa un volumen persistente y apunta
`DB_PATH` + `UPLOADS_DIR` a ese volumen (por ejemplo `/var/data`).

Ambas rutas estan ignoradas por Git.

## Scripts

- `npm run dev`: frontend Vite
- `npm run dev:api`: backend API con watch
- `npm run dev:full`: frontend + backend en paralelo
- `npm run build`: build de produccion del frontend
- `npm run preview`: preview del build
- `npm run lint`: lint del proyecto
- `npm test`: pruebas de humo de la API (`node --test`, sin dependencias extra)
