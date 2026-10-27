BEGIN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StaffAccount" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AgendaConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "weekly" JSONB NOT NULL DEFAULT '[]',
    "overrides" JSONB NOT NULL DEFAULT '[]',
    "holdHours" INTEGER NOT NULL DEFAULT 24,
    "noticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "services" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "requestKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateBucket_expiresAt_idx" ON "RateBucket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_requestKey_key" ON "Appointment"("requestKey");

-- CreateIndex
CREATE INDEX "Appointment_startAt_endAt_idx" ON "Appointment"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "Appointment_customerId_startAt_idx" ON "Appointment"("customerId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_requestKey_key" ON "ShopOrder"("requestKey");

-- CreateIndex
CREATE INDEX "ShopOrder_customerId_createdAt_idx" ON "ShopOrder"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guard data integrity even if an unexpected client or future route writes invalid data.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_interval_check" CHECK ("endAt" > "startAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_status_check" CHECK ("status" IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED','BLOCKED'));
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_total_check" CHECK ("total" >= 0);
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_status_check" CHECK ("status" IN ('PENDING','COMPLETED','CANCELLED'));
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_price_check" CHECK (("stock" IS NULL OR "stock" >= 0) AND "price" >= 0) NOT VALID;
ALTER TABLE "User" ADD CONSTRAINT "User_points_check" CHECK ("purchasePoints" >= 0 AND "referralPoints" >= 0) NOT VALID;

COMMIT;
