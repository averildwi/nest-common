import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../types/auth-user.js';

export type { RoleName } from '../types/auth-user.js';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
