import { IsUUID, Matches } from 'class-validator';
import { QUARTER_PATTERN } from '../../common/quarter';

/** Identifies one selection: a company and a quarter. */
export class FindSurpriseInspectionDto {
  @IsUUID()
  companyId!: string;

  /** e.g. "2026-Q4" */
  @Matches(QUARTER_PATTERN, { message: 'quarter must look like 2026-Q4' })
  quarter!: string;
}
