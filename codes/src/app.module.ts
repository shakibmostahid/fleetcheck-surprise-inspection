import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SurpriseInspectionsModule } from './surprise-inspections/surprise-inspections.module';

@Module({
  imports: [PrismaModule, AuthModule, SurpriseInspectionsModule],
  controllers: [HealthController],
})
export class AppModule {}
