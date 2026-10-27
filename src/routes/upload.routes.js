import { Router } from "express";
import multer from "multer";
import { requireAdminKey } from "../middleware/auth.js";
import { uploadProductImage } from "../lib/cloudinary.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1,
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
        Object.assign(new Error("Formato no permitido. Usá JPG, PNG, WEBP o AVIF."),{status:400}),
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

    const b = req.file.buffer;
    const valid = (req.file.mimetype === 'image/png' && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (req.file.mimetype === 'image/jpeg' && b[0]===255 && b[1]===216 && b[2]===255) ||
      (req.file.mimetype === 'image/webp' && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') ||
      (req.file.mimetype === 'image/avif' && b.toString('ascii',4,8)==='ftyp' && ['avif','avis'].includes(b.toString('ascii',8,12)));
    if (!valid) return res.status(400).json({error:'El contenido no corresponde a una imagen permitida.'});
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