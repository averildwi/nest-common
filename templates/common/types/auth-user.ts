import type { Request } from 'express';

/**
 * Role names accepted by @Roles(). This placeholder union keeps typos from
 * compiling until the schema has a role enum. Once it does, derive it from
 * Prisma instead:
 *
 *   import type { Role } from '../../../generated/prisma/client.js';
 *   export type RoleName = Role;
 */
export type RoleName = 'ADMIN' | 'USER';

/**
 * Type of the User primary key. Keep `string` for uuid/cuid ids, change it to
 * `number` when the User model uses autoincrement.
 */
export type UserId = string;

/** What JwtStrategy.validate() returns and what @CurrentUser() injects. */
export interface AuthUser {
  id: UserId;
  email: string;
  role: RoleName;
}

/** Claims signed into the access token. */
export interface JwtPayload {
  sub: UserId;
  email: string;
}

/** Express request after JwtAuthGuard ran. `user` is absent on public routes. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
