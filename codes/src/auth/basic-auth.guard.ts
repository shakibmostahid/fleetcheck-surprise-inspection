import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './interfaces/auth-user.interface';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * HTTP Basic auth against one fixed admin account:
 * `Authorization: Basic base64(ADMIN_EMAIL:ADMIN_PASSWORD)`, both set in docker/.envs/app.env.
 * Kept deliberately simple for this assignment; see README for what production would use.
 */
@Injectable()
export class BasicAuthGuard implements CanActivate {
  private readonly adminEmail = requireEnv('ADMIN_EMAIL');
  private readonly adminPassword = requireEnv('ADMIN_PASSWORD');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const credentials = parseBasicAuthHeader(request.headers.authorization);
    const isAdmin =
      credentials !== null &&
      safeEqual(credentials.username, this.adminEmail) &&
      safeEqual(credentials.password, this.adminPassword);

    if (!isAdmin) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'Basic realm="fleetcheck-admin"');
      throw new UnauthorizedException('Invalid username or password');
    }

    request.user = await this.findAdminUser();
    return true;
  }

  /** The users row for the admin, so selections and audit logs can record who acted. */
  private async findAdminUser(): Promise<AuthUser> {
    const admin = await this.prisma.user.findFirst({
      where: { email: this.adminEmail, role: UserRole.admin, status: UserStatus.active },
      select: { id: true, email: true },
    });
    if (!admin) {
      throw new InternalServerErrorException(
        `No active admin user with email ${this.adminEmail}. Run the seed.`,
      );
    }
    return admin;
  }
}

function parseBasicAuthHeader(
  header: string | undefined,
): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/** Constant-time comparison, so response timing doesn't reveal how much of a guess was right. */
function safeEqual(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
