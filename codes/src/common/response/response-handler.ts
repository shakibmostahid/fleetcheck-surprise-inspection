import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from './api-response';

/**
 * Builds every successful API response the same way. Errors are handled by Nest's exception filter.
 *
 *   return ResponseHandler.json(HttpStatus.OK, data);
 *   return ResponseHandler.json(HttpStatus.CREATED, data, { Location: '/...' });
 */
export abstract class ResponseHandler {
  static json<T>(
    statusCode: HttpStatus,
    data: T,
    headers: Record<string, string> = {},
  ): ApiResponse<T> {
    return new ApiResponse(statusCode, data, headers);
  }
}
