import { Injectable } from '@nestjs/common';
import { InspectionStatus, InspectionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEntry } from './interfaces/audit-entry.interface';
import { NewSelection } from './interfaces/new-selection.interface';
import { SelectionResult } from './interfaces/selection-result.interface';

/** Either the normal client or a client inside a transaction. */
type Db = Prisma.TransactionClient;

/** Postgres allows 65,535 bind parameters per query; 5,000 rows stays far below that. */
const BATCH_SIZE = 5_000;

/** Long enough to snapshot a 200,000-vehicle fleet. */
const TRANSACTION_TIMEOUT_MS = 120_000;

@Injectable()
export class SurpriseInspectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  runInTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { timeout: TRANSACTION_TIMEOUT_MS });
  }

  /**
   * Blocks other transactions for the same company and quarter until this one
   * ends, so two simultaneous requests cannot both create a selection.
   */
  async lockCompanyQuarter(tx: Db, companyId: string, quarter: string): Promise<void> {
    const lockKey = `surprise-inspection:${companyId}:${quarter}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  findCompany(companyId: string) {
    return this.prisma.company.findUnique({ where: { id: companyId } });
  }

  findSelection(companyId: string, quarter: string, db: Db = this.prisma) {
    return db.surpriseInspection.findUnique({
      where: { companyId_quarter: { companyId, quarter } },
    });
  }

  /**
   * Every vehicle the company still has, active or inactive. Inactive vehicles stay
   * eligible so a company can't avoid a surprise inspection by deactivating a vehicle.
   * Only soft-deleted vehicles are left out.
   */
  async findEligibleVehicleIds(tx: Db, companyId: string): Promise<string[]> {
    const vehicles = await tx.vehicle.findMany({
      where: { companyId, isDeleted: false },
      select: { id: true },
    });
    return vehicles.map((vehicle) => vehicle.id);
  }

  /**
   * Saves the selection, a pending surprise inspection for every picked vehicle,
   * and a snapshot of every eligible vehicle (picked or not) linked to its inspection.
   */
  async createSelection(tx: Db, selection: NewSelection, result: SelectionResult) {
    const created = await tx.surpriseInspection.create({
      data: {
        ...selection,
        eligibleCount: result.eligibleIds.length,
        selectedCount: result.selectedIds.length,
      },
    });

    const inspectionIds = await this.createSurpriseInspections(
      tx,
      selection.companyId,
      result.selectedIds,
    );

    for (const batch of inBatches(result.eligibleIds)) {
      await tx.surpriseInspectionVehicle.createMany({
        data: batch.map((vehicleId) => ({
          surpriseInspectionId: created.id,
          vehicleId,
          isSelected: inspectionIds.has(vehicleId),
          inspectionId: inspectionIds.get(vehicleId) ?? null,
        })),
      });
    }

    return created;
  }

  /** Creates one pending surprise inspection per vehicle. Returns vehicleId -> inspectionId. */
  private async createSurpriseInspections(
    tx: Db,
    companyId: string,
    vehicleIds: string[],
  ): Promise<Map<string, string>> {
    const inspectionIds = new Map<string, string>();

    for (const batch of inBatches(vehicleIds)) {
      const inspections = await tx.inspection.createManyAndReturn({
        data: batch.map((vehicleId) => ({
          companyId,
          vehicleId,
          type: InspectionType.surprise,
          status: InspectionStatus.pending,
        })),
        select: { id: true, vehicleId: true },
      });
      inspections.forEach(({ id, vehicleId }) => inspectionIds.set(vehicleId, id));
    }

    return inspectionIds;
  }

  /** The picked vehicles with their surprise inspection, sorted by registration number. */
  findSelectedVehicles(surpriseInspectionId: string) {
    return this.prisma.surpriseInspectionVehicle.findMany({
      where: { surpriseInspectionId, isSelected: true },
      select: {
        vehicle: { select: { id: true, registrationNo: true } },
        inspection: { select: { id: true, status: true, result: true } },
      },
      orderBy: { vehicle: { registrationNo: 'asc' } },
    });
  }

  findSnapshot(surpriseInspectionId: string) {
    return this.prisma.surpriseInspectionVehicle.findMany({
      where: { surpriseInspectionId },
      select: { vehicleId: true, isSelected: true },
    });
  }

  async createAuditLog(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({ data: entry });
  }
}

/** Splits a list into chunks small enough for one INSERT. */
function* inBatches<T>(items: T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    yield items.slice(start, start + BATCH_SIZE);
  }
}
