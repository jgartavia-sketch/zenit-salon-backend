import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const testUrl = process.env.TEST_DATABASE_URL;
// This suite mutates configuration and fixtures: it must run only against a disposable test DB.
test(
  "Integración de seguridad, agenda y pedidos",
  { skip: !testUrl },
  async (t) => {
    const u = new URL(testUrl);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(u.hostname) &&
        u.pathname === "/zenit_test",
      "Usá una BD local desechable llamada zenit_test.",
    );
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET =
      "qa-only-very-long-secret-never-use-in-production-2026";
    const { prisma } = await import("../src/lib/prisma.js");
    const { app } = await import("../src/app.js");
    const { default: bcrypt } = await import("bcryptjs");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(path, method = "GET", body, token, extra = {}) {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    }
    const suffix = randomUUID();
    const password = "Strong-QA-password-2026";
    const hash = await bcrypt.hash(password, 12);
    const users = [];
    for (const role of ["ADMIN", "CUSTOMER", "CUSTOMER"])
      users.push(
        await prisma.user.create({
          data: {
            name: `Private ${users.length}`,
            email: `qa-${users.length}-${suffix}@example.com`,
            phone: "88888888",
            customerCode: randomUUID(),
            role,
            passwordHash: hash,
          },
        }),
      );
    const [owner, a, b] = users;
    const tokens = [];
    for (const x of users) {
      const r = await call("/api/auth/login", "POST", {
        email: x.email,
        password,
      });
      assert.equal(r.status, 200);
      tokens.push(r.body.token);
    }
    const [ot, at, bt] = tokens;
    const cat = await prisma.serviceCategory.create({
      data: {
        name: "QA services",
        slug: suffix,
        eyebrow: "QA",
        description: "QA",
      },
    });
    const service = await prisma.salonService.create({
      data: {
        name: "QA Cut",
        slug: `qa-${suffix}`,
        mode: "RESERVE",
        price: 5000,
        durationMinutes: 60,
        categoryId: cat.id,
      },
    });
    const category = await prisma.productCategory.create({
      data: { name: "QA", slug: suffix },
    });
    const product = await prisma.product.create({
      data: {
        slug: `p-${suffix}`,
        name: "QA product",
        brand: "QA",
        description: "QA product",
        price: 2500,
        imageUrl: "/logo-zenit.png",
        stock: 2,
        categoryId: category.id,
      },
    });
    const date = new Date(Date.now() + 2 * 86400000 - 6 * 3600000)
      .toISOString()
      .slice(0, 10);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const settings = {
      weekly: [{ day: weekday, ranges: [{ start: "09:00", end: "17:00" }] }],
      overrides: [],
      holdHours: 24,
      noticeMinutes: 0,
    };
    const createdUsers = [];
    try {
      await t.test(
        "roles: clave compartida rechazada y cliente sin privilegios",
        async () => {
          assert.equal(
            (
              await call("/api/admin/products", "GET", undefined, undefined, {
                "x-admin-key": "old-key",
              })
            ).status,
            401,
          );
          assert.equal(
            (await call("/api/admin/products", "GET", undefined, at)).status,
            403,
          );
          assert.equal(
            (await call("/api/agenda/settings", "GET", undefined, at)).status,
            403,
          );
          assert.equal(
            (
              await call(
                "/api/agenda/availability?date=" +
                  date +
                  "&services=" +
                  service.slug,
              )
            ).status,
            401,
          );
        },
      );
      await t.test("horario válido y rechazo de turnos cruzados", async () => {
        assert.equal(
          (await call("/api/agenda/settings", "PUT", settings, ot)).status,
          200,
        );
        assert.equal(
          (
            await call(
              "/api/agenda/settings",
              "PUT",
              {
                ...settings,
                weekly: [
                  {
                    day: weekday,
                    ranges: [
                      { start: "09:00", end: "12:00" },
                      { start: "11:00", end: "13:00" },
                    ],
                  },
                ],
              },
              ot,
            )
          ).status,
          400,
        );
      });
      await t.test("disponibilidad privada y duración real", async () => {
        const r = await call(
          `/api/agenda/availability?date=${date}&services=${service.slug}`,
          "GET",
          undefined,
          at,
        );
        assert.equal(r.status, 200);
        assert.equal(r.body.durationMinutes, 60);
        assert.ok(r.body.slots.some((s) => s.time === "09:00" && s.available));
        assert.ok(!JSON.stringify(r.body).includes("Private"));
        assert.deepEqual(Object.keys(r.body.slots[0]).sort(), [
          "available",
          "endAt",
          "startAt",
          "time",
        ]);
      });
      let appointment;
      await t.test(
        "reservas simultáneas: un solo ganador y reintento idempotente",
        async () => {
          const one = {
            date,
            time: "09:00",
            services: [service.slug],
            notes: "Private notes",
            requestKey: randomUUID(),
          };
          const two = { ...one, requestKey: randomUUID() };
          const results = await Promise.all([
            call("/api/agenda/appointments", "POST", one, at),
            call("/api/agenda/appointments", "POST", two, bt),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          const idx = results.findIndex((r) => r.status === 201);
          appointment = {
            ...results[idx].body.appointment,
            token: idx === 0 ? at : bt,
            other: idx === 0 ? bt : at,
          };
          const retry = await call(
            "/api/agenda/appointments",
            "POST",
            idx === 0 ? one : two,
            appointment.token,
          );
          assert.equal(retry.body.appointment.id, appointment.id);
          const availability = await call(
            `/api/agenda/availability?date=${date}&services=${service.slug}`,
            "GET",
            undefined,
            bt,
          );
          assert.equal(
            availability.body.slots.find((s) => s.time === "09:00").available,
            false,
          );
          assert.ok(
            !JSON.stringify(availability.body).includes("Private notes"),
          );
        },
      );
      await t.test(
        "cancelar cita ajena se rechaza; reprogramación y liberación",
        async () => {
          assert.equal(
            (
              await call(
                `/api/agenda/appointments/${appointment.id}/cancel`,
                "PATCH",
                undefined,
                appointment.other,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/api/agenda/appointments/${appointment.id}`,
                "PATCH",
                { date, time: "11:00", status: "CONFIRMED" },
                ot,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/api/agenda/appointments/${appointment.id}/cancel`,
                "PATCH",
                undefined,
                appointment.token,
              )
            ).status,
            200,
          );
          const r = await call(
            `/api/agenda/availability?date=${date}&services=${service.slug}`,
            "GET",
            undefined,
            at,
          );
          assert.equal(
            r.body.slots.find((s) => s.time === "11:00").available,
            true,
          );
        },
      );
      await t.test("bloqueos y cierre excepcional", async () => {
        const r = await call(
          "/api/agenda/manual",
          "POST",
          {
            date,
            time: "13:00",
            durationMinutes: 60,
            customerName: "Private break",
            blocked: true,
            requestKey: randomUUID(),
          },
          ot,
        );
        assert.equal(r.status, 201);
        const slots = (
          await call(
            `/api/agenda/availability?date=${date}&services=${service.slug}`,
            "GET",
            undefined,
            at,
          )
        ).body.slots;
        assert.equal(slots.find((x) => x.time === "13:00").available, false);
        assert.equal(
          (
            await call(
              "/api/agenda/settings",
              "PUT",
              { ...settings, overrides: [{ date, ranges: [] }] },
              ot,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              `/api/agenda/availability?date=${date}&services=${service.slug}`,
              "GET",
              undefined,
              at,
            )
          ).body.slots.length,
          0,
        );
        await call("/api/agenda/settings", "PUT", settings, ot);
      });
      await t.test(
        "solicitudes vencidas liberan cupo y no pueden confirmarse",
        async () => {
          const r = await call(
            "/api/agenda/appointments",
            "POST",
            {
              date,
              time: "10:00",
              services: [service.slug],
              requestKey: randomUUID(),
            },
            at,
          );
          assert.equal(r.status, 201);
          await prisma.appointment.update({
            where: { id: r.body.appointment.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal(
            (
              await call(
                `/api/agenda/appointments/${r.body.appointment.id}`,
                "PATCH",
                { status: "CONFIRMED" },
                ot,
              )
            ).status,
            409,
          );
          const x = await call(
            `/api/agenda/availability?date=${date}&services=${service.slug}`,
            "GET",
            undefined,
            at,
          );
          assert.equal(
            x.body.slots.find((s) => s.time === "10:00").available,
            true,
          );
        },
      );
      let order;
      await t.test(
        "pedido calcula precio en servidor y no acepta precio manipulado",
        async () => {
          assert.equal(
            (
              await call(
                "/api/orders",
                "POST",
                {
                  requestKey: randomUUID(),
                  expectedTotal: 1,
                  items: [{ slug: product.slug, quantity: 1, price: 1 }],
                },
                at,
              )
            ).status,
            400,
          );
          const input = {
            requestKey: randomUUID(),
            expectedTotal: 5000,
            items: [{ slug: product.slug, quantity: 2 }],
          };
          const r = await call("/api/orders", "POST", input, at);
          assert.equal(r.status, 201);
          order = r.body.order;
          assert.equal(order.total, 5000);
          assert.equal(
            (await call("/api/orders", "POST", input, at)).body.order.id,
            order.id,
          );
          assert.equal(
            (await prisma.product.findUnique({ where: { id: product.id } }))
              .stock,
            0,
          );
          assert.equal(
            (
              await call(
                "/api/orders",
                "POST",
                {
                  requestKey: randomUUID(),
                  expectedTotal: 2500,
                  items: [{ slug: product.slug, quantity: 1 }],
                },
                bt,
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        "cancelar pedido devuelve stock una vez, con aislamiento de clientes",
        async () => {
          assert.equal(
            (
              await call(
                `/api/orders/${order.id}/cancel`,
                "PATCH",
                undefined,
                bt,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/api/orders/${order.id}/cancel`,
                "PATCH",
                undefined,
                at,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/api/orders/${order.id}/cancel`,
                "PATCH",
                undefined,
                at,
              )
            ).status,
            409,
          );
          assert.equal(
            (await prisma.product.findUnique({ where: { id: product.id } }))
              .stock,
            2,
          );
        },
      );
      await t.test(
        "completar pedido no duplica puntos; no admite reversión arbitraria",
        async () => {
          const r = await call(
            "/api/orders",
            "POST",
            {
              requestKey: randomUUID(),
              expectedTotal: 2500,
              items: [{ slug: product.slug, quantity: 1 }],
            },
            at,
          );
          const id = r.body.order.id;
          assert.equal(
            (
              await call(
                `/api/orders/${id}`,
                "PATCH",
                { status: "COMPLETED" },
                ot,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/api/orders/${id}`,
                "PATCH",
                { status: "COMPLETED" },
                ot,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/api/orders/${id}`,
                "PATCH",
                { status: "CANCELLED" },
                ot,
              )
            ).status,
            409,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: a.id } }))
              .purchasePoints,
            0,
          );
        },
      );
      await t.test(
        "consumo concurrente de referido: se recompensa una sola vez",
        async () => {
          const code = await prisma.referralCode.create({
            data: {
              code: randomUUID().slice(0, 8).toUpperCase(),
              ownerId: a.id,
              expiresAt: new Date(Date.now() + 86400000),
            },
          });
          const payload = (n) => ({
            name: "Referral QA",
            phone: "88888888",
            email: `ref-${n}-${suffix}@example.com`,
            password,
            referral: code.code,
          });
          const result = await Promise.all([
            call("/api/auth/register", "POST", payload(1)),
            call("/api/auth/register", "POST", payload(2)),
          ]);
          assert.deepEqual(result.map((x) => x.status).sort(), [201, 409]);
          for (const x of result)
            if (x.status === 201) createdUsers.push(x.body.customer.id);
          assert.equal(
            (await prisma.user.findUnique({ where: { id: a.id } }))
              .referralCount,
            1,
          );
        },
      );
      await t.test(
        "factura única entre administración y personal",
        async () => {
          const staff = await prisma.staffAccount.create({
            data: {
              name: "QA staff",
              email: `staff-${suffix}@example.com`,
              passwordHash: hash,
            },
          });
          const login = await call("/api/staff/login", "POST", {
            email: staff.email,
            password,
          });
          assert.equal(login.status, 200);
          const invoice = `QA-${suffix}`;
          assert.equal(
            (
              await call(
                "/api/admin/points/purchase",
                "POST",
                {
                  email: a.email,
                  amountColones: 1000,
                  referenceId: invoice,
                  description: "Factura QA",
                },
                ot,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                "/api/staff/points",
                "POST",
                {
                  customerId: a.id,
                  amountColones: 1000,
                  invoiceNumber: invoice.toLowerCase(),
                  description: "Factura QA",
                },
                login.body.token,
              )
            ).status,
            409,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: a.id } }))
              .purchasePoints,
            10,
          );
        },
      );
      await t.test("archivo falso y puente privado protegidos", async () => {
        const form = new FormData();
        form.append(
          "image",
          new Blob(["not a PNG"], { type: "image/png" }),
          "fake.png",
        );
        const response = await fetch(base + "/api/uploads/product-image", {
          method: "POST",
          headers: { Authorization: `Bearer ${ot}` },
          body: form,
        });
        assert.equal(response.status, 400);
        assert.equal((await call("/api/pos-connect/catalog")).status, 503);
        const forged = ot.slice(0, -8) + "00000000";
        assert.equal(
          (await call("/api/admin/products", "GET", undefined, forged)).status,
          401,
        );
      });
      await t.test(
        "errores internos no exponen detalles de Prisma",
        async () => {
          const r = await call(
            "/api/admin/products/not-a-product",
            "PATCH",
            { name: "Test" },
            ot,
          );
          assert.equal(r.status, 404);
          assert.ok(!JSON.stringify(r.body).includes("prisma"));
        },
      );
      await t.test(
        "logout revoca token y desactivar revoca acceso",
        async () => {
          assert.equal(
            (await call("/api/auth/logout", "POST", undefined, bt)).status,
            200,
          );
          assert.equal(
            (await call("/api/auth/me", "GET", undefined, bt)).status,
            401,
          );
          assert.equal(
            (
              await call(
                `/api/admin/customers/${a.id}`,
                "DELETE",
                undefined,
                ot,
              )
            ).status,
            200,
          );
          assert.equal(
            (await call("/api/auth/me", "GET", undefined, at)).status,
            401,
          );
          assert.equal(
            (
              await call("/api/auth/login", "POST", {
                email: a.email,
                password,
              })
            ).status,
            401,
          );
        },
      );
      await t.test("limitación persistente por cuenta", async () => {
        let r;
        for (let i = 0; i < 14; i++)
          r = await call("/api/auth/login", "POST", {
            email: `missing-${suffix}@example.com`,
            password: "incorrect",
          });
        assert.equal(r.status, 429);
      });
    } finally {
      await new Promise((r) => server.close(r));
      await prisma.$disconnect();
    }
  },
);
