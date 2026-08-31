import { describe, it, expect } from "vitest";
import { hasPermission, requiresMfa } from "./check.js";
import type { RoleDef, RoleAssignment } from "@commerce/contracts";

const roles: RoleDef[] = [
  { id: "tenant_admin", name: "Tenant Admin", permissions: ["*"], requiresMfa: true },
  { id: "merchant_owner", name: "Merchant Owner", permissions: ["orders:*", "catalog:*"], requiresMfa: false },
  { id: "driver", name: "Cadete", permissions: ["delivery:read", "delivery:transition"], requiresMfa: false },
];

describe("RBAC — permisos scopeados con contención (multi-tenant)", () => {
  it("tenant_admin puede sobre cualquier merchant de SU tenant", () => {
    const assignments: RoleAssignment[] = [
      { userId: "u1", roleId: "tenant_admin", scopeType: "tenant", scopeId: "t1" },
    ];
    expect(
      hasPermission({
        permission: "orders:transition",
        resource: { tenantId: "t1", merchantId: "m1" },
        assignments,
        roles,
      }),
    ).toBe(true);
  });

  it("merchant_owner NO puede sobre otro merchant", () => {
    const assignments: RoleAssignment[] = [
      { userId: "u2", roleId: "merchant_owner", scopeType: "merchant", scopeId: "m1" },
    ];
    expect(
      hasPermission({
        permission: "orders:read",
        resource: { tenantId: "t1", merchantId: "m2" },
        assignments,
        roles,
      }),
    ).toBe(false);
  });

  it("un rol de OTRO tenant nunca aplica (sin cruce entre tenants)", () => {
    const assignments: RoleAssignment[] = [
      { userId: "u3", roleId: "tenant_admin", scopeType: "tenant", scopeId: "t-otro" },
    ];
    expect(
      hasPermission({
        permission: "orders:read",
        resource: { tenantId: "t1", merchantId: "m1" },
        assignments,
        roles,
      }),
    ).toBe(false);
  });

  it("wildcard de recurso: orders:* cubre orders:transition, no payout:approve", () => {
    const assignments: RoleAssignment[] = [
      { userId: "u2", roleId: "merchant_owner", scopeType: "merchant", scopeId: "m1" },
    ];
    const resource = { tenantId: "t1", merchantId: "m1" };
    expect(hasPermission({ permission: "orders:transition", resource, assignments, roles })).toBe(true);
    expect(hasPermission({ permission: "payout:approve", resource, assignments, roles })).toBe(false);
  });

  it("requiresMfa detecta roles admin/dinero", () => {
    const assignments: RoleAssignment[] = [
      { userId: "u1", roleId: "tenant_admin", scopeType: "tenant", scopeId: "t1" },
    ];
    expect(requiresMfa({ resource: { tenantId: "t1" }, assignments, roles })).toBe(true);
  });
});
