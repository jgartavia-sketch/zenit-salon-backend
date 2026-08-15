import "dotenv/config";
import { prisma } from "../lib/prisma.js";

const productCategories = [
  {
    slug: "shampoo",
    name: "Shampoo",
    sortOrder: 10,
    products: [
      {
        slug: "yoorganic-moisturizing-shampoo",
        name: "Moisturizing Shampoo",
        brand: "YOORGANIC",
        price: 1000,
        description:
          "Shampoo profesional de enfoque hidratante para cabello seco o sensibilizado. Ayuda a mantener una apariencia suave, manejable y con brillo dentro de la rutina capilar.",
        imageUrl: "/images/productos/yoorganic-moisturizing-shampoo.png",
        sortOrder: 10,
      },
      {
        slug: "yoorganic-nourishing-shampoo",
        name: "Nourishing Shampoo",
        brand: "YOORGANIC",
        price: 1000,
        description:
          "Shampoo nutritivo para complementar rutinas de cuidado profesional, especialmente en cabellos que necesitan suavidad, manejabilidad y una apariencia saludable.",
        imageUrl: "/images/productos/yoorganic-nourishing-shampoo.png",
        sortOrder: 20,
      },
      {
        slug: "nevada-silver-shampoo",
        name: "Silver Shampoo",
        brand: "Nevada Professional",
        price: 1000,
        description:
          "Shampoo tipo silver pensado para el mantenimiento cosmético de cabellos claros, grises o decolorados. Ideal para una rutina de cuidado orientada a mantener una apariencia fría y uniforme.",
        imageUrl: "/images/productos/nevada-silver-shampoo.png",
        sortOrder: 30,
      },
    ],
  },
  {
    slug: "aceites-serums",
    name: "Aceites y sérums",
    sortOrder: 20,
    products: [
      {
        slug: "yoorganic-nourishing-oil",
        name: "Nourishing Oil",
        brand: "YOORGANIC",
        price: 1000,
        description:
          "Aceite capilar de acabado para medios y puntas. Ayuda a aportar brillo, suavidad y una apariencia más pulida dentro de la rutina diaria o profesional.",
        imageUrl: "/images/productos/yoorganic-nourishing-oil.png",
        sortOrder: 10,
      },
      {
        slug: "karseell-maca-essence-oil",
        name: "Maca Essence Oil",
        brand: "Karseell",
        price: 1000,
        description:
          "Aceite capilar pensado para aportar nutrición, brillo, hidratación y control del frizz. Puede aplicarse principalmente en medios y puntas para complementar el acabado del cabello.",
        imageUrl: "/images/productos/karseell-maca-essence-oil.png",
        sortOrder: 20,
      },
    ],
  },
  {
    slug: "tratamientos-productos",
    name: "Tratamientos",
    sortOrder: 30,
    products: [
      {
        slug: "yoorganic-protein-hair-repairing-liquid",
        name: "Protein Hair Repairing Liquid",
        brand: "YOORGANIC",
        price: 1000,
        description:
          "Tratamiento capilar líquido orientado al cuidado del cabello sensibilizado. Puede integrarse a una rutina profesional enfocada en mejorar suavidad, apariencia y manejabilidad.",
        imageUrl: "/images/productos/yoorganic-protein-hair-repairing-liquid.png",
        sortOrder: 10,
      },
      {
        slug: "nevada-leave-in-thermoactive",
        name: "Leave-in Thermoactive",
        brand: "Nevada Professional",
        price: 1000,
        description:
          "Tratamiento sin enjuague pensado para acompañar el peinado y la preparación del cabello antes del secado o del uso de herramientas térmicas.",
        imageUrl: "/images/productos/nevada-leave-in-thermoactive.png",
        sortOrder: 20,
      },
    ],
  },
  {
    slug: "proteccion-termica",
    name: "Protección térmica",
    sortOrder: 40,
    products: [
      {
        slug: "wella-eimi-thermal-image",
        name: "EIMI Thermal Image",
        brand: "Wella Professionals",
        price: 1000,
        description:
          "Spray de protección térmica diseñado para utilizarse antes del estilizado con herramientas de calor. Complementa el peinado profesional y ayuda a mantener un acabado pulido.",
        imageUrl: "/images/productos/wella-eimi-thermal-image.png",
        sortOrder: 10,
      },
    ],
  },
];

