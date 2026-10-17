/** Nemi defaults, shared by server and extension. */
export const DEFAULT_PORT = 4877;
export const PORT_ENV = 'NEMI_PORT';

/**
 * Lane identity colors (CSS hex). One stable hue per member.
 *
 * Deliberately desaturated: these sit on a near-black page, where the
 * fully-saturated alternatives read as neon. Every one of them still clears
 * WCAG AA on that background — `scripts/check-ui.mjs` asserts it.
 */
export const LANE_COLORS = [
  '#C7A87A', '#C98A72', '#9DBC8A', '#8CA8CC',
  '#B79CC8', '#CC93A5', '#7FB8B0', '#A9A2D0',
] as const;

/** Transcript safety cap per lane (oldest messages dropped first). */
export const MAX_LANE_MESSAGES = 400;

export function portFromEnv(env: Record<string, string | undefined>): number {
  const raw = Number(env[PORT_ENV]);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PORT;
}
