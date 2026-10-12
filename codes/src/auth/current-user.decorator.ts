import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './interfaces/auth-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);
