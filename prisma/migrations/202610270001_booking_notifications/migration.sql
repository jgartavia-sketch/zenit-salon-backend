ALTER TABLE "Appointment" ADD COLUMN "responseMessage" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "proposedStartAt" TIMESTAMP(3), ADD COLUMN "proposedEndAt" TIMESTAMP(3),
 ADD COLUMN "proposalAppointmentId" TEXT;
CREATE TABLE "EmailDelivery" (
 "id" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "recipient" TEXT NOT NULL,
 "subject" TEXT NOT NULL, "text" TEXT NOT NULL, "html" TEXT NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3), "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailDelivery_eventKey_key" ON "EmailDelivery"("eventKey");
CREATE INDEX "EmailDelivery_sentAt_nextAttemptAt_idx" ON "EmailDelivery"("sentAt", "nextAttemptAt");
-- Duración inicial de una hora, editable por la propietaria. Nunca sustituye una duración ya configurada.
UPDATE "SalonService" SET "durationMinutes" = 60 WHERE "mode" = 'RESERVE' AND "durationMinutes" IS NULL;
