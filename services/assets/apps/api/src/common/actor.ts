import { ForbiddenException } from '@nestjs/common';
import { ALL_PERMISSIONS, type Permission } from '@eam/shared';

/** The authenticated caller. Every service method receives one and checks it. */
export interface Actor {
  userId: string | null;
  name: string;
  email: string | null;
  employeeId: string | null;
  roleName: string;
  permissions: ReadonlySet<Permission>;
}

export const SYSTEM_ACTOR: Actor = {
  userId: null,
  name: 'System',
  email: null,
  employeeId: null,
  roleName: 'System',
  permissions: new Set(ALL_PERMISSIONS),
};

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, ...permissions: Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export function assertCan(actor: Actor, permission: Permission, message?: string): void {
  if (!actor.permissions.has(permission)) {
    throw new ForbiddenException(message ?? 'You do not have permission to do this');
  }
}
