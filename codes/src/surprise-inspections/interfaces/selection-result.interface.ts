/** Output of the pure selection algorithm. */
export interface SelectionResult {
  /** De-duplicated and sorted: the exact input an auditor needs. */
  eligibleIds: string[];
  /** Sorted by id. */
  selectedIds: string[];
  targetCount: number;
}
