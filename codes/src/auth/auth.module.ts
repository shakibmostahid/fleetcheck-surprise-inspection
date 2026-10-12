import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BasicAuthGuard } from './basic-auth.guard';

@Module({
  // Registered globally: every route needs a login unless marked @Public().
  providers: [{ provide: APP_GUARD, useClass: BasicAuthGuard }],
})
export class AuthModule {}
