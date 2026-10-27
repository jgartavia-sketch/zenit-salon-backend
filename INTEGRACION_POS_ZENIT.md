# Integración Zénit / System Lab POS — contrato 2

Este contrato implementa lecturas y escrituras privadas. Su activación en producción
requiere aplicar los paquetes de ambos sistemas, las migraciones y las variables.
Los cambios de código no crean por sí solos cuentas en una base de producción.

## Configuración servidor

- Backend Zénit: `ZENIT_CONNECT_KEY` aleatoria de al menos 32 caracteres;
  `ZENIT_POS_CONNECTED=true` cuando ambos sistemas estén desplegados y conectados.
- Backend POS: la misma `ZENIT_CONNECT_KEY` y `ZENIT_CONNECT_BASE_URL`, el origen
  HTTPS del backend Zénit (sin `/api`, usuario, contraseña ni consultas).
- Ninguna clave va a Angular, Next público, Git, enlaces o almacenamiento del navegador.
- La autenticación privada usa `X-SystemLab-Key`; no acepta el JWT de la dueña.

## Rutas privadas /api/pos-connect

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/catalog` | Catálogo con IDs, categoría, estado, stock, duración y contractVersion=2 |
| GET | `/customers?offset=0&limit=200` | Clientes activos, paginados y sin hashes de contraseña |
| GET | `/orders?offset=0` | Pedidos y clientes, 100 por página |
| GET | `/orders/:id` | Pedido original para importación por ID |
| GET | `/appointments?date=YYYY-MM-DD` | Agenda original y vencimiento de solicitudes |
| POST | `/sales` | Venta de mostrador o consumo de un pedido reservado; contado o crédito |
| POST | `/sales/settle` | Liquidación del crédito y puntos de la factura, una vez |
| POST | `/sales/reopen` | Anulación de liquidación: revierte puntos y reabre el saldo |
| POST | `/sales/void` | Anula venta, restituye unidades y revierte puntos |
| POST | `/inventory` | Entrada, salida o conteo del único inventario |
| POST | `/catalog/update` | Nombre, precio y estado del artículo vinculado |
| POST | `/orders/cancel` | Cancela un pedido pendiente y libera su reserva original |
| POST | `/appointments` | Cita/bloqueo usando `createManual`, compartida con el sitio |
| POST | `/appointments/update` | Estado/reprogramación usando `updateAppointment`, compartida con el sitio |

## Consistencia y reintentos

`PosOperation` conserva la clave, huella y resultado de cada operación privada.
`PosSale` conserva referencia única de venta, pedido web y factura. Un UUID
reutilizado con otro contenido se rechaza. Los pedidos web ya descontaron su
reserva: `/sales` verifica exactamente IDs, cantidades, precios, cliente y total,
y no vuelve a descontar sus unidades. Los pedidos cerrados no se cobran de nuevo.

Las escrituras de inventario y venta comparten el bloqueo 724031 con la tienda;
las de puntos comparten el bloqueo 724032 con staff/admin, en ese orden.
Las citas comparten el bloqueo 724030, las transacciones y las validaciones del
calendario existente. No existe una agenda editable paralela en el POS.

El POS guarda primero una intención persistente. Si se pierde la respuesta, la
operación queda pendiente, bloquea nuevas escrituras del negocio y el cierre de
caja, y puede recuperarse desde Resumen usando los datos guardados en servidor.
La recuperación no acepta un destino ni contenido arbitrario del navegador.
Una respuesta definitiva 4xx rechaza la intención sin cerrar la venta local.
No hay confirmación optimista ni tarea de sincronización que pueda perderse.

Los puntos usan la factura normalizada. Una factura acreditada por staff se
reutiliza sin añadir puntos otra vez. Las cuotas no generan puntos por cada
abono: se acreditan al liquidar el saldo completo. Anular la liquidación revierte
los puntos; volver a liquidar los restituye con un movimiento auditado. Si ya se
utilizaron los puntos, la anulación se rechaza hasta resolver el saldo del cliente.
Las decisiones de agenda desde el POS conservan la cola EmailDelivery del sitio: confirmación, rechazo con motivo, reprogramación y propuesta se notifican por el trabajador existente. El reintento de una operación confirmada no vuelve a encolar el mismo aviso. El aprovisionamiento POS no envía correos.

## Operación para la propietaria

Con `ZENIT_POS_CONNECTED=true`, el panel de la tienda ofrece **Cobrar en POS** y
su API impide marcar un pedido como pagado por un segundo flujo independiente.
El POS muestra pedidos web para importar una sola vez, cobrar o vender a crédito.
Los clientes registrados y el catálogo se actualizan al entrar/consultar Resumen
y con el botón de conexión; también hay consulta periódica de 30 segundos mientras
ese panel está abierto. La validación de stock al vender siempre ocurre en Zénit.
Los datos visibles son una vista sincronizada; no una garantía de pago bancario.

Los nuevos artículos y el registro de miembros del club se crean con los flujos
existentes del sitio. El POS permite clientes de atención directa sin crearles
cuentas ni enviar correo; esos clientes no reciben puntos hasta vincularse con
una cuenta registrada. Los costos, impuestos, caja y CXC pertenecen al POS.
Las referencias y comprobantes son de control interno, no facturas electrónicas.

## Acceso POS

`python -m app.pos.provision_zenit` inspecciona negocio/cuenta sin escribir.
`--apply` asocia exclusivamente a Zénit el rol real `owner`; no da permisos CEO.
La activación es de un solo uso, vence en 24 horas y guarda solamente el hash.
Puede usarse `--token-env ZENIT_POS_ACTIVATION_TOKEN` para evitar imprimir secretos.
La dueña elige una contraseña propia; no se reutiliza la de zenitsalon.com.

## Validación

Se incluyen pruebas de transacciones, inventario reservado, puntos por factura,
crédito, reversión, reintentos y carreras por la última unidad. Para ejecutarlas,
`TEST_DATABASE_URL` debe apuntar exclusivamente a una base aislada con migraciones
aplicadas. No ejecutar pruebas de creación de datos contra producción.


## Revisión de compatibilidad del 27 de octubre de 2026

Esta versión incorpora el commit af671ee del backend Zénit y conserva el modelo
EmailDelivery, responseMessage, proposedStartAt, proposedEndAt y proposalAppointmentId.
Las rutas públicas de reserva, disponibilidad y aceptación de propuesta se mantienen.
El POS acepta responseMessage/proposedDate/proposedTime y utiliza la misma transacción
que el sitio para guardar la decisión y encolar su aviso. La clienta acepta la
propuesta desde su cuenta, sin generar una agenda paralela ni reservar anticipadamente.
No cambiar las variables de correo/Resend ni reemplazar el trabajador de correo.
