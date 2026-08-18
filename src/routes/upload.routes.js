import { Router } from "express";
import multer from "multer";
import { requireAdminKey } from "../middleware/auth.js";
import { uploadProductImage } from "../lib/cloudinary.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ];

    if (!allowed.includes(file.mimetype)) {
      callback(
        new Error(
          "Formato no permitido. Usá JPG, PNG, WEBP o AVIF.",
        ),
      );
      return;
    }

    callback(null, true);
  },
});

router.use(requireAdminKey);

router.post("/product-image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Debés seleccionar una imagen.",
      });
    }

    const originalName = req.file.originalname
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "producto";

    const result = await uploadProductImage(
      req.file.buffer,
      originalName,
    );

    res.status(201).json({
      ok: true,
      image: result,
    });
  } catch (error) {
    next(error);
  }
});

export default router;