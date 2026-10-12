import { Module } from '@nestjs/common';
import { SurpriseInspectionsController } from './surprise-inspections.controller';
import { SurpriseInspectionsRepository } from './surprise-inspections.repository';
import { SurpriseInspectionsService } from './surprise-inspections.service';

@Module({
  controllers: [SurpriseInspectionsController],
  providers: [SurpriseInspectionsService, SurpriseInspectionsRepository],
})
export class SurpriseInspectionsModule {}
