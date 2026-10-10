/**
 * Avisos de pedidos nuevos en el navegador (panel del comercio y pantalla de reparto).
 * Sin servicios externos: se consulta el servidor cada pocos segundos, y ante algo nuevo se
 * hace sonar un aviso (WebAudio, sin archivos) y, si se dio permiso, una notificación del sistema.
 */

export const ALERT_POLL_MS = 30_000;

/**
 * ¿Entraron pedidos nuevos? `prev` null = primera carga (lo que ya estaba no se avisa).
 * Devuelve los ids que aparecen en `next` y no estaban en `prev`.
 */
export function newIds(prev: readonly string[] | null, next: readonly string[]): string[] {
  if (prev === null) return [];
  const seen = new Set(prev);
  return next.filter((id) => !seen.has(id));
}

/** Título de la pestaña con el contador ("(2) Nuevo pedido · Panel"). */
export function titleWithCount(base: string, unseen: number): string {
  return unseen > 0 ? `(${unseen}) ${unseen === 1 ? "Nuevo pedido" : "Nuevos pedidos"} · ${base}` : base;
}

type AudioCtx = { state: string; currentTime: number; resume(): Promise<void>; createOscillator(): OscillatorNode; createGain(): GainNode; destination: AudioDestinationNode };

/**
 * Sonido de aviso. Los navegadores solo dejan sonar audio después de un toque/click de la
 * persona, así que `unlock()` se llama desde un click (botón "Activar avisos" o cualquier click).
 */
export function createChime() {
  let ctx: AudioCtx | null = null;
  return {
    unlock() {
      try {
        if (!ctx) {
          const C = (window as unknown as { AudioContext?: new () => AudioCtx; webkitAudioContext?: new () => AudioCtx }).AudioContext
            ?? (window as unknown as { webkitAudioContext?: new () => AudioCtx }).webkitAudioContext;
          if (C) ctx = new C();
        }
        if (ctx && ctx.state === "suspended") void ctx.resume();
      } catch { /* sin audio */ }
    },
    get ready() {
      return !!ctx && ctx.state === "running";
    },
    /** Dos tonos cortos ("ding-dong"). No hace nada si el audio no está habilitado. */
    play() {
      if (!ctx || ctx.state !== "running") return;
      const t0 = ctx.currentTime;
      for (const [i, freq] of [880, 660].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.22);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.22 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + i * 0.22);
        osc.stop(t0 + i * 0.22 + 0.21);
      }
    },
  };
}

/** Notificación del sistema (si la persona dio permiso). Silenciosa si no hay soporte. */
export function systemNotify(title: string, body: string): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "nuevo-pedido" });
    }
  } catch { /* sin soporte (p. ej. Safari en iPhone fuera de la app instalada) */ }
}
