import { describe, it, expect } from "vitest";
import {
  type FailureStore,
  checkDeliveryAccess,
  deliveryCredential,
  DELIVERY_FAILS_PER_IP,
  DELIVERY_FAILS_PER_TENANT,
} from "./delivery-access.js";

const ADMIN = "codigo-maestro-largo-y-aleatorio-0123456789";
const PIN = "482915";

/** Contador en memoria con la misma semántica que auth_failures (compartido por todo el test). */
const counts = new Map<string, { count: number; resetAt: number }>();
const memoryFailures: FailureStore = {
  async status(keys) {
    const now = Date.now();
    return keys.flatMap((key) => {
      const b = counts.get(key);
      return b && b.resetAt > now ? [{ key, count: b.count, retryAfterMs: b.resetAt - now }] : [];
    });
  },
  async record(keys, windowMs) {
    const now = Date.now();
    for (const key of keys) {
      const b = counts.get(key);
      if (!b || b.resetAt <= now) counts.set(key, { count: 1, resetAt: now + windowMs });
      else b.count += 1;
    }
  },
};

/** Cada test usa su propio comercio para no compartir contadores. */
const tenant = () => `t-${Math.random()}`;

type Attempt = { ok: boolean; status?: number; retryAfterSec?: number; pinLoads: number };

function attempt(tenantId: string, ip: string, provided: string | null, pin: unknown = PIN): Promise<Attempt> {
  let pinLoads = 0;
  return checkDeliveryAccess({
    tenantId,
    ip,
    provided,
    adminToken: ADMIN,
    failures: memoryFailures,
    loadPin: async () => {
      pinLoads += 1;
      return pin;
    },
  }).then((r) => ({ ...r, pinLoads }));
}

describe("deliveryCredential", () => {
  it("acepta código maestro o PIN válido", () => {
    expect(deliveryCredential(ADMIN, ADMIN, PIN)).toBe("admin");
    expect(deliveryCredential(PIN, ADMIN, PIN)).toBe("pin");
  });
  it("rechaza vacío, incorrecto y PIN sin configurar", () => {
    expect(deliveryCredential(null, ADMIN, PIN)).toBe("denied");
    expect(deliveryCredential("000000", ADMIN, PIN)).toBe("denied");
    expect(deliveryCredential("", ADMIN, "")).toBe("denied");
    expect(deliveryCredential("x", undefined, "")).toBe("denied");
  });
  it("un PIN viejo de menos de 6 caracteres ya no abre", () => {
    expect(deliveryCredential("2468", ADMIN, "2468")).toBe("denied");
    expect(deliveryCredential("12345", ADMIN, "12345")).toBe("denied");
  });
});

describe("checkDeliveryAccess — bloqueo por intentos fallidos", () => {
  it("PIN correcto entra; PIN incorrecto → 401", async () => {
    const t = tenant();
    expect((await attempt(t, "1.1.1.1", PIN)).ok).toBe(true);
    const bad = await attempt(t, "1.1.1.1", "111111");
    expect(bad).toMatchObject({ ok: false, status: 401 });
  });

  it("tras 10 fallos desde una IP, ni el PIN correcto entra desde esa IP (antes sí entraba)", async () => {
    const t = tenant();
    for (let i = 0; i < DELIVERY_FAILS_PER_IP; i++) {
      expect((await attempt(t, "6.6.6.6", `bad-${i}-pin`)).status).toBe(401);
    }
    const locked = await attempt(t, "6.6.6.6", PIN);
    expect(locked).toMatchObject({ ok: false, status: 429 });
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(locked.pinLoads).toBe(0); // durante el bloqueo no se consulta la base
    // Otra IP del mismo comercio sigue entrando.
    expect((await attempt(t, "7.7.7.7", PIN)).ok).toBe(true);
  });

  it("los aciertos no consumen cupo (el repartidor puede refrescar todo el día)", async () => {
    const t = tenant();
    for (let i = 0; i < 100; i++) expect((await attempt(t, "2.2.2.2", PIN)).ok).toBe(true);
  });

  it("ataque desde muchas IPs: tras 50 fallos se bloquea el PIN en todo el comercio", async () => {
    const t = tenant();
    for (let i = 0; i < DELIVERY_FAILS_PER_TENANT; i++) {
      expect((await attempt(t, `10.0.0.${i}`, `wrong-${i}`)).status).toBe(401);
    }
    expect((await attempt(t, "9.9.9.9", PIN))).toMatchObject({ ok: false, status: 429 });
  });

  it("el código maestro entra aunque haya bloqueo (el comercio no queda afuera)", async () => {
    const t = tenant();
    for (let i = 0; i < DELIVERY_FAILS_PER_TENANT; i++) await attempt(t, `10.1.0.${i}`, `wrong-${i}`);
    expect((await attempt(t, "10.1.0.1", ADMIN)).ok).toBe(true);
  });

  it("el bloqueo es por comercio: fallos en uno no bloquean otro", async () => {
    const a = tenant();
    const b = tenant();
    for (let i = 0; i < DELIVERY_FAILS_PER_IP; i++) await attempt(a, "3.3.3.3", `bad-${i}-pin`);
    expect((await attempt(a, "3.3.3.3", PIN)).status).toBe(429);
    expect((await attempt(b, "3.3.3.3", PIN)).ok).toBe(true);
  });
});
