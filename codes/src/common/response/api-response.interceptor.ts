import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { ApiResponse } from './api-response';

/** Applies the status code and headers of an ApiResponse, and sends its `data` as the body. */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result) => {
        if (!(result instanceof ApiResponse)) {
          return result;
        }
        response.status(result.statusCode).set(result.headers);
        return result.data;
      }),
    );
  }
}
