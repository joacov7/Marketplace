import { describe, it, expect } from "vitest";
import { planDeliveryRoute, mapsRouteLinks, type RouteStop } from "./route.js";

// Una calle recta hacia el este: cada parada ~1 km más lejos del local.
const LOCAL = { lat: -33.14, lng: -59.31 };
const at = (km: number) => ({ lat: LOCAL.lat, lng: LOCAL.lng + km / 93.3 });
const stop = (id: string, km: number | null, zone: string | null = null, window = "Lun · 13–20"): RouteStop => ({
  id, window, zone, ...(km == null ? { lat: null, lng: null } : at(km)),
});

describe("recorrido de reparto", () => {
  it("ordena las paradas ubicadas desde el local, la más cercana primero", () => {
    const [g] = planDeliveryRoute([stop("c", 3), stop("a", 1), stop("d", 4), stop("b", 2)], LOCAL);
    expect(g!.stops.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(g!.estimatedKm).toBeCloseTo(4, 0);
  });

  it("deshace cruces que deja el vecino más cercano (2-opt)", () => {
    // Desde el local, el más cercano es "x" (0,5 km al oeste) y obliga a cruzar todo el recorrido;
    // el resultado no debe ser más largo que ir primero al este y después volver.
    const stops = [stop("x", -0.5), stop("e1", 0.6), stop("e2", 1.2), stop("e3", 1.8)];
    const [g] = planDeliveryRoute(stops, LOCAL);
    const naive = 0.5 + 0.5 + 0.6 + 0.6 + 0.6; // x, después e1, e2, e3
    expect(g!.estimatedKm).toBeLessThanOrEqual(naive + 0.05);
  });

  it("separa por franja horaria, en orden", () => {
    const groups = planDeliveryRoute([stop("t", 1, null, "Lun · 20–23"), stop("m", 1, null, "Lun · 13–20")], LOCAL);
    expect(groups.map((g) => g.window)).toEqual(["Lun · 13–20", "Lun · 20–23"]);
  });

  it("sin ubicación: junto a las de su barrio; si su barrio no tiene ubicadas, al final por barrio", () => {
    const [g] = planDeliveryRoute([
      stop("centro1", 1, "Centro"), stop("norte1", 3, "Norte"),
      stop("centro-sin", null, "centro"), stop("sur-sin", null, "Sur"), stop("algo-sin", null, "Abasto"),
    ], LOCAL);
    expect(g!.stops.map((s) => s.id)).toEqual(["centro1", "centro-sin", "norte1", "algo-sin", "sur-sin"]);
    expect(g!.withoutLocation).toBe(3);
  });

  it("sin ubicación del local arranca por cualquier punta y no falla sin paradas ubicadas", () => {
    const [g] = planDeliveryRoute([stop("a", 1), stop("b", 2)], null);
    expect(g!.stops).toHaveLength(2);
    const [h] = planDeliveryRoute([stop("x", null, "Centro")], LOCAL);
    expect(h!.stops.map((s) => s.id)).toEqual(["x"]);
    expect(h!.estimatedKm).toBe(0);
  });

  it("links de Google Maps en tramos de 9, encadenados", () => {
    const stops = Array.from({ length: 11 }, (_, i) => stop(`s${i + 1}`, i + 1));
    const links = mapsRouteLinks(stops, LOCAL, (s) => s.id);
    expect(links.map((l) => [l.from, l.to])).toEqual([[1, 9], [10, 11]]);
    const u1 = new URL(links[0]!.url);
    expect(u1.searchParams.get("origin")).toBe(`${LOCAL.lat},${LOCAL.lng}`);
    expect(u1.searchParams.get("waypoints")!.split("|")).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
    expect(u1.searchParams.get("destination")).toBe("s9");
    const u2 = new URL(links[1]!.url);
    expect(u2.searchParams.get("origin")).toBe("s9"); // sigue desde la última del tramo anterior
    expect(u2.searchParams.get("destination")).toBe("s11");
  });

  it("sin local conocido, el primer tramo sale de la ubicación del teléfono (sin origin)", () => {
    const [l] = mapsRouteLinks([stop("a", 1)], null, (s) => s.id);
    expect(new URL(l!.url).searchParams.has("origin")).toBe(false);
  });
});
