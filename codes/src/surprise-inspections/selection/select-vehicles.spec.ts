import { calculateTargetCount, selectVehicles } from './select-vehicles';

const makeIds = (count: number, prefix = 'vehicle') =>
  Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);

describe('selectVehicles', () => {
  const vehicleIds = makeIds(20);
  const seed = 'test-seed';

  it('returns the same selection for the same inputs', () => {
    const first = selectVehicles({ vehicleIds, percentage: 25, seed });
    const second = selectVehicles({ vehicleIds, percentage: 25, seed });

    expect(second).toEqual(first);
  });

  it('does not depend on the order of the input ids', () => {
    const shuffled = [...vehicleIds].reverse();

    expect(selectVehicles({ vehicleIds: shuffled, percentage: 25, seed })).toEqual(
      selectVehicles({ vehicleIds, percentage: 25, seed }),
    );
  });

  it('ignores duplicate ids', () => {
    const result = selectVehicles({
      vehicleIds: [...vehicleIds, ...vehicleIds],
      percentage: 25,
      seed,
    });

    expect(result.eligibleIds).toHaveLength(20);
    expect(result.selectedIds).toHaveLength(5);
  });

  it('only picks from the eligible ids and never picks one twice', () => {
    const { selectedIds } = selectVehicles({ vehicleIds, percentage: 50, seed });

    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    selectedIds.forEach((id) => expect(vehicleIds).toContain(id));
  });

  it('gives a different selection for a different seed', () => {
    const a = selectVehicles({ vehicleIds, percentage: 25, seed: 'seed-a' });
    const b = selectVehicles({ vehicleIds, percentage: 25, seed: 'seed-b' });

    expect(a.selectedIds).not.toEqual(b.selectedIds);
  });

  it('returns an empty selection for a company with no eligible vehicles', () => {
    expect(selectVehicles({ vehicleIds: [], percentage: 25, seed })).toEqual({
      eligibleIds: [],
      selectedIds: [],
      targetCount: 0,
    });
  });

  it('rejects an empty seed', () => {
    expect(() => selectVehicles({ vehicleIds, percentage: 25, seed: '' })).toThrow();
  });

  // Expected output was computed separately with Python's hashlib, so this test
  // catches any accidental change to the algorithm.
  it('matches a known answer from an independent implementation', () => {
    const result = selectVehicles({
      vehicleIds: makeIds(10),
      percentage: 30,
      seed: 'fleetcheck-audit-seed',
    });

    expect(result.selectedIds).toEqual(['vehicle-03', 'vehicle-06', 'vehicle-07']);
  });

  it('gives every vehicle an equal chance (chi-square test)', () => {
    const fleet = makeIds(20);
    const runs = 20_000;
    const picks = new Map(fleet.map((id) => [id, 0]));

    for (let run = 0; run < runs; run++) {
      const { selectedIds } = selectVehicles({
        vehicleIds: fleet,
        percentage: 25,
        seed: `seed-${run}`,
      });
      selectedIds.forEach((id) => picks.set(id, picks.get(id)! + 1));
    }

    // Each run picks 5 of 20, so each vehicle should be picked about runs * 5 / 20 times.
    const expected = (runs * 5) / 20;
    const chiSquare = [...picks.values()].reduce(
      (sum, observed) => sum + (observed - expected) ** 2 / expected,
      0,
    );

    // Critical value for 19 degrees of freedom at p = 0.001.
    expect(chiSquare).toBeLessThan(43.82);
  });

  it('handles 200,000 vehicles quickly', () => {
    const fleet = makeIds(200_000);

    const started = Date.now();
    const result = selectVehicles({ vehicleIds: fleet, percentage: 25, seed });
    const elapsedMs = Date.now() - started;

    expect(result.selectedIds).toHaveLength(50_000);
    expect(elapsedMs).toBeLessThan(3_000);
  });
});

describe('calculateTargetCount', () => {
  it.each([
    [20, 25, 5],
    [3, 25, 1], // rounds up: 0.75 -> 1
    [20, 100, 20],
    [0, 25, 0],
    [200_000, 12.5, 25_000],
    [3_000, 1.1, 33], // naive Math.ceil(3000 * 1.1 / 100) gives 34 because of floating point
    [1, 0.01, 1],
  ])('%i vehicles at %d%% -> %i', (count, percentage, expected) => {
    expect(calculateTargetCount(count, percentage)).toBe(expected);
  });

  it.each([0, -5, 100.01, Number.NaN, 12.345])('rejects percentage %d', (percentage) => {
    expect(() => calculateTargetCount(10, percentage)).toThrow(RangeError);
  });
});
