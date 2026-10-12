import { Prisma } from '@prisma/client';

/** One row for the audit_logs table. */
export interface AuditEntry {
  userId: string;
  companyId: string | null;
  action: string;
  details: Prisma.InputJsonObject;
}
