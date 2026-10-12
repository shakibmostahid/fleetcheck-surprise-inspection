/**
 * Demo data for local development. WARNING: deletes all existing data first.
 *
 *   npm run seed          -> admin user, two small companies, garages, one past selection
 *   npm run seed:large    -> the same, plus a company with 200,000 vehicles
 */
import { InspectionResult, InspectionStatus, UserRole, VehicleStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ALGORITHM_VERSION,
  selectVehicles,
} from '../src/surprise-inspections/selection/select-vehicles';
import { SurpriseInspectionsRepository } from '../src/surprise-inspections/surprise-inspections.repository';

const prisma = new PrismaService();
// The same repository the API uses, so seeded selections are saved exactly like real ones.
const repository = new SurpriseInspectionsRepository(prisma);

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

  // Swift: 20 vehicles, of which 19 are eligible (one inactive, which still counts; one soft-deleted).
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

/**
 * Last quarter's selection, made with the real algorithm and saved by the real repository,
 * so the read and verify endpoints work straight away. Its inspections are already done.
 */
async function seedPastSelection(
  companyId: string,
  quarter: string,
  percentage: number,
): Promise<void> {
  const triggeredBy = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const garage = await prisma.garage.findFirstOrThrow();

  const selection = await repository.runInTransaction(async (tx) => {
    const vehicleIds = await repository.findEligibleVehicleIds(tx, companyId);
    const seed = randomBytes(32).toString('hex');
    const result = selectVehicles({ vehicleIds, percentage, seed });
    return repository.createSelection(
      tx,
      {
        companyId,
        quarter,
        percentage,
        seed,
        algorithmVersion: ALGORITHM_VERSION,
        triggeredBy: triggeredBy.id,
      },
      result,
    );
  });

  // Mark the inspections completed: the first one failed, the rest passed.
  const picked = await repository.findSelectedVehicles(selection.id);
  for (const [index, { inspection }] of picked.entries()) {
    await prisma.inspection.update({
      where: { id: inspection!.id },
      data: {
        garageId: garage.id,
        status: InspectionStatus.completed,
        result: index === 0 ? InspectionResult.fail : InspectionResult.pass,
      },
    });
  }
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
