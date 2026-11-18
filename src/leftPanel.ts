export const HEADER_HEIGHT = 30;
export const SECTION_DEFAULT_HEIGHT = 132;
export const SECTION_MINIMUM_HEIGHT = 108;

export interface Limit {
  min: number;
  max?: number;
}

interface Bound {
  minY: number;
  maxY: number;
}

export function limitsFor(open: boolean): Limit {
  return open ? { min: HEADER_HEIGHT + SECTION_MINIMUM_HEIGHT } : { min: HEADER_HEIGHT, max: HEADER_HEIGHT };
}

function clamp(lower: number, upper: number, n: number): number {
  const capped = n <= upper ? n : upper;
  return capped >= lower ? capped : lower;
}

export function handleBounds(height: number, limits: Limit[]): Bound[] {
  let sumMin = 0;
  let sumMax = 0;
  let unbounded = false;
  const first: Bound[] = [];
  for (const limit of limits) {
    if (!limit.max) {
      unbounded = true;
    }
    sumMin += limit.min;
    const bound: Bound = { minY: sumMin, maxY: Math.max(sumMin, height) };
    if (!unbounded) {
      sumMax += limit.max as number;
      bound.maxY = sumMax;
    }
    first.push(bound);
  }
  if (!unbounded && sumMax < height) {
    return first.map((b) => ({ minY: b.maxY, maxY: b.maxY }));
  }
  if (sumMin >= height) {
    return first.map((b) => ({ minY: b.minY, maxY: b.minY }));
  }
  const bounds: Bound[] = [];
  let lower = 0;
  let upper = 0;
  for (const limit of limits) {
    lower += limit.min;
    upper = Math.min(upper + (limit.max ?? Infinity), height);
    bounds.push({ minY: lower, maxY: upper });
  }
  let minTail: number | null = height;
  let maxTail = height;
  bounds[limits.length - 1] = { minY: height, maxY: height };
  for (let i = limits.length - 2; i >= 0; i -= 1) {
    const next = limits[i + 1].max;
    if (next && minTail !== null) {
      minTail -= next;
    } else {
      minTail = null;
    }
    maxTail -= limits[i + 1].min;
    if (minTail !== null) {
      bounds[i].minY = Math.max(bounds[i].minY, minTail);
    }
    bounds[i].maxY = Math.min(bounds[i].maxY, maxTail);
  }
  return bounds;
}

export function defaultYs(keys: string[], saved: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  keys.forEach((key, i) => {
    out[key] = saved[key] ?? (out[keys[i - 1]] || 0) + SECTION_DEFAULT_HEIGHT + HEADER_HEIGHT;
  });
  return out;
}

export function boundedYs(keys: string[], limits: Limit[], height: number, saved: Record<string, number | undefined>): Record<string, number> {
  const raw = defaultYs(keys, saved);
  const bounds = handleBounds(height, limits);
  const out: Record<string, number> = {};
  keys.forEach((key, i) => {
    out[key] = clamp(bounds[i].minY, bounds[i].maxY, raw[key]);
  });
  for (let i = 1; i < keys.length; i += 1) {
    const prev = out[keys[i - 1]];
    const limit = limits[i];
    const lower = prev + limit.min;
    const upper = limit.max ? prev + limit.max : out[keys[i]];
    out[keys[i]] = clamp(lower, upper, out[keys[i]]);
  }
  return out;
}

export function sectionHeights(keys: string[], ys: Record<string, number>): Record<string, number> {
  let top = 0;
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = ys[key] - top;
    top += out[key];
  }
  return out;
}

export function resizableHandles(limits: Limit[]): boolean[] {
  const fixed = (l: Limit) => Boolean(l.max) && l.min === l.max;
  const out = limits.map(() => true);
  for (let i = 0; i < limits.length && fixed(limits[i]); i += 1) {
    out[i] = false;
  }
  out[limits.length - 1] = false;
  for (let i = limits.length - 1; i > -1; i -= 1) {
    out[i] = false;
    if (!fixed(limits[i])) {
      break;
    }
  }
  return out;
}
