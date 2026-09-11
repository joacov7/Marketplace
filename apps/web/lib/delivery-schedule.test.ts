import { describe, it, expect } from "vitest";
import { nextDeliveryDates, dayLabel } from "./delivery-schedule.js";

// Referencia: jueves 11/09/2026 a las 10:00 (antes del corte de las 18).
const thu10 = new Date(2026, 8, 11, 10, 0, 0);
const thu20 = new Date(2026, 8, 11, 20, 0, 0); // después del corte

describe("nextDeliveryDates", () => {
  it("incluye hoy si es día de reparto y aún no pasó la hora de corte", () => {
    const d = nextDeliveryDates([1, 2, 3, 4, 5, 6], 18, thu10, 3);
    expect(dayLabel(d[0]!, thu10)).toBe("Hoy");
    expect(dayLabel(d[1]!, thu10)).toBe("Mañana"); // viernes
  });

  it("saltea hoy cuando ya pasó la hora de corte", () => {
    const d = nextDeliveryDates([1, 2, 3, 4, 5, 6], 18, thu20, 2);
    expect(dayLabel(d[0]!, thu20)).toBe("Mañana"); // viernes
  });

  it("respeta los días habilitados (sin domingos)", () => {
    // Sábado 12/09 tarde → próximo reparto salta el domingo y cae el lunes 14.
    const sat = new Date(2026, 8, 12, 20, 0, 0);
    const d = nextDeliveryDates([1, 2, 3, 4, 5, 6], 18, sat, 1);
    expect(d[0]!.getDay()).toBe(1); // lunes
  });

  it("sin días configurados, no bloquea: trata todos los días como hábiles (defensivo)", () => {
    // Un comercio que borró todos los días no debería romper el checkout.
    expect(nextDeliveryDates([], 18, thu10, 3)).toHaveLength(3);
  });

  it("entrega solo los días marcados (ej: solo martes y jueves)", () => {
    const d = nextDeliveryDates([2, 4], 18, thu20, 3);
    // jueves post-corte → próximo martes, jueves, martes…
    expect(d.map((x) => x.getDay())).toEqual([2, 4, 2]);
  });
});

describe("dayLabel", () => {
  it("formatea fechas lejanas como 'wd dd/mm'", () => {
    expect(dayLabel(new Date(2026, 8, 13), thu10)).toBe("dom 13/09");
  });
});
