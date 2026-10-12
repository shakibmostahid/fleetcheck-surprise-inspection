import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole, VehicleStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

// Fixed admin credentials, loaded into the container from docker/.envs/app.env.
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  // Listen once so supertest reuses this server instead of starting one per request.
  await app.listen(0);
  return app;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE audit_logs, surprise_inspections_vehicles, surprise_inspections,
      inspections, garages, vehicles, users, companies
    CASCADE
  `);
}

export function basicAuth(username = ADMIN_EMAIL, password = ADMIN_PASSWORD): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

export function createAdminUser(prisma: PrismaClient) {
  return prisma.user.create({
    data: { name: 'Test Admin', email: ADMIN_EMAIL, role: UserRole.admin },
  });
}

export function createCompany(prisma: PrismaClient, name: string, minThreshold = 0) {
  return prisma.company.create({ data: { name, minSurpriseInspectionThreshold: minThreshold } });
}

export async function createVehicles(
  prisma: PrismaClient,
  companyId: string,
  count: number,
  overrides: { status?: VehicleStatus; isDeleted?: boolean; prefix?: string } = {},
): Promise<void> {
  const prefix = overrides.prefix ?? 'VEH';
  const batchSize = 10_000;
  for (let start = 0; start < count; start += batchSize) {
    const size = Math.min(batchSize, count - start);
    await prisma.vehicle.createMany({
      data: Array.from({ length: size }, (_, i) => ({
        companyId,
        registrationNo: `${prefix}-${start + i + 1}`,
        status: overrides.status ?? VehicleStatus.active,
        isDeleted: overrides.isDeleted ?? false,
      })),
    });
  }
}
