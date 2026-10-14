/** Small validation helpers shared by the Tuning Data parsers. Every error names the full path. */

export class TuningDataError extends Error {
  override name = 'TuningDataError';
}

export function record(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new TuningDataError(`${where} must be an object, got ${JSON.stringify(v)}`);
  }
  return v as Record<string, unknown>;
}

export function finiteNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TuningDataError(`${where}.${key} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function positiveNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new TuningDataError(`${where}.${key} must be a positive number, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function nonEmptyString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new TuningDataError(`${where}.${key} must be a non-empty string, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function array(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new TuningDataError(`${where} must be an array, got ${JSON.stringify(v)}`);
  return v;
}
