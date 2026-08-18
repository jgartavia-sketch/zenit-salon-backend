import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pointsFromColones } from "../lib/points.js";
import { publicUser } from "../lib/public-user.js";
import { requireAdminKey } from "../middleware/auth.js";

const router = Router();
router.use(requireAdminKey);

function normalizeSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueProductSlug(name) {
  const base = normalizeSlug(name) || "producto";
  let slug = base;
  let counter = 2;

  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}

async function uniqueCategorySlug(name, excludeId = null) {
  const base = normalizeSlug(name) || "categoria";
  let slug = base;
  let counter = 2;

  while (true) {
    const existing = await prisma.productCategory.findUnique({ where: { slug } });

    if (!existing || existing.id === excludeId) {
      return slug;
    }

    slug = `${base}-${counter}`;
    counter += 1;
  }
}

function productResponse(product) {
  return {
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    description: product.description,
    price: product.price,
    imageUrl: product.imageUrl,
    stock: product.stock,
    available: product.available,
    active: product.active,
    sortOrder: product.sortOrder,
    categoryId: product.categoryId,
    category: product.category
      ? {
          id: product.category.id,
          slug: product.category.slug,
          name: product.category.name,
        }
      : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function categoryResponse(category) {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    active: category.active,
    productCount: category._count?.products ?? 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  CLIENTES                                  */
/* -------------------------------------------------------------------------- */

router.get("/customers", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { customerCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({ customers: users.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

const purchaseSchema = z.object({
  email: z.email().trim().toLowerCase(),
  amountColones: z.coerce.number().int().min(100),
  description: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .default("Compra o servicio confirmado"),
  referenceId: z.string().trim().min(3).max(100).optional(),
});

router.post("/points/purchase", async (req, res, next) => {
  try {
    const input = purchaseSchema.parse(req.body);
    const points = pointsFromColones(input.amountColones);

    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      return res.status(404).json({
        error: "No existe un cliente con ese correo.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: {
          purchasePoints: {
            increment: points,
          },
        },
      });

      await tx.pointMovement.create({
        data: {
          userId: user.id,
          type: "PURCHASE",
          points,
          amountColones: input.amountColones,
          description: input.description,
          referenceId: input.referenceId,
        },
      });

      return result;
    });

    res.json({
      ok: true,
      points,
      customer: publicUser(updated),
    });
  } catch (error) {
    next(error);
  }
});

const adjustmentSchema = z.object({
  email: z.email().trim().toLowerCase(),
  points: z.coerce.number().int().refine((value) => value !== 0),
  description: z.string().trim().min(3).max(200),
});

router.post("/points/adjust", async (req, res, next) => {
  try {
    const input = adjustmentSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      return res.status(404).json({
        error: "No existe un cliente con ese correo.",
      });
    }

    if (user.purchasePoints + input.points < 0) {
      return res.status(400).json({
        error: "El cliente no tiene suficientes puntos.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: {
          purchasePoints: {
            increment: input.points,
          },
        },
      });

      await tx.pointMovement.create({
        data: {
          userId: user.id,
          type: input.points > 0 ? "ADJUSTMENT" : "REDEMPTION",
          points: input.points,
          description: input.description,
        },
      });

      return result;
    });

    res.json({
      ok: true,
      customer: publicUser(updated),
    });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/*                            SOLICITUDES DE SERVICIO                          */
/* -------------------------------------------------------------------------- */

const serviceRequestStatusSchema = z.enum([
  "PENDING",
  "CONTACTED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

router.get("/service-requests", async (req, res, next) => {
  try {
    const status = String(req.query.status || "").trim().toUpperCase();

    const where = status
      ? {
          status: serviceRequestStatusSchema.parse(status),
        }
      : undefined;

    const requests = await prisma.serviceRequest.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    });

    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.patch("/service-requests/:id/status", async (req, res, next) => {
  try {
    const status = serviceRequestStatusSchema.parse(req.body.status);

    const request = await prisma.serviceRequest.update({
      where: {
        id: req.params.id,
      },
      data: {
        status,
      },
    });

    res.json({
      ok: true,
      request,
    });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/*                            CATEGORÍAS DE PRODUCTOS                          */
/* -------------------------------------------------------------------------- */

router.get("/product-categories", async (_req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
      orderBy: [
        {
          sortOrder: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    res.json({
      categories: categories.map(categoryResponse),
    });
  } catch (error) {
    next(error);
  }
});

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z
    .union([z.string().trim().max(500), z.null()])
    .optional()
    .default(null),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
});

router.post("/product-categories", async (req, res, next) => {
  try {
    const input = createCategorySchema.parse(req.body);
    const slug = await uniqueCategorySlug(input.name);

    const category = await prisma.productCategory.create({
      data: {
        slug,
        name: input.name,
        description: input.description || null,
        sortOrder: input.sortOrder,
        active: input.active,
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    res.status(201).json({
      ok: true,
      category: categoryResponse(category),
    });
  } catch (error) {
    next(error);
  }
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z
    .union([z.string().trim().max(500), z.null()])
    .optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

router.patch("/product-categories/:id", async (req, res, next) => {
  try {
    const input = updateCategorySchema.parse(req.body);

    const current = await prisma.productCategory.findUnique({
      where: {
        id: req.params.id,
      },
    });

    if (!current) {
      return res.status(404).json({
        error: "Categoría no encontrada.",
      });
    }

    const data = {
      ...(input.description !== undefined
        ? {
            description: input.description || null,
          }
        : {}),
      ...(input.sortOrder !== undefined
        ? {
            sortOrder: input.sortOrder,
          }
        : {}),
      ...(input.active !== undefined
        ? {
            active: input.active,
          }
        : {}),
    };

    if (input.name !== undefined) {
      data.name = input.name;
      data.slug = await uniqueCategorySlug(input.name, current.id);
    }

    const category = await prisma.productCategory.update({
      where: {
        id: req.params.id,
      },
      data,
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    res.json({
      ok: true,
      category: categoryResponse(category),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/product-categories/:id", async (req, res, next) => {
  try {
    const category = await prisma.productCategory.findUnique({
      where: {
        id: req.params.id,
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        error: "Categoría no encontrada.",
      });
    }

    if (category._count.products > 0) {
      return res.status(409).json({
        error:
          "No podés eliminar una categoría que todavía contiene productos. Mové o eliminá esos productos primero.",
      });
    }

    await prisma.productCategory.delete({
      where: {
        id: req.params.id,
      },
    });

    res.json({
      ok: true,
      deletedCategoryId: req.params.id,
    });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/*                                  PRODUCTOS                                 */
/* -------------------------------------------------------------------------- */

router.get("/products", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const categoryId = String(req.query.categoryId || "").trim();

    const products = await prisma.product.findMany({
      where: {
        ...(categoryId
          ? {
              categoryId,
            }
          : {}),
        ...(q
          ? {
              OR: [
                {
                  name: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                {
                  brand: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                {
                  sku: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        category: true,
      },
      orderBy: [
        {
          sortOrder: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    res.json({
      products: products.map(productResponse),
    });
  } catch (error) {
    next(error);
  }
});

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().min(1).max(100),
  description: z.string().trim().min(3).max(1000),
  price: z.coerce.number().int().min(0),
  imageUrl: z.string().trim().min(1).max(500),
  stock: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional()
    .default(null),
  sku: z.string().trim().min(1).max(80).optional().nullable(),
  available: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  categoryId: z.string().trim().min(1),
});

router.post("/products", async (req, res, next) => {
  try {
    const input = createProductSchema.parse(req.body);

    const category = await prisma.productCategory.findUnique({
      where: {
        id: input.categoryId,
      },
    });

    if (!category) {
      return res.status(404).json({
        error: "La categoría seleccionada no existe.",
      });
    }

    const slug = await uniqueProductSlug(input.name);

    const product = await prisma.product.create({
      data: {
        slug,
        sku: input.sku || null,
        name: input.name,
        brand: input.brand,
        description: input.description,
        price: input.price,
        imageUrl: input.imageUrl,
        stock: input.stock,
        available: input.available,
        active: input.active,
        sortOrder: input.sortOrder,
        categoryId: input.categoryId,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json({
      ok: true,
      product: productResponse(product),
    });
  } catch (error) {
    next(error);
  }
});

const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  brand: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(3).max(1000).optional(),
  price: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().trim().min(1).max(500).optional(),
  stock: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional(),
  sku: z.string().trim().min(1).max(80).optional().nullable(),
  available: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  categoryId: z.string().trim().min(1).optional(),
});

router.patch("/products/:id", async (req, res, next) => {
  try {
    const input = updateProductSchema.parse(req.body);

    const current = await prisma.product.findUnique({
      where: {
        id: req.params.id,
      },
    });

    if (!current) {
      return res.status(404).json({
        error: "Producto no encontrado.",
      });
    }

    if (input.categoryId) {
      const category = await prisma.productCategory.findUnique({
        where: {
          id: input.categoryId,
        },
      });

      if (!category) {
        return res.status(404).json({
          error: "La categoría seleccionada no existe.",
        });
      }
    }

    const product = await prisma.product.update({
      where: {
        id: req.params.id,
      },
      data: {
        ...(input.name !== undefined
          ? {
              name: input.name,
            }
          : {}),
        ...(input.brand !== undefined
          ? {
              brand: input.brand,
            }
          : {}),
        ...(input.description !== undefined
          ? {
              description: input.description,
            }
          : {}),
        ...(input.price !== undefined
          ? {
              price: input.price,
            }
          : {}),
        ...(input.imageUrl !== undefined
          ? {
              imageUrl: input.imageUrl,
            }
          : {}),
        ...(input.stock !== undefined
          ? {
              stock: input.stock,
            }
          : {}),
        ...(input.sku !== undefined
          ? {
              sku: input.sku || null,
            }
          : {}),
        ...(input.available !== undefined
          ? {
              available: input.available,
            }
          : {}),
        ...(input.active !== undefined
          ? {
              active: input.active,
            }
          : {}),
        ...(input.sortOrder !== undefined
          ? {
              sortOrder: input.sortOrder,
            }
          : {}),
        ...(input.categoryId !== undefined
          ? {
              categoryId: input.categoryId,
            }
          : {}),
      },
      include: {
        category: true,
      },
    });

    res.json({
      ok: true,
      product: productResponse(product),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:id", async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: {
        id: req.params.id,
      },
    });

    if (!product) {
      return res.status(404).json({
        error: "Producto no encontrado.",
      });
    }

    await prisma.product.delete({
      where: {
        id: req.params.id,
      },
    });

    res.json({
      ok: true,
      deletedProductId: req.params.id,
    });
  } catch (error) {
    next(error);
  }
});

export default router;