import type { ID } from "./ids.js";

/**
 * Permiso = verbo:recurso (ej. "orders:read", "orders:transition", "config:write",
 * "payout:approve"). Los agentes tienen su propio scope de tools (agent-core), separado
 * de este RBAC humano.
 */
export type Permission = string;

/**
 * Scope donde un rol aplica. Un rol se otorga DENTRO de un scope: "Owner del Merchant X",
 * "Admin del Tenant Y". Un usuario puede tener roles en varios scopes.
 */
export type RoleScopeType = "tenant" | "region" | "merchant";

export interface RoleDef {
  id: ID;
  name: string;
  permissions: Permission[];
  /** Si requiere MFA para las acciones de este rol (admins/dinero). */
  requiresMfa: boolean;
}

/** Asignación de un rol a un usuario dentro de un scope concreto. */
export interface RoleAssignment {
  userId: ID;
  roleId: ID;
  scopeType: RoleScopeType;
  scopeId: ID;
}

/** Coordenadas del recurso sobre el que se chequea un permiso. */
export interface ResourceScope {
  tenantId: ID;
  regionId?: ID;
  merchantId?: ID;
}
