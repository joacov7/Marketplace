import { haversineKm } from "./delivery.js";

/**
 * Recorrido sugerido de reparto. Sin servicios externos: ordena por franja horaria y, dentro de
 * cada franja, arma el recorrido con las paradas que tienen ubicación (vecino más cercano desde el
 * local + mejora 2-opt, que deshace cruces). Las paradas sin ubicación van con su dirección
 * escrita, pegadas a las de su mismo barrio; si su barrio no tiene ninguna ubicada, al final,
 * agrupadas por barrio. Las distancias son en línea recta: es una guía, no la ruta por calles.
 */

export interface RouteStop {
  id: string;
  /** Franja de entrega (agrupa); las franjas se ordenan alfabéticamente, como la agenda. */
  window: string;
  zone: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RouteGroup<S extends RouteStop> {
  window: string;
  stops: S[];
  /** Paradas sin ubicación exacta (navegan por dirección escrita). */
  withoutLocation: number;
  /** Kilómetros en línea recta del recorrido con ubicación (desde el local si se conoce). */
  estimatedKm: number;
}

type Point = { lat: number; lng: number };
const hasPoint = (s: RouteStop): s is RouteStop & Point => s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng);
const dist = (a: Point, b: Point) => haversineKm(a.lat, a.lng, b.lat, b.lng);

function pathKm(points: Point[], origin: Point | null): number {
  let km = 0;
  let prev = origin;
  for (const p of points) {
    if (prev) km += dist(prev, p);
    prev = p;
  }
  return km;
}

/** Vecino más cercano desde el origen (o desde la primera parada si no hay origen). */
function nearestNeighbor<P extends Point>(points: P[], origin: Point | null): P[] {
  const left = [...points];
  const out: P[] = [];
  let cur: Point | null = origin;
  while (left.length > 0) {
    let best = 0;
    if (cur) {
      let bestD = Infinity;
      left.forEach((p, i) => { const d = dist(cur!, p); if (d < bestD) { bestD = d; best = i; } });
    }
    const [next] = left.splice(best, 1);
    out.push(next!);
    cur = next!;
  }
  return out;
}

/** 2-opt sobre un camino abierto (no vuelve al local): invierte tramos mientras acorte. */
function twoOpt<P extends Point>(route: P[], origin: Point | null): P[] {
  let best = [...route];
  let bestKm = pathKm(best, origin);
  let improved = true;
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const km = pathKm(cand, origin);
        if (km + 1e-9 < bestKm) { best = cand; bestKm = km; improved = true; }
      }
    }
  }
  return best;
}

const zoneKey = (z: string | null) => (z ?? "").trim().toLocaleLowerCase("es");

export function planDeliveryRoute<S extends RouteStop>(stops: S[], origin: Point | null): RouteGroup<S>[] {
  const windows = [...new Set(stops.map((s) => s.window))].sort((a, b) => a.localeCompare(b, "es"));
  return windows.map((window) => {
    const inWindow = stops.filter((s) => s.window === window);
    const located = inWindow.filter(hasPoint) as Array<S & Point>;
    const unlocated = inWindow.filter((s) => !hasPoint(s));

    const ordered: S[] = twoOpt(nearestNeighbor(located, origin), origin);

    // Sin ubicación: después de la última parada ubicada de su mismo barrio; si no hay, al final.
    const tail: S[] = [];
    for (const s of [...unlocated].sort((a, b) => zoneKey(a.zone).localeCompare(zoneKey(b.zone), "es"))) {
      const z = zoneKey(s.zone);
      let at = -1;
      if (z) ordered.forEach((o, i) => { if (zoneKey(o.zone) === z) at = i; });
      if (at >= 0) ordered.splice(at + 1, 0, s);
      else tail.push(s);
    }
    const final = [...ordered, ...tail];

    return {
      window,
      stops: final,
      withoutLocation: unlocated.length,
      estimatedKm: Math.round(pathKm(final.filter(hasPoint) as Point[], origin) * 10) / 10,
    };
  });
}

/** Cuántas paradas entran en un link de Google Maps (destino + 8 intermedias). */
export const MAPS_STOPS_PER_LINK = 9;

/**
 * Links de Google Maps con las paradas en orden, en tramos de hasta 9 (límite de Google Maps).
 * Cada tramo sale de la última parada del anterior (el primero, del local si se conoce, si no
 * desde la ubicación actual del teléfono). `place` da "lat,lng" o la dirección escrita.
 */
export function mapsRouteLinks<S extends RouteStop>(
  stops: S[],
  origin: Point | null,
  place: (s: S) => string,
): Array<{ from: number; to: number; url: string }> {
  const links: Array<{ from: number; to: number; url: string }> = [];
  for (let start = 0; start < stops.length; start += MAPS_STOPS_PER_LINK) {
    const chunk = stops.slice(start, start + MAPS_STOPS_PER_LINK);
    const prev = start > 0 ? place(stops[start - 1]!) : origin ? `${origin.lat},${origin.lng}` : null;
    const params = new URLSearchParams({ api: "1", travelmode: "driving", destination: place(chunk[chunk.length - 1]!) });
    if (prev) params.set("origin", prev);
    const mids = chunk.slice(0, -1).map(place);
    if (mids.length > 0) params.set("waypoints", mids.join("|"));
    links.push({ from: start + 1, to: start + chunk.length, url: `https://www.google.com/maps/dir/?${params.toString()}` });
  }
  return links;
}
