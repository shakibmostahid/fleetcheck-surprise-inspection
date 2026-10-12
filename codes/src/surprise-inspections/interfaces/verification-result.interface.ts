/** Response body of GET /admin/surprise-inspections/verify. */
export interface VerificationResult {
  reproducible: boolean;
  quarter: string;
  algorithmVersion: string;
  seed: string;
  percentage: number;
  eligibleCount: number;
  storedSelectedCount: number;
  recomputedSelectedCount: number;
}
