# Zénit Salón — Backend

API independiente para Club Zénit: registro, login JWT, cuenta, puntos, referidos e historial.

## Inicio local

1. Copiar `.env.example` como `.env` y completar los secretos.
2. Crear una base PostgreSQL vacía.
3. Ejecutar:

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

La API abre en `http://localhost:4000`. Salud: `GET /api/health`.

## Regla de puntos

Cada ₡100 pagados generan 1 punto. Solo una llamada administrativa autenticada
con `x-admin-key` puede acreditar compras o hacer ajustes.

## Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` — Bearer token
- `POST /api/auth/logout`
- `POST /api/referrals` — Bearer token
- `GET /api/admin/customers` — `x-admin-key`
- `POST /api/admin/points/purchase` — `x-admin-key`
- `POST /api/admin/points/adjust` — `x-admin-key`

## Producción

Desplegar como servicio Node, configurar las variables de `.env.example` y
ejecutar `npm run prisma:migrate` como comando previo al arranque. En el frontend
definir `NEXT_PUBLIC_API_URL` con la URL pública del backend.
