/**
 * Lógica pura de agenda de entrega (sin dependencias): calcula las próximas fechas en que el
 * comercio reparte, respetando los días habilitados (0=domingo … 6=sábado) y la hora de corte
 * (pedidos después de esa hora pasan al próximo día). Corre en el navegador del cliente, así usa
 * su hora local (Argentina) y evita el desfasaje de zona horaria del servidor (UTC).
 */
const WD_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const WEEKDAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: "Lun" }, { n: 2, label: "Mar" }, { n: 3, label: "Mié" }, { n: 4, label: "Jue" },
  { n: 5, label: "Vie" }, { n: 6, label: "Sáb" }, { n: 0, label: "Dom" },
];

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Próximas `count` fechas de reparto desde `now`, según días habilitados y hora de corte. */
export function nextDeliveryDates(deliverDays: number[], cutoffHour: number, now: Date, count: number): Date[] {
  const set = new Set((deliverDays?.length ? deliverDays : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => d >= 0 && d <= 6));
  if (set.size === 0 || count <= 0) return [];
  const today = midnight(now);
  const pastCutoff = now.getHours() >= cutoffHour;
  const out: Date[] = [];
  const cursor = new Date(today);
  for (let guard = 0; out.length < count && guard < 90; guard++) {
    const isToday = cursor.getTime() === today.getTime();
    if (set.has(cursor.getDay()) && !(isToday && pastCutoff)) out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Etiqueta amable de una fecha: "Hoy", "Mañana", o "sáb 13/09". */
export function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((midnight(d).getTime() - midnight(now).getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  return `${WD_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
