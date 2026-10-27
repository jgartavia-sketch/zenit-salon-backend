# Zénit Salón — API

Club de clientes, catálogo, pedidos persistentes y agenda con disponibilidad pública. Node 22.13+
y PostgreSQL. Leé `LEER_PRIMERO_ZENIT.txt` para aplicar esta actualización.

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm start
```

Configurar `.env` según `.env.example`; nunca subir secretos a Git.
No utilizar `prisma migrate reset` en una base existente.

## Accesos

Clientes y propietaria: `POST /api/auth/login`. Personal: `POST /api/staff/login`.
El backend admite Bearer JWT firmado, con issuer, audience y versión de sesión.
El frontend oficial lo guarda mediante su intermediario en cookies HttpOnly.
La clave compartida `x-admin-key` ya no habilita administración.

Crear o actualizar a la dueña con `npm run owner:provision`, usando las variables
OWNER_* temporalmente. Esto no crea una cuenta en el POS general.
`POST /api/auth/logout` revoca las sesiones del usuario. Cambiar la contraseña
mediante `POST /api/auth/password` también revoca las sesiones anteriores.

## Agenda

- `GET /api/agenda/calendar?month=YYYY-MM&services=slug1,slug2`: público; días
  disponibles, completos o cerrados, sin identidad ni detalles de citas.
- `GET /api/agenda/availability?date=YYYY-MM-DD&services=slug1,slug2`: público;
  únicamente horas, duración y disponibilidad. Los servicios son opcionales; sin
  selección se muestran cupos de 15 minutos. Horizonte público de 90 días.
- `GET /api/agenda/admin/calendar?month=YYYY-MM`: solo ADMIN; calendario privado
  con nombres, servicios y detalles de las citas.
- `GET /api/agenda/mine`: autenticado; citas propias.
- `POST /api/agenda/appointments`: autenticado; fecha, hora, servicios, notas
  y requestKey UUID. Consultar disponibilidad no permite reservar sin ingresar.
- `PATCH /api/agenda/appointments/:id/cancel`: cancelación de cita propia futura.
- Solo ADMIN: settings GET/PUT, services GET/PATCH, appointments GET/PATCH y manual POST.

Agenda para un recurso, en America/Costa_Rica, sin citas cruzadas. Duraciones
configuradas en el catálogo, horarios semanales y excepciones por fecha. Los
servicios QUOTE requieren coordinación y alta manual por la propietaria.
Las solicitudes PENDING con expiresAt pasado se muestran vencidas y no bloquean
cupos; no necesitan tareas programadas. La reserva valida otra vez el cupo
mientras mantiene un bloqueo transaccional PostgreSQL.

## Pedidos

- `GET /api/orders/mine`: pedidos propios.
- `POST /api/orders`: requestKey UUID, expectedTotal entero e items {slug, quantity}.
  Se rechazan precios desactualizados, se calcula el total en servidor y se
  aparta stock en una transacción. Repetir la misma solicitud no descuenta otra vez.
- `PATCH /api/orders/:id/cancel`: cliente titular, solo PENDING.
- Solo ADMIN: GET /api/orders y PATCH /api/orders/:id (COMPLETED/CANCELLED).

La cancelación devuelve stock una sola vez. No hay pasarela de pago ni crédito
comercial en esta entrega. Los puntos se registran por factura única desde la
administración o personal, sin acreditación automática duplicada por pedidos.

## Pruebas

```bash
npm test
```

Las pruebas básicas no necesitan base. La suite de integración incluida se
activa con TEST_DATABASE_URL apuntando a una PostgreSQL local desechable llamada
zenit_test, con las migraciones ya aplicadas. Modifica su agenda y crea fixtures;
no utilizar datos reales. El repositorio no incluye la infraestructura de QA.

## Integración POS

Ver `INTEGRACION_POS_ZENIT.md`. La API privada queda preparada, desactivada por
defecto y limitada a lectura. El consumidor y las escrituras en el POS son trabajo
pendiente de System Lab; aún no existe sincronización bidireccional.
