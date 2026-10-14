import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../types/auth-user.js';

/**
 * Injects the authenticated user, or one of its fields:
 *   @CurrentUser() user: AuthUser
 *   @CurrentUser('id') userId: string
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? user?.[field] : user;
  },
);
