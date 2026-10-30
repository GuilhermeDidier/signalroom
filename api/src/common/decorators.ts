import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { AppRequest, AuthUser, Role, TenantContext } from './types';

export const IS_PUBLIC = 'signalroom:public';
export const ROLES_KEY = 'signalroom:roles';

/** Route needs no JWT (login, invite accept, widget, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Roles allowed on a `/tenants/:tid/...` route. TenantGuard fails closed:
 * a tenant route without @Roles is refused, so a forgotten decorator can't leak data.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  // Reaching a handler without a tenant context means a guard was misconfigured.
  if (!tenant) throw new Error('Tenant context missing: route is not under /tenants/:tid');
  return tenant;
});
