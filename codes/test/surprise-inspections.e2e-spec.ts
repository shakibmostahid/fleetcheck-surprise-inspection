import { INestApplication } from '@nestjs/common';
import { Company, PrismaClient, VehicleStatus } from '@prisma/client';
import request from 'supertest';
import {
  ADMIN_EMAIL,
  basicAuth,
  createAdminUser,
  createCompany,
  createTestApp,
  createVehicles,
  resetDatabase,
} from './helpers';

const URL = '/admin/surprise-inspections';

describe('Admin surprise inspections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: Company;

  const create = (body: object) =>
    request(app.getHttpServer()).post(URL).set('Authorization', basicAuth()).send(body);

  const find = (query: object, path = '') =>
    request(app.getHttpServer())
      .get(`${URL}${path}`)
      .query(query)
      .set('Authorization', basicAuth());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createAdminUser(prisma);
    company = await createCompany(prisma, 'Company A', 10);
  });

  describe('authentication', () => {
    it('allows /health without logging in', async () => {
      await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    });

    it('rejects requests without credentials', async () => {
      const response = await request(app.getHttpServer())
        .post(URL)
        .send({ companyId: company.id, quarter: '2025-Q4', percentage: 25 })
        .expect(401);

      expect(response.headers['www-authenticate']).toContain('Basic');
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .get(URL)
        .query({ companyId: company.id, quarter: '2025-Q4' })
        .set('Authorization', basicAuth(ADMIN_EMAIL, 'wrong'))
        .expect(401);
    });

    it('rejects a wrong username', async () => {
      await request(app.getHttpServer())
        .get(URL)
        .query({ companyId: company.id, quarter: '2025-Q4' })
        .set('Authorization', basicAuth('someone@else.test'))
        .expect(401);
    });

    it('records the admin user as the one who triggered the selection', async () => {
      const response = await create({ companyId: company.id, quarter: '2025-Q4', percentage: 25 });
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

      expect(response.body.selection.triggeredBy).toBe(admin.id);
    });
  });

  describe('creating a selection', () => {
    it('picks the right number of vehicles from the eligible ones only', async () => {
      await createVehicles(prisma, company.id, 20);
      await createVehicles(prisma, company.id, 2, {
        status: VehicleStatus.inactive,
        prefix: 'INACTIVE',
      });
      await createVehicles(prisma, company.id, 2, { isDeleted: true, prefix: 'DELETED' });

      const response = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 25,
      }).expect(201);

      const { created, selection } = response.body;
      expect(created).toBe(true);
      expect(selection.companyId).toBe(company.id);
      expect(selection.eligibleCount).toBe(20);
      expect(selection.selectedCount).toBe(5);
      expect(selection.selectedVehicles).toHaveLength(5);
      expect(selection.seed).toMatch(/^[0-9a-f]{64}$/);
      selection.selectedVehicles.forEach((vehicle: { registrationNo: string }) =>
        expect(vehicle.registrationNo).toMatch(/^VEH-/),
      );

      const snapshotRows = await prisma.surpriseInspectionVehicle.count({
        where: { surpriseInspectionId: selection.id },
      });
      expect(snapshotRows).toBe(20);

      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'surprise_inspection.created' },
      });
      expect(auditLog?.companyId).toBe(company.id);
    });

    it('returns the existing selection when run twice, even with a different percentage', async () => {
      await createVehicles(prisma, company.id, 20);

      const first = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 25,
      }).expect(201);
      const second = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 50,
      }).expect(200);

      expect(second.body.created).toBe(false);
      expect(second.body.selection).toEqual(first.body.selection);
      expect(await prisma.surpriseInspection.count()).toBe(1);
      expect(await prisma.surpriseInspectionVehicle.count()).toBe(20);
    });

    it('creates exactly one selection when many requests arrive at once', async () => {
      await createVehicles(prisma, company.id, 200);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          create({ companyId: company.id, quarter: '2025-Q4', percentage: 25 }),
        ),
      );

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 200)).toHaveLength(9);
      expect(new Set(responses.map((r) => r.body.selection.id)).size).toBe(1);
      expect(await prisma.surpriseInspection.count()).toBe(1);
      expect(await prisma.surpriseInspectionVehicle.count()).toBe(200);
    });

    it('keeps vehicles picked last quarter eligible this quarter', async () => {
      await createVehicles(prisma, company.id, 10);

      const q3 = await create({
        companyId: company.id,
        quarter: '2025-Q3',
        percentage: 100,
      }).expect(201);
      const q4 = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 100,
      }).expect(201);

      expect(q4.body.selection.selectedVehicles).toEqual(q3.body.selection.selectedVehicles);
      expect(q4.body.selection.selectedCount).toBe(10);
    });

    it('keeps each company separate', async () => {
      const other = await createCompany(prisma, 'Company B');
      await createVehicles(prisma, company.id, 10, { prefix: 'A' });
      await createVehicles(prisma, other.id, 10, { prefix: 'B' });

      const response = await create({
        companyId: other.id,
        quarter: '2025-Q4',
        percentage: 100,
      }).expect(201);

      response.body.selection.selectedVehicles.forEach((vehicle: { registrationNo: string }) =>
        expect(vehicle.registrationNo).toMatch(/^B-/),
      );
    });

    it('records an empty selection for a company with no eligible vehicles', async () => {
      const response = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 25,
      }).expect(201);

      expect(response.body.selection).toMatchObject({
        eligibleCount: 0,
        selectedCount: 0,
        selectedVehicles: [],
      });
    });
  });

  describe('validation', () => {
    // Bodies are built lazily because `company` is created in beforeEach.
    it.each([
      ['missing companyId', () => ({ quarter: '2025-Q4', percentage: 25 })],
      [
        'companyId not a UUID',
        () => ({ companyId: 'not-a-uuid', quarter: '2025-Q4', percentage: 25 }),
      ],
      ['invalid quarter', () => ({ companyId: company.id, quarter: '2025-Q5', percentage: 25 })],
      ['percentage of 0', () => ({ companyId: company.id, quarter: '2025-Q4', percentage: 0 })],
      [
        'percentage over 100',
        () => ({ companyId: company.id, quarter: '2025-Q4', percentage: 101 }),
      ],
      [
        '3 decimal places',
        () => ({ companyId: company.id, quarter: '2025-Q4', percentage: 12.345 }),
      ],
      [
        'percentage as a string',
        () => ({ companyId: company.id, quarter: '2025-Q4', percentage: '25' }),
      ],
      ['missing percentage', () => ({ companyId: company.id, quarter: '2025-Q4' })],
      [
        'client-supplied seed',
        () => ({ companyId: company.id, quarter: '2025-Q4', percentage: 25, seed: 'my-own-seed' }),
      ],
    ])('rejects a body with %s', async (_case, body) => {
      await create(body()).expect(400);
    });

    it('rejects a future quarter', async () => {
      await create({ companyId: company.id, quarter: '2999-Q1', percentage: 25 }).expect(400);
    });

    it("rejects a percentage below the company's minimum", async () => {
      // The company requires at least 10%.
      const response = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 5,
      }).expect(400);

      expect(response.body.message).toContain('at least 10');
      expect(await prisma.surpriseInspection.count()).toBe(0);
    });

    it('returns 404 for an unknown company', async () => {
      await create({
        companyId: '00000000-0000-4000-8000-000000000000',
        quarter: '2025-Q4',
        percentage: 25,
      }).expect(404);
    });
  });

  describe('reading and verifying', () => {
    beforeEach(async () => {
      await createVehicles(prisma, company.id, 40);
      await create({ companyId: company.id, quarter: '2025-Q4', percentage: 25 }).expect(201);
    });

    it('returns the stored selection', async () => {
      const response = await find({ companyId: company.id, quarter: '2025-Q4' }).expect(200);

      expect(response.body).toMatchObject({
        quarter: '2025-Q4',
        percentage: 25,
        selectedCount: 10,
      });
    });

    it('returns 404 for a quarter with no selection', async () => {
      await find({ companyId: company.id, quarter: '2025-Q1' }).expect(404);
    });

    it.each([
      ['missing companyId', () => ({ quarter: '2025-Q4' })],
      ['companyId not a UUID', () => ({ companyId: 'not-a-uuid', quarter: '2025-Q4' })],
      ['invalid quarter', () => ({ companyId: company.id, quarter: '2025-4' })],
    ])('rejects a query with %s', async (_case, query) => {
      await find(query()).expect(400);
    });

    it('reproduces the selection from the stored seed and snapshot', async () => {
      const response = await find({ companyId: company.id, quarter: '2025-Q4' }, '/verify').expect(
        200,
      );

      expect(response.body).toMatchObject({
        reproducible: true,
        eligibleCount: 40,
        storedSelectedCount: 10,
        recomputedSelectedCount: 10,
      });
    });

    it('still verifies after the fleet changes', async () => {
      const before = await find({ companyId: company.id, quarter: '2025-Q4' }).expect(200);

      // Remove a picked vehicle, deactivate others and add new ones.
      await prisma.vehicle.update({
        where: { id: before.body.selectedVehicles[0].id },
        data: { isDeleted: true },
      });
      await prisma.vehicle.updateMany({
        where: { companyId: company.id, registrationNo: { in: ['VEH-1', 'VEH-2'] } },
        data: { status: VehicleStatus.inactive },
      });
      await createVehicles(prisma, company.id, 15, { prefix: 'NEW' });

      const verification = await find(
        { companyId: company.id, quarter: '2025-Q4' },
        '/verify',
      ).expect(200);
      const after = await find({ companyId: company.id, quarter: '2025-Q4' }).expect(200);

      expect(verification.body.reproducible).toBe(true);
      expect(after.body.selectedVehicles).toEqual(before.body.selectedVehicles);
    });

    it('detects a tampered selection', async () => {
      const selection = await prisma.surpriseInspection.findFirstOrThrow();
      // Swap one picked vehicle for one that was not picked.
      const picked = await prisma.surpriseInspectionVehicle.findFirstOrThrow({
        where: { surpriseInspectionId: selection.id, isSelected: true },
      });
      const notPicked = await prisma.surpriseInspectionVehicle.findFirstOrThrow({
        where: { surpriseInspectionId: selection.id, isSelected: false },
      });
      await prisma.surpriseInspectionVehicle.update({
        where: { id: picked.id },
        data: { isSelected: false },
      });
      await prisma.surpriseInspectionVehicle.update({
        where: { id: notPicked.id },
        data: { isSelected: true },
      });

      const response = await find({ companyId: company.id, quarter: '2025-Q4' }, '/verify').expect(
        200,
      );

      expect(response.body.reproducible).toBe(false);
    });
  });

  const describeSlow = process.env.RUN_SLOW_TESTS === 'true' ? describe : describe.skip;

  describeSlow('large fleet', () => {
    it('selects 25% of 200,000 vehicles and verifies it', async () => {
      await createVehicles(prisma, company.id, 200_000);

      const response = await create({
        companyId: company.id,
        quarter: '2025-Q4',
        percentage: 25,
      }).expect(201);
      expect(response.body.selection).toMatchObject({
        eligibleCount: 200_000,
        selectedCount: 50_000,
      });

      const verification = await find(
        { companyId: company.id, quarter: '2025-Q4' },
        '/verify',
      ).expect(200);
      expect(verification.body.reproducible).toBe(true);
    });
  });
});
