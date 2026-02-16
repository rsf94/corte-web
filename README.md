# Web dashboard (read-only)

## Requisitos

Variables de entorno (mismas credenciales que el bot, sin exponer en frontend):

- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_IDENTITY_USERS_TABLE` (opcional, default: `users`)
- `BQ_IDENTITY_CHAT_LINKS_TABLE` (opcional, default: `chat_links`)
- `BQ_TABLE`
- `LINK_TOKEN_SECRET` (secreto para firmar tokens de vinculación con Telegram)
- `DASHBOARD_TOKEN` (token de acceso read-only para el API del dashboard)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` (URL pública de Cloud Run)
- `NEXTAUTH_SECRET` (32+ caracteres aleatorios)
- `ALLOWED_EMAILS` (lista separada por comas de emails autorizados)

> Nota: El build no debe requerir credenciales de auth. Las variables de NextAuth se evalúan en runtime.

### Tablas de identidad y vinculación (BigQuery)

Ahora el dashboard resuelve identidad en dos pasos:

1. `users`: email (normalizado a minúsculas) -> `user_id`.
2. `chat_links`: `user_id` -> `chat_id` (estado `LINKED`).

La tabla `user_links` se mantiene como auditoría append-only para el flujo de `link_token` del bot, pero **ya no es la fuente de verdad para autorización**.

Ejecuta la migración:

- `docs/migrations/20260216_identity_users_chat_links.sql`

Si estas tablas no existen, el backend regresará un error claro indicando que faltan `users/chat_links`.

## Correr local

```bash
npm install
npm run dev
```

Visita:

```
http://localhost:3000/login
```

Si aún usas el flujo legacy, puedes acceder con token:

```
http://localhost:3000/dashboard?token=TU_TOKEN&chat_id=TU_CHAT_ID
```

Opcionalmente define un rango de meses:

```
http://localhost:3000/dashboard?token=TU_TOKEN&chat_id=TU_CHAT_ID&from=2024-01-01&to=2024-12-01
```

## Cómo vincular Telegram con tu cuenta

1. En Telegram, envía el comando `/dashboard` al bot.
2. Abre el enlace que responde (incluye `code=...`).
3. Inicia sesión con Google si es necesario.
4. Una vez vinculado, corte-web crea/usa tu `user_id` y registra un `chat_links` append-only.
5. Después podrás abrir `/dashboard` sin `chat_id` en la URL.

## Deploy

Compatible con Vercel o Cloud Run. Asegura las env vars arriba y expone el endpoint:

```
GET /api/cashflow?token=...&chat_id=...&from=YYYY-MM-01&to=YYYY-MM-01
```

**TODO (temporary workaround):** El build en Cloud Build usa `npm install` en el Dockerfile porque el `package-lock.json` está fuera de sync con `package.json`. Regenerar y commitear un lockfile actualizado para volver a `npm ci` y lograr builds determinísticos.

Para Cloud Run:

1. Configura `NEXTAUTH_URL` con la URL pública del servicio.
2. Define `ALLOWED_EMAILS` con los correos permitidos (ej. `persona@dominio.com,otra@dominio.com`).
3. Agrega `NEXTAUTH_SECRET` con una cadena aleatoria segura.

Variables requeridas en runtime (Cloud Run):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `LINK_TOKEN_SECRET`
- `BQ_DATASET` (asegúrate de aplicar la migración de `users` + `chat_links`)

## Variables para el bot (telegram-gastos-bot)

- `DASHBOARD_BASE_URL` (ej. `https://tu-servicio.run.app`)
- `LINK_TOKEN_SECRET` (igual al de corte-web para firmar el link)