const serviceCategories = [
  {
    slug: "cortes",
    name: "Cortes",
    eyebrow: "Precio fijo",
    description:
      "Todos los cortes tienen un precio fijo de ₡5.000 e incluyen lavado, secado y planchado.",
    sortOrder: 10,
    services: [
      ["corte-recto", "Corte recto", "RESERVE", 5000, 10],
      ["corte-v", "Corte en V", "RESERVE", 5000, 20],
      ["corte-mariposa", "Corte mariposa", "RESERVE", 5000, 30],
      ["corte-capas", "Corte en capas", "RESERVE", 5000, 40],
      ["corte-pixie", "Corte pixie", "RESERVE", 5000, 50],
      ["corte-bob-chanel", "Corte bob o chanel", "RESERVE", 5000, 60],
      ["corte-clasico-hombre", "Corte clásico de hombre", "RESERVE", 5000, 70],
    ],
  },
  {
    slug: "tratamientos-capilares",
    name: "Tratamientos capilares",
    eyebrow: "Cotización personalizada",
    description:
      "Seleccioná uno o varios tratamientos y Zénit te cotizará según largo, cantidad de cabello y valoración.",
    sortOrder: 20,
    services: [
      ["velo-brillo", "Velo de brillo", "QUOTE", null, 10],
      ["aminoacidos", "Aminoácidos", "QUOTE", null, 20],
      ["tratamiento-danos", "Tratamiento de daños", "QUOTE", null, 30],
      ["botox-alisante", "Botox alisante", "QUOTE", null, 40],
      ["botox-humectante", "Botox humectante", "QUOTE", null, 50],
      ["celulas-madres", "Células madres", "QUOTE", null, 60],
      ["keratina", "Keratina", "QUOTE", null, 70],
      ["nanoplastia", "Nanoplastia", "QUOTE", null, 80],
      ["liso-extremo", "Liso extremo", "QUOTE", null, 90],
    ],
  },
  {
    slug: "tintes",
    name: "Tintes",
    eyebrow: "Cotización personalizada",
    description:
      "Elegí una o varias técnicas de color para solicitar una cotización directamente por WhatsApp.",
    sortOrder: 30,
    services: [
      ["tinte-fantasia", "Tinte fantasía", "QUOTE", null, 10],
      ["tinte-global", "Tinte global", "QUOTE", null, 20],
      ["cubrimiento-canas", "Cubrimiento de canas", "QUOTE", null, 30],
      ["mechas-rayitos", "Diseño de mechas y rayitos", "QUOTE", null, 40],
      ["balayage", "Balayage", "QUOTE", null, 50],
      ["morena-iluminada", "Morena iluminada", "QUOTE", null, 60],
    ],
  },
  {
    slug: "lavado-secado-planchado",
    name: "Lavado, secado y planchado",
    eyebrow: "Servicio completo",
    description:
      "También podés reservar lavado, secado y planchado como servicio independiente con tratamiento básico incluido.",
    sortOrder: 40,
    services: [
      [
        "lavado-secado-planchado-tratamiento",
        "Lavado + secado + planchado + tratamiento básico",
        "RESERVE",
        10000,
        10,
        "Tratamiento básico incluido.",
      ],
    ],
  },
];

async function seedProducts() {
  for (const categoryData of productCategories) {
    const category = await prisma.productCategory.upsert({
      where: { slug: categoryData.slug },
      update: {
        name: categoryData.name,
        sortOrder: categoryData.sortOrder,
        active: true,
      },
      create: {
        slug: categoryData.slug,
        name: categoryData.name,
        sortOrder: categoryData.sortOrder,
        active: true,
      },
    });

    for (const product of categoryData.products) {
      await prisma.product.upsert({
        where: { slug: product.slug },
        update: {
          name: product.name,
          brand: product.brand,
          price: product.price,
          description: product.description,
          imageUrl: product.imageUrl,
          sortOrder: product.sortOrder,
          categoryId: category.id,
          available: true,
          active: true,
        },
        create: {
          slug: product.slug,
          name: product.name,
          brand: product.brand,
          price: product.price,
          description: product.description,
          imageUrl: product.imageUrl,
          sortOrder: product.sortOrder,
          categoryId: category.id,
          available: true,
          active: true,
        },
      });
    }
  }
}

async function seedServices() {
  for (const categoryData of serviceCategories) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: categoryData.slug },
      update: {
        name: categoryData.name,
        eyebrow: categoryData.eyebrow,
        description: categoryData.description,
        sortOrder: categoryData.sortOrder,
        active: true,
      },
      create: {
        slug: categoryData.slug,
        name: categoryData.name,
        eyebrow: categoryData.eyebrow,
        description: categoryData.description,
        sortOrder: categoryData.sortOrder,
        active: true,
      },
    });

    for (const [slug, name, mode, price, sortOrder, note = null] of categoryData.services) {
      await prisma.salonService.upsert({
        where: { slug },
        update: {
          name,
          mode,
          price,
          sortOrder,
          note,
          categoryId: category.id,
          active: true,
        },
        create: {
          slug,
          name,
          mode,
          price,
          sortOrder,
          note,
          categoryId: category.id,
          active: true,
        },
      });
    }
  }
}

try {
  await seedProducts();
  await seedServices();
  console.info("Catálogos de Zénit cargados correctamente.");
} finally {
  await prisma.$disconnect();
}