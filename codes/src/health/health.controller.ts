import { Controller, Get, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ApiResponse } from '../common/response/api-response';
import { ResponseHandler } from '../common/response/response-handler';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): ApiResponse<{ status: string }> {
    return ResponseHandler.json(HttpStatus.OK, { status: 'ok' });
  }
}
