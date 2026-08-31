import { describe, it, expect } from "vitest";
import { resolveConfig } from "./engine.js";
import type { ConfigValue, ConfigScopeChain } from "@commerce/contracts";

const chain: ConfigScopeChain = {
  tenantId: "t1",
  regionId: "r1",
  merchantId: "m1",
  userId: "u1",
};

function val(partial: Partial<ConfigValue> & Pick<ConfigValue, "scopeType" | "scopeId" | "value">): ConfigValue {
  return {
    key: "commission.rateBps",
    version: 1,
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    actor: "test",
    ...partial,
  };
}

describe("Config Engine — resolución por precedencia (D1/D8)", () => {
  it("cae al default cuando no hay valores", () => {
    const r = resolveConfig({ key: "commission.rateBps", values: [], chain, defaultValue: 1000 });
    expect(r.value).toBe(1000);
    expect(r.source).toBe("default");
  });

  it("gana el scope más específico (merchant vence a tenant y a platform)", () => {
    const values = [
      val({ scopeType: "platform", scopeId: "platform", value: 1000 }),
      val({ scopeType: "tenant", scopeId: "t1", value: 800 }),
      val({ scopeType: "merchant", scopeId: "m1", value: 600 }),
    ];
    const r = resolveConfig({ key: "commission.rateBps", values, chain, defaultValue: 1000 });
    expect(r.value).toBe(600);
    expect(r.source).toBe("merchant");
  });

  it("un override de OTRO merchant no aplica a este", () => {
    const values = [
      val({ scopeType: "tenant", scopeId: "t1", value: 800 }),
      val({ scopeType: "merchant", scopeId: "m-otro", value: 500 }),
    ];
    const r = resolveConfig({ key: "commission.rateBps", values, chain, defaultValue: 1000 });
    expect(r.value).toBe(800); // usa el del tenant, ignora el merchant ajeno
    expect(r.source).toBe("tenant");
  });

  it("a igual scope, gana la mayor version", () => {
    const values = [
      val({ scopeType: "tenant", scopeId: "t1", value: 800, version: 1 }),
      val({ scopeType: "tenant", scopeId: "t1", value: 700, version: 2 }),
    ];
    const r = resolveConfig({ key: "commission.rateBps", values, chain, defaultValue: 1000 });
    expect(r.value).toBe(700);
    expect(r.version).toBe(2);
  });

  it("effective-dating: un valor futuro no se aplica todavía", () => {
    const values = [
      val({ scopeType: "tenant", scopeId: "t1", value: 800, effectiveFrom: "2020-01-01T00:00:00.000Z" }),
      val({ scopeType: "tenant", scopeId: "t1", value: 600, version: 2, effectiveFrom: "2030-01-01T00:00:00.000Z" }),
    ];
    const r = resolveConfig({
      key: "commission.rateBps",
      values,
      chain,
      defaultValue: 1000,
      at: new Date("2025-06-01T00:00:00.000Z"),
    });
    expect(r.value).toBe(800); // el de 2030 aún no rige
  });
});
