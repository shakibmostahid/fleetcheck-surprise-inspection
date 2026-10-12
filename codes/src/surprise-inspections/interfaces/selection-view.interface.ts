/** A selection as returned by the API. */
export interface SelectionView {
  id: string;
  companyId: string;
  quarter: string;
  percentage: number;
  algorithmVersion: string;
  seed: string;
  eligibleCount: number;
  selectedCount: number;
  triggeredBy: string;
  createdAt: Date;
  selectedVehicles: { id: string; registrationNo: string }[];
}
