# VensuR

Aplicacion React + Vite con backend Node/Express para autenticacion real, perfiles privados y publicacion de contenido (historias y posts).

## Stack actual

- Frontend: React + React Router
- Backend: Express
- Base de datos: SQLite (better-sqlite3)
- Auth: JWT + bcrypt
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
- `API_PORT`: puerto de la API (por defecto `8787`).
- `DB_PATH` / `UPLOADS_DIR`: rutas opcionales para la BD SQLite y los uploads (utiles en tests/despliegues).
- `ALLOWED_ORIGINS`: lista separada por comas de origenes permitidos por CORS. Vacio = abierto (solo dev local).
- `TRUST_PROXY`: `1`/`true` si la API corre detras de un proxy inverso (para leer bien la IP del cliente).
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX`: ventana y maximo de peticiones a `/api/auth/*` por IP (por defecto 40 cada 15 min).
- `BOTS_ENABLED`: `true`/`false`. Por defecto activos fuera de produccion.
- `MAIL_TRANSPORT`: `console` (default, imprime el codigo), `file` (guarda en `server/outbox/`) o `smtp`.
- `MAIL_FROM`: remitente de los correos.
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
- Sesion persistente por token.
- Ruta de perfil privada (`/perfil`).
- Edicion de perfil (nombre visible y biografia).
- Creacion de publicaciones reales por usuario.
- Subida opcional de imagen/video en publicaciones.
- Creacion de historias privadas del usuario.

## Rutas principales de frontend

- `/acceso`: registro e inicio de sesion.
- `/perfil`: perfil privado (requiere sesion).
- `/`: feed de publicaciones.

## Persistencia local

- Base de datos SQLite: `server/data/vensur.db`
- Uploads: `server/uploads`

Ambas rutas estan ignoradas por Git.

## Scripts

- `npm run dev`: frontend Vite
- `npm run dev:api`: backend API con watch
- `npm run dev:full`: frontend + backend en paralelo
- `npm run build`: build de produccion del frontend
- `npm run preview`: preview del build
- `npm run lint`: lint del proyecto
- `npm test`: pruebas de humo de la API (`node --test`, sin dependencias extra)
