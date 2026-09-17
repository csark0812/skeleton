export function orderLimit(kind: string): number { return LIMITS[kind] ?? 20; }
const LIMITS: Record<string, number> = { standard: 20, regulated: 5 };
