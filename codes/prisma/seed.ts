/**
 * Demo data for local development. WARNING: deletes all existing data first.
 *
 *   npm run seed          -> admin user, two small companies, garages, one past selection
 *   npm run seed:large    -> the same, plus a company with 200,000 vehicles
 */
import { PrismaClient, UserRole, VehicleStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  ALGORITHM_VERSION,
  selectVehicles,
} from '../src/surprise-inspections/selection/select-vehicles';

const prisma = new PrismaClient();

/** Must match ADMIN_EMAIL in docker/.envs/app.env, which the API uses for Basic auth. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@fleetcheck.test';

/** Fixed ids so the README examples work after every seed. */
export const COMPANY_IDS = {
  swift: '11111111-1111-4111-8111-111111111111',
  northern: '22222222-2222-4222-8222-222222222222',
  mega: '33333333-3333-4333-8333-333333333333',
};

const LARGE_FLEET_SIZE = 200_000;
const BATCH_SIZE = 10_000;

async function main(): Promise<void> {
  await clearDatabase();

  await prisma.company.createMany({
    data: [
      { id: COMPANY_IDS.swift, name: 'Swift Logistics', minSurpriseInspectionThreshold: 10 },
      { id: COMPANY_IDS.northern, name: 'Northern Haulage', minSurpriseInspectionThreshold: 5 },
    ],
  });

  await prisma.user.create({
    data: { name: 'FleetCheck Admin', email: ADMIN_EMAIL, role: UserRole.admin },
  });

  // Swift: 20 vehicles, of which 18 are eligible (one inactive, one soft-deleted).
  await prisma.vehicle.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      companyId: COMPANY_IDS.swift,
      registrationNo: `SWF-${String(i + 1).padStart(3, '0')}`,
      status: i === 18 ? VehicleStatus.inactive : VehicleStatus.active,
      isDeleted: i === 19,
    })),
  });

  // Northern: 8 vehicles, all eligible.
  await prisma.vehicle.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({
      companyId: COMPANY_IDS.northern,
      registrationNo: `NTH-${String(i + 1).padStart(3, '0')}`,
    })),
  });

  await prisma.garage.createMany({
    data: [
      { name: 'Central Motors', externalGarageId: 'GRG-1001' },
      { name: 'Eastside Auto Care', externalGarageId: 'GRG-1002' },
    ],
  });

  await seedPastSelection(COMPANY_IDS.swift, '2026-Q3', 25);

  if (process.env.SEED_LARGE_FLEET === 'true') {
    await seedLargeFleet();
  }

  console.log(`Seed complete. Admin user: ${ADMIN_EMAIL} (password: ADMIN_PASSWORD in app.env)`);
  console.log(`  Swift Logistics:  ${COMPANY_IDS.swift}`);
  console.log(`  Northern Haulage: ${COMPANY_IDS.northern}`);
}

async function clearDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE audit_logs, surprise_inspections_vehicles, surprise_inspections,
      inspections, garages, vehicles, users, companies
    RESTART IDENTITY CASCADE
  `);
}

/** Last quarter's selection, made with the real algorithm, so GET and verify work straight away. */
async function seedPastSelection(
  companyId: string,
  quarter: string,
  percentage: number,
): Promise<void> {
  const triggeredBy = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, status: VehicleStatus.active, isDeleted: false },
    select: { id: true },
  });

  const seed = randomBytes(32).toString('hex');
  const result = selectVehicles({ vehicleIds: vehicles.map((v) => v.id), percentage, seed });
  const selected = new Set(result.selectedIds);

  await prisma.surpriseInspection.create({
    data: {
      companyId,
      quarter,
      percentage,
      seed,
      algorithmVersion: ALGORITHM_VERSION,
      eligibleCount: result.eligibleIds.length,
      selectedCount: result.selectedIds.length,
      triggeredBy: triggeredBy.id,
      vehicles: {
        createMany: {
          data: result.eligibleIds.map((vehicleId) => ({
            vehicleId,
            isSelected: selected.has(vehicleId),
          })),
        },
      },
    },
  });
}

async function seedLargeFleet(): Promise<void> {
  await prisma.company.create({
    data: { id: COMPANY_IDS.mega, name: 'Mega Freight', minSurpriseInspectionThreshold: 5 },
  });

  for (let start = 0; start < LARGE_FLEET_SIZE; start += BATCH_SIZE) {
    await prisma.vehicle.createMany({
      data: Array.from({ length: BATCH_SIZE }, (_, i) => ({
        companyId: COMPANY_IDS.mega,
        registrationNo: `MEGA-${String(start + i + 1).padStart(6, '0')}`,
      })),
    });
  }
  console.log(`  Mega Freight:     ${COMPANY_IDS.mega} (${LARGE_FLEET_SIZE} vehicles)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
