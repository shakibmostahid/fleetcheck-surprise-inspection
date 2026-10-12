-- DropIndex
DROP INDEX "vehicles_company_id_status_is_deleted_idx";

-- CreateIndex
CREATE INDEX "vehicles_company_id_is_deleted_idx" ON "vehicles"("company_id", "is_deleted");
