import type {
  Permission,
  RoleAssignment,
  RoleDef,
  ResourceScope,
} from "@commerce/contracts";

/**
 * ¿Una asignación de rol "cubre" al recurso? Un rol se otorga dentro de un scope y aplica
 * solo a los recursos contenidos en él: un rol de tenant cubre todo el tenant; uno de
 * merchant, solo ese merchant. Como los scopeId son ids únicos, un rol de otro tenant/
 * merchant nunca coincide → no hay cruce entre tenants.
 */
function assignmentCoversResource(a: RoleAssignment, resource: ResourceScope): boolean {
  switch (a.scopeType) {
    case "tenant":
      return a.scopeId === resource.tenantId;
    case "region":
      return resource.regionId !== undefined && a.scopeId === resource.regionId;
    case "merchant":
      return resource.merchantId !== undefined && a.scopeId === resource.merchantId;
  }
}

/** Un permiso concreto matchea "orders:read", "orders:*" o "*". */
function grants(permissions: readonly Permission[], needed: Permission): boolean {
  if (permissions.includes(needed) || permissions.includes("*")) return true;
  const [resource] = needed.split(":");
  return resource !== undefined && permissions.includes(`${resource}:*`);
}

/**
 * ¿El usuario tiene `permission` sobre `resource`? Recorre sus asignaciones; solo cuentan
 * las cuyo scope contiene al recurso, y basta que UNA otorgue el permiso.
 */
export function hasPermission(opts: {
  permission: Permission;
  resource: ResourceScope;
  assignments: readonly RoleAssignment[];
  roles: readonly RoleDef[];
}): boolean {
  const roleById = new Map(opts.roles.map((r) => [r.id, r]));
  for (const a of opts.assignments) {
    if (!assignmentCoversResource(a, opts.resource)) continue;
    const role = roleById.get(a.roleId);
    if (role && grants(role.permissions, opts.permission)) return true;
  }
  return false;
}

/** Roles/permisos con MFA requerido presentes en las asignaciones que cubren el recurso. */
export function requiresMfa(opts: {
  resource: ResourceScope;
  assignments: readonly RoleAssignment[];
  roles: readonly RoleDef[];
}): boolean {
  const roleById = new Map(opts.roles.map((r) => [r.id, r]));
  return opts.assignments.some(
    (a) => assignmentCoversResource(a, opts.resource) && roleById.get(a.roleId)?.requiresMfa === true,
  );
}
