import { createHash } from 'node:crypto';
import { SelectionInput } from '../interfaces/selection-input.interface';
import { SelectionResult } from '../interfaces/selection-result.interface';

/**
 * Stored with every selection. Bump it if the algorithm below ever changes,
 * so old selections can still be verified with the version they were made with.
 */
export const ALGORITHM_VERSION = 'sha256-rank-v1';

/**
 * Picks `ceil(n * percentage / 100)` vehicles at random, reproducibly.
 *
 * Each vehicle gets a score of SHA-256(seed + ":" + vehicleId). Vehicles are
 * sorted by score and the lowest `k` scores are picked. SHA-256 output behaves
 * like a uniform random number, so every vehicle has the same chance of being
 * picked. The same seed and the same set of ids always give the same result,
 * whatever order the ids arrive in.
 *
 * Time O(n log n), space O(n).
 */
export function selectVehicles({ vehicleIds, percentage, seed }: SelectionInput): SelectionResult {
  if (seed.length === 0) {
    throw new Error('seed must not be empty');
  }

  const eligibleIds = [...new Set(vehicleIds)].sort();
  const targetCount = calculateTargetCount(eligibleIds.length, percentage);

  const selectedIds = eligibleIds
    .map((id) => ({ id, score: scoreVehicle(seed, id) }))
    .sort((a, b) => compare(a.score, b.score) || compare(a.id, b.id))
    .slice(0, targetCount)
    .map(({ id }) => id)
    .sort();

  return { eligibleIds, selectedIds, targetCount };
}

/**
 * Number of vehicles to pick. Rounds up, so a non-empty fleet always gets at
 * least one vehicle (25% of 3 vehicles is 1, not 0).
 *
 * Works in basis points (hundredths of a percent) to avoid floating-point
 * surprises: in JavaScript 3000 * 1.1 / 100 is 33.00000000000001, which
 * would round up to 34 instead of 33.
 */
export function calculateTargetCount(eligibleCount: number, percentage: number): number {
  if (!Number.isInteger(eligibleCount) || eligibleCount < 0) {
    throw new RangeError('eligibleCount must be a non-negative integer');
  }
  const basisPoints = Math.round(percentage * 100);
  if (!Number.isFinite(percentage) || basisPoints <= 0 || basisPoints > 10_000) {
    throw new RangeError('percentage must be greater than 0 and at most 100');
  }
  if (Math.abs(percentage * 100 - basisPoints) > 1e-6) {
    throw new RangeError('percentage must have at most two decimal places');
  }

  return Math.ceil((eligibleCount * basisPoints) / 10_000);
}

export function scoreVehicle(seed: string, vehicleId: string): string {
  return createHash('sha256').update(`${seed}:${vehicleId}`).digest('hex');
}

/** Plain code-point comparison, so the order is the same in every language and locale. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
