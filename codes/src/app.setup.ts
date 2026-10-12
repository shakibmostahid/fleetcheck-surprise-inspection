import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ApiResponseInterceptor } from './common/response/api-response.interceptor';

/** Shared by main.ts and the e2e tests, so both run the app the same way. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Turns ResponseHandler.json(...) results into the HTTP response.
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableShutdownHooks();
}
