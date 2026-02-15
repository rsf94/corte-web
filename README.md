# Web dashboard (read-only)

## Requisitos

Variables de entorno (mismas credenciales que el bot, sin exponer en frontend):

- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_TABLE`
- `LINK_TOKEN_SECRET` (secreto para firmar tokens de vinculación con Telegram)
- `DASHBOARD_TOKEN` (token de acceso read-only para el API del dashboard)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` (URL pública de Cloud Run)
- `NEXTAUTH_SECRET` (32+ caracteres aleatorios)
- `ALLOWED_EMAILS` (lista separada por comas de emails autorizados)

> Nota: El build no debe requerir credenciales de auth. Las variables de NextAuth se evalúan en runtime.

### Tabla `user_links` (BigQuery)

Dataset: `BQ_DATASET`. Crear la tabla `user_links` con el siguiente esquema:

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `email` | STRING | Email de Google |
| `chat_id` | STRING | Chat ID de Telegram |
| `status` | STRING | `ACTIVE` / `REVOKED` |
| `linked_at` | TIMESTAMP | Fecha de vinculación |
| `last_seen_at` | TIMESTAMP | Último uso (opcional) |

Ejemplo de DDL:

```sql
CREATE TABLE `${BQ_PROJECT_ID}.${BQ_DATASET}.user_links` (
  email STRING,
  chat_id STRING,
  status STRING,
  linked_at TIMESTAMP,
  last_seen_at TIMESTAMP
);
```

> Nota: Las consultas del dashboard sólo leen filas con `status = "ACTIVE"`.

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
4. Una vez vinculado podrás abrir `/dashboard` sin `chat_id` en la URL.

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
- `BQ_DATASET` (asegúrate de tener la tabla `user_links`)

## Variables para el bot (telegram-gastos-bot)

- `DASHBOARD_BASE_URL` (ej. `https://tu-servicio.run.app`)
- `LINK_TOKEN_SECRET` (igual al de corte-web para firmar el link)
