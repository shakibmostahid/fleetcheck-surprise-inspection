import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ApiResponse } from '../common/response/api-response';
import { ResponseHandler } from '../common/response/response-handler';
import { CreateSurpriseInspectionDto } from './dto/create-surprise-inspection.dto';
import { FindSurpriseInspectionDto } from './dto/find-surprise-inspection.dto';
import { CreateSelectionResponse } from './interfaces/create-selection-response.interface';
import { SelectionView } from './interfaces/selection-view.interface';
import { VerificationResult } from './interfaces/verification-result.interface';
import { SurpriseInspectionsService } from './surprise-inspections.service';

/** Admin-only: every route requires the fixed admin Basic auth credentials. */
@Controller('admin/surprise-inspections')
export class SurpriseInspectionsController {
  constructor(private readonly service: SurpriseInspectionsService) {}

  /** 201 when a new selection is made, 200 when it already existed. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSurpriseInspectionDto,
  ): Promise<ApiResponse<CreateSelectionResponse>> {
    const result = await this.service.create(user, dto);
    const statusCode = result.created ? HttpStatus.CREATED : HttpStatus.OK;
    return ResponseHandler.json(statusCode, result);
  }

  /** GET /admin/surprise-inspections?companyId=...&quarter=2026-Q4 */
  @Get()
  async find(@Query() query: FindSurpriseInspectionDto): Promise<ApiResponse<SelectionView>> {
    const selection = await this.service.find(query);
    return ResponseHandler.json(HttpStatus.OK, selection);
  }

  /** GET /admin/surprise-inspections/verify?companyId=...&quarter=2026-Q4 */
  @Get('verify')
  async verify(
    @CurrentUser() user: AuthUser,
    @Query() query: FindSurpriseInspectionDto,
  ): Promise<ApiResponse<VerificationResult>> {
    const verification = await this.service.verify(user, query);
    return ResponseHandler.json(HttpStatus.OK, verification);
  }
}
