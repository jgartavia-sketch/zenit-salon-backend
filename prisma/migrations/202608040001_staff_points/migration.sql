CREATE TABLE "StaffAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PointMovement"
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "createdByStaffId" TEXT;

CREATE UNIQUE INDEX "StaffAccount_email_key" ON "StaffAccount"("email");
CREATE INDEX "StaffAccount_active_idx" ON "StaffAccount"("active");
CREATE UNIQUE INDEX "PointMovement_invoiceNumber_key" ON "PointMovement"("invoiceNumber");
CREATE INDEX "PointMovement_createdByStaffId_createdAt_idx" ON "PointMovement"("createdByStaffId", "createdAt");

ALTER TABLE "PointMovement"
ADD CONSTRAINT "PointMovement_createdByStaffId_fkey"
FOREIGN KEY ("createdByStaffId") REFERENCES "StaffAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;