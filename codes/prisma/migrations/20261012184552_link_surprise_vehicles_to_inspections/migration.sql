-- AlterTable
ALTER TABLE "surprise_inspections_vehicles" ADD COLUMN     "inspection_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "surprise_inspections_vehicles_inspection_id_key" ON "surprise_inspections_vehicles"("inspection_id");

-- AddForeignKey
ALTER TABLE "surprise_inspections_vehicles" ADD CONSTRAINT "surprise_inspections_vehicles_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

