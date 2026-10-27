import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdminKey } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { digest, httpError } from "../lib/security.js";
const router = Router();
router.use(requireAuth);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
router.get(
  "/mine",
  wrap(async (req, res) =>
    res.json({
      orders: await prisma.shopOrder.findMany({
        where: { customerId: req.user.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    }),
  ),
);
router.post(
  "/",
  rateLimit("shop-order", 20, 60),
  wrap(async (req, res) => {
    const input = z
      .object({
        requestKey: z.uuid(),
        expectedTotal: z.number().int().min(0).max(100_000_000),
        items: z
          .array(
            z
              .object({
                slug: z.string().min(1).max(100),
                quantity: z.number().int().min(1).max(99),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict()
      .parse(req.body);
    if (new Set(input.items.map((x) => x.slug)).size !== input.items.length)
      throw httpError(400, "Hay artículos repetidos.");
    const hash = digest({ customerId: req.user.id, ...input });
    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724031)`;
      const old = await tx.shopOrder.findUnique({
        where: { requestKey: input.requestKey },
      });
      if (old) {
        if (old.requestDigest !== hash)
          throw httpError(409, "Pedido repetido con otros datos.");
        return old;
      }
      const pending = await tx.shopOrder.count({
        where: { customerId: req.user.id, status: "PENDING" },
      });
      if (pending >= 3)
        throw httpError(
          409,
          "Ya tenés tres pedidos pendientes. Contactá al salón antes de crear otro.",
        );
      const items = [];
      let total = 0;
      for (const line of [...input.items].sort((a, b) =>
        a.slug.localeCompare(b.slug),
      )) {
        const product = await tx.product.findFirst({
          where: {
            slug: line.slug,
            active: true,
            available: true,
            category: { active: true },
          },
        });
        if (!product)
          throw httpError(
            409,
            "Un producto ya no está disponible. Actualizá el catálogo.",
          );
        if (product.stock !== null) {
          const result = await tx.product.updateMany({
            where: { id: product.id, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (!result.count)
            throw httpError(
              409,
              `No hay suficientes unidades de ${product.name}.`,
            );
        }
        const subtotal = product.price * line.quantity;
        total += subtotal;
        items.push({
          productId: product.id,
          slug: product.slug,
          name: product.name,
          brand: product.brand,
          price: product.price,
          quantity: line.quantity,
          subtotal,
          tracked: product.stock !== null,
        });
      }
      if (total !== input.expectedTotal)
        throw httpError(
          409,
          "El precio del catálogo cambió. Actualizá la tienda antes de confirmar el pedido.",
        );
      if (total > 100_000_000)
        throw httpError(
          400,
          "El pedido supera el monto permitido. Contactá al salón.",
        );
      return tx.shopOrder.create({
        data: {
          customerId: req.user.id,
          requestKey: input.requestKey,
          requestDigest: hash,
          items,
          total,
        },
      });
    });
    res.status(201).json({ order });
  }),
);
export async function cancelOrder(tx, id, customerId) {
  const order = await tx.shopOrder.findFirst({
    where: { id, ...(customerId ? { customerId } : {}), status: "PENDING" },
  });
  if (!order) throw httpError(409, "Ese pedido ya no se puede cancelar.");
  for (const item of order.items) {
    if (item.tracked)
      await tx.product.updateMany({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
  }
  return tx.shopOrder.update({ where: { id }, data: { status: "CANCELLED" } });
}
router.patch(
  "/:id/cancel",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724031)`;
      return cancelOrder(tx, id, req.user.id);
    });
    res.json({ order });
  }),
);
router.use(requireAdminKey);
router.get(
  "/",
  wrap(async (_req, res) => {
    const orders = await prisma.shopOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: orders.map((x) => x.customerId) } },
      select: { id: true, name: true, phone: true, email: true },
    });
    res.json({
      orders: orders.map((x) => ({
        ...x,
        customer: users.find((u) => u.id === x.customerId),
      })),
    });
  }),
);
router.patch(
  "/:id",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { status } = z
      .object({ status: z.enum(["COMPLETED", "CANCELLED"]) })
      .strict()
      .parse(req.body);
    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724031)`;
      const old = await tx.shopOrder.findUnique({ where: { id } });
      if (!old) throw httpError(404, "Pedido no encontrado.");
      if (old.status === status) return old;
      if (old.status !== "PENDING")
        throw httpError(409, "Este pedido ya está cerrado.");
      const result =
        status === "CANCELLED"
          ? await cancelOrder(tx, id)
          : await tx.shopOrder.update({ where: { id }, data: { status } });
      // Points are deliberately recorded by invoice in the existing flow, avoiding double awards with POS.
      await tx.auditEvent.create({
        data: { actorId: req.user.id, action: `ORDER_${status}`, targetId: id },
      });
      return result;
    });
    res.json({ order });
  }),
);
export default router;
