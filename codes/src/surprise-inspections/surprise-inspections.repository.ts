import { Injectable } from '@nestjs/common';
import { Prisma, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEntry } from './interfaces/audit-entry.interface';
import { NewSelection } from './interfaces/new-selection.interface';
import { SelectionResult } from './interfaces/selection-result.interface';

/** Either the normal client or a client inside a transaction. */
type Db = Prisma.TransactionClient;

/** Postgres allows 65,535 bind parameters per query; 5,000 rows stays far below that. */
const SNAPSHOT_BATCH_SIZE = 5_000;

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

  async findEligibleVehicleIds(tx: Db, companyId: string): Promise<string[]> {
    const vehicles = await tx.vehicle.findMany({
      where: { companyId, status: VehicleStatus.active, isDeleted: false },
      select: { id: true },
    });
    return vehicles.map((vehicle) => vehicle.id);
  }

  /** Saves the selection and a snapshot of every eligible vehicle (picked or not). */
  async createSelection(tx: Db, selection: NewSelection, result: SelectionResult) {
    const created = await tx.surpriseInspection.create({
      data: {
        ...selection,
        eligibleCount: result.eligibleIds.length,
        selectedCount: result.selectedIds.length,
      },
    });

    const selected = new Set(result.selectedIds);
    for (let start = 0; start < result.eligibleIds.length; start += SNAPSHOT_BATCH_SIZE) {
      const batch = result.eligibleIds.slice(start, start + SNAPSHOT_BATCH_SIZE);
      await tx.surpriseInspectionVehicle.createMany({
        data: batch.map((vehicleId) => ({
          surpriseInspectionId: created.id,
          vehicleId,
          isSelected: selected.has(vehicleId),
        })),
      });
    }

    return created;
  }

  findSelectedVehicles(surpriseInspectionId: string) {
    return this.prisma.vehicle.findMany({
      where: { surpriseInspectionsVehicles: { some: { surpriseInspectionId, isSelected: true } } },
      select: { id: true, registrationNo: true },
      orderBy: { registrationNo: 'asc' },
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
