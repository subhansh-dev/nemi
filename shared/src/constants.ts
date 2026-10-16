/** Nemi defaults, shared by server and extension. */
export const DEFAULT_PORT = 4877;
export const PORT_ENV = 'NEMI_PORT';

/** Lane identity colors (CSS hex). One stable hue per member. */
export const LANE_COLORS = [
  '#2DD4BF', '#FF7E67', '#A78BFA', '#FACC15',
  '#60A5FA', '#F472B6', '#4ADE80', '#FB923C',
] as const;

/** Transcript safety cap per lane (oldest messages dropped first). */
export const MAX_LANE_MESSAGES = 400;

export function portFromEnv(env: Record<string, string | undefined>): number {
  const raw = Number(env[PORT_ENV]);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PORT;
}
