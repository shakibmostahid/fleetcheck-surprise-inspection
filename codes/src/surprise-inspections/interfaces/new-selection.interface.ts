/** Fields needed to save a new selection; the counts come from the SelectionResult. */
export interface NewSelection {
  companyId: string;
  quarter: string;
  percentage: number;
  seed: string;
  algorithmVersion: string;
  triggeredBy: string;
}
