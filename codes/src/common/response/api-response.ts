import { HttpStatus } from '@nestjs/common';

/**
 * What a controller returns via ResponseHandler.json(). ApiResponseInterceptor
 * turns it into the HTTP response: status code, headers, then `data` as the JSON body.
 */
export class ApiResponse<T> {
  constructor(
    readonly statusCode: HttpStatus,
    readonly data: T,
    readonly headers: Record<string, string>,
  ) {}
}
