/**
 * Auditor CLI: reproduces a selection from its inputs, without touching the database.
 *
 *   npm run verify-selection -- --seed <hex> --percentage 25 --ids eligible-ids.txt
 *
 * `eligible-ids.txt` holds one vehicle id per line (the stored snapshot).
 * Prints the selected ids, one per line, sorted.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ALGORITHM_VERSION,
  selectVehicles,
} from '../src/surprise-inspections/selection/select-vehicles';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    percentage: { type: 'string' },
    ids: { type: 'string' },
  },
});

if (!values.seed || !values.percentage || !values.ids) {
  console.error('Usage: verify-selection --seed <hex> --percentage <number> --ids <file>');
  process.exit(1);
}

const vehicleIds = readFileSync(values.ids, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const result = selectVehicles({
  vehicleIds,
  percentage: Number(values.percentage),
  seed: values.seed,
});

console.error(
  `${ALGORITHM_VERSION}: ${result.selectedIds.length} of ${result.eligibleIds.length} vehicles selected`,
);
console.log(result.selectedIds.join('\n'));
