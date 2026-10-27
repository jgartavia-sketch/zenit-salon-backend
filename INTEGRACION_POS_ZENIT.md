# Contrato preparado para el POS

Esta entrega modifica exclusivamente los repositorios Zenit. El puente actual de
System Lab admite `shirleys`; todavía no consume `zenit`. No hay sincronización
activa ni acceso POS aprovisionado para la dueña.

## API de Zenit disponible

Todas las rutas privadas requieren `X-SystemLab-Key` igual a `ZENIT_CONNECT_KEY`
(aleatoria, mínimo 32 caracteres). Sin configuración responden 503. Nunca se
acepta la clave administrativa antigua ni se coloca la clave en el navegador.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/api/pos-connect/catalog` | Productos y servicios activos, con ID y slug estables, stock y duración |
| GET | `/api/pos-connect/appointments?date=YYYY-MM-DD` | Citas de un día para uso interno autorizado; incluye datos privados del salón |

El calendario de Zenit es la fuente de verdad. No hacer copias editables de citas
en dos sistemas: las futuras escrituras desde POS deben usar la misma lógica de
transacción, exclusión de cruces y auditoría de `agenda.routes.js`. Estas rutas de
escritura privadas aún no existen; la dueña administra aquí la agenda mientras
se desarrolla el POS. No reutilizar un JWT de propietaria como credencial servidor.

## Trabajo pendiente en System Lab

- Registrar el proveedor fijo `zenit`, URL verificada y secreto servidor.
- Asociar un único negocio `mode=salon`, con aislamiento por business_id y acceso
  personal de propietaria. No compartir el usuario del salón con otros negocios.
- Implementar escrituras autorizadas de agenda e inventario, identificadores de
  correspondencia e idempotencia. Una venta no puede descontar stock otra vez si
  el pedido de la tienda ya lo apartó.
- Al completar pedidos conservar referencia de factura única para puntos. Una
  factura acreditada por staff/admin no puede premiarse nuevamente desde POS.
- Añadir cuentas por cobrar al núcleo para TODOS los modos: saldo, vencimientos,
  abonos, cuotas, comprobantes, anulaciones auditadas y reportes. Diferenciar
  ingreso de caja por abono del total de una venta ya reconocida.

No habilitar el puente hasta implementar y probar el consumidor de System Lab.
