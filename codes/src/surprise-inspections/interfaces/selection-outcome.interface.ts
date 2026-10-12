import { SurpriseInspection } from '@prisma/client';

/** Result of the create transaction, before it is turned into an API response. */
export interface SelectionOutcome {
  /** False when a selection already existed for this company and quarter. */
  created: boolean;
  selection: SurpriseInspection;
}
