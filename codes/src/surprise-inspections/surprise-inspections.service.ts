import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Company, CompanyStatus, Prisma, SurpriseInspection } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { isFutureQuarter } from '../common/quarter';
import { CreateSurpriseInspectionDto } from './dto/create-surprise-inspection.dto';
import { FindSurpriseInspectionDto } from './dto/find-surprise-inspection.dto';
import { CreateSelectionResponse } from './interfaces/create-selection-response.interface';
import { SelectedVehicleView } from './interfaces/selected-vehicle-view.interface';
import { SelectionOutcome } from './interfaces/selection-outcome.interface';
import { SelectionView } from './interfaces/selection-view.interface';
import { VerificationResult } from './interfaces/verification-result.interface';
import { ALGORITHM_VERSION, selectVehicles } from './selection/select-vehicles';
import { SurpriseInspectionsRepository } from './surprise-inspections.repository';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class SurpriseInspectionsService {
  constructor(private readonly repository: SurpriseInspectionsRepository) {}

  /**
   * Creates the quarterly selection, or returns the existing one.
   * Running it again for the same company and quarter never creates a second,
   * different selection, even if called at the same moment or with another percentage.
   */
  async create(user: AuthUser, dto: CreateSurpriseInspectionDto): Promise<CreateSelectionResponse> {
    if (isFutureQuarter(dto.quarter)) {
      throw new BadRequestException('Cannot create a selection for a future quarter');
    }
    const company = await this.getCompanyOrThrow(dto.companyId);

    const outcome = await this.repository
      .runInTransaction((tx) => this.createOnce(tx, user, company, dto))
      .catch((error: unknown) => this.returnExistingIfDuplicate(error, dto));

    return { created: outcome.created, selection: await this.toView(outcome.selection) };
  }

  async find({ companyId, quarter }: FindSurpriseInspectionDto): Promise<SelectionView> {
    return this.toView(await this.getSelectionOrThrow(companyId, quarter));
  }

  /** Re-runs the algorithm on the stored snapshot and seed, and checks it gives the stored result. */
  async verify(
    user: AuthUser,
    { companyId, quarter }: FindSurpriseInspectionDto,
  ): Promise<VerificationResult> {
    const selection = await this.getSelectionOrThrow(companyId, quarter);
    if (selection.algorithmVersion !== ALGORITHM_VERSION) {
      throw new UnprocessableEntityException(
        `Selection uses algorithm ${selection.algorithmVersion}, which this server cannot verify`,
      );
    }

    const snapshot = await this.repository.findSnapshot(selection.id);
    const storedSelectedIds = snapshot.filter((row) => row.isSelected).map((row) => row.vehicleId);
    const recomputed = selectVehicles({
      vehicleIds: snapshot.map((row) => row.vehicleId),
      percentage: selection.percentage.toNumber(),
      seed: selection.seed,
    });

    const reproducible =
      snapshot.length === selection.eligibleCount &&
      storedSelectedIds.length === selection.selectedCount &&
      sameIds(storedSelectedIds, recomputed.selectedIds);

    await this.repository.createAuditLog({
      userId: user.id,
      companyId,
      action: 'surprise_inspection.verified',
      details: { surpriseInspectionId: selection.id, quarter, reproducible },
    });

    return {
      reproducible,
      quarter,
      algorithmVersion: selection.algorithmVersion,
      seed: selection.seed,
      percentage: selection.percentage.toNumber(),
      eligibleCount: selection.eligibleCount,
      storedSelectedCount: storedSelectedIds.length,
      recomputedSelectedCount: recomputed.selectedIds.length,
    };
  }

  /**
   * Runs inside one transaction. The advisory lock makes simultaneous requests
   * for the same company and quarter wait here, one at a time.
   */
  private async createOnce(
    tx: Transaction,
    user: AuthUser,
    company: Company,
    { companyId, quarter, percentage }: CreateSurpriseInspectionDto,
  ): Promise<SelectionOutcome> {
    await this.repository.lockCompanyQuarter(tx, companyId, quarter);

    const existing = await this.repository.findSelection(companyId, quarter, tx);
    if (existing) {
      return { created: false, selection: existing };
    }

    assertCanCreateSelection(company, percentage);

    const vehicleIds = await this.repository.findEligibleVehicleIds(tx, companyId);
    const seed = randomBytes(32).toString('hex');
    const result = selectVehicles({ vehicleIds, percentage, seed });

    const selection = await this.repository.createSelection(
      tx,
      {
        companyId,
        quarter,
        percentage,
        seed,
        algorithmVersion: ALGORITHM_VERSION,
        triggeredBy: user.id,
      },
      result,
    );
    await this.repository.createAuditLog(
      {
        userId: user.id,
        companyId,
        action: 'surprise_inspection.created',
        details: {
          surpriseInspectionId: selection.id,
          quarter,
          percentage,
          eligibleCount: result.eligibleIds.length,
          selectedCount: result.selectedIds.length,
        },
      },
      tx,
    );

    return { created: true, selection };
  }

  /**
   * Safety net: the unique (company_id, quarter) constraint caught a duplicate
   * that slipped past the lock. Return the selection that won instead of failing.
   */
  private async returnExistingIfDuplicate(
    error: unknown,
    { companyId, quarter }: FindSurpriseInspectionDto,
  ): Promise<SelectionOutcome> {
    if (isUniqueViolation(error)) {
      const existing = await this.repository.findSelection(companyId, quarter);
      if (existing) {
        return { created: false, selection: existing };
      }
    }
    throw error;
  }

  private async getCompanyOrThrow(companyId: string): Promise<Company> {
    const company = await this.repository.findCompany(companyId);
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private async getSelectionOrThrow(
    companyId: string,
    quarter: string,
  ): Promise<SurpriseInspection> {
    const selection = await this.repository.findSelection(companyId, quarter);
    if (!selection) {
      throw new NotFoundException(`No surprise inspection selection for ${quarter}`);
    }
    return selection;
  }

  private async findSelectedVehicles(surpriseInspectionId: string): Promise<SelectedVehicleView[]> {
    const rows = await this.repository.findSelectedVehicles(surpriseInspectionId);
    return rows.map(({ vehicle, inspection }) => ({ ...vehicle, inspection }));
  }

  private async toView(selection: SurpriseInspection): Promise<SelectionView> {
    return {
      id: selection.id,
      companyId: selection.companyId,
      quarter: selection.quarter,
      percentage: selection.percentage.toNumber(),
      algorithmVersion: selection.algorithmVersion,
      seed: selection.seed,
      eligibleCount: selection.eligibleCount,
      selectedCount: selection.selectedCount,
      triggeredBy: selection.triggeredBy,
      createdAt: selection.createdAt,
      selectedVehicles: await this.findSelectedVehicles(selection.id),
    };
  }
}

/** Business rules checked only when a new selection is about to be made. */
function assertCanCreateSelection(company: Company, percentage: number): void {
  if (company.status !== CompanyStatus.active) {
    throw new BadRequestException('Company is not active');
  }
  const minimum = company.minSurpriseInspectionThreshold.toNumber();
  if (percentage < minimum) {
    throw new BadRequestException(`percentage must be at least ${minimum} for this company`);
  }
}

function sameIds(a: string[], b: string[]): boolean {
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.length === sortedB.length && sortedA.every((id, i) => id === sortedB[i]);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
