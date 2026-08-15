import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/products", async (_req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    res.json({
      categories: categories.map((category) => ({
        id: category.slug,
        name: category.name,
        description: category.description,
        products: category.products.map((product) => ({
          id: product.slug,
          name: product.name,
          brand: product.brand,
          category: category.name,
          price: product.price,
          description: product.description,
          image: product.imageUrl,
          stock: product.stock,
          available:
            product.available && (product.stock === null || product.stock > 0),
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/services", async (_req, res, next) => {
  try {
    const categories = await prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        services: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    res.json({
      categories: categories.map((category) => ({
        id: category.slug,
        name: category.name,
        eyebrow: category.eyebrow,
        description: category.description,
        services: category.services.map((service) => ({
          id: service.slug,
          name: service.name,
          category: category.name,
          mode: service.mode === "QUOTE" ? "quote" : "reserve",
          price: service.price,
          durationMinutes: service.durationMinutes,
          note: service.note,
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;