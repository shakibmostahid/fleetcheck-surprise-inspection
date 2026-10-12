/** Input to the pure selection algorithm. */
export interface SelectionInput {
  vehicleIds: readonly string[];
  /** 0 < percentage <= 100, at most two decimal places (e.g. 25 or 12.5). */
  percentage: number;
  seed: string;
}
