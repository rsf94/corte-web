# Web dashboard (read-only)

## Requisitos

Variables de entorno (mismas credenciales que el bot, sin exponer en frontend):

- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_TABLE`
- `DASHBOARD_TOKEN` (token de acceso read-only para el API del dashboard)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` (URL pública de Cloud Run)
- `NEXTAUTH_SECRET` (32+ caracteres aleatorios)
- `ALLOWED_EMAILS` (lista separada por comas de emails autorizados)

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
