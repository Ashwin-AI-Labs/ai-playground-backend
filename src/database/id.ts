/**
 * Application primary keys are PostgreSQL BIGINT identity values.
 * node-pg returns int8 as strings by default; we keep that contract in the API
 * so values remain exact beyond Number.MAX_SAFE_INTEGER.
 */
export const NUMERIC_ID_PATTERN = /^\d+$/;

export function isNumericId(value: unknown): value is string {
  return typeof value === "string" && NUMERIC_ID_PATTERN.test(value);
}

export function toApiId(value: string | number | bigint): string {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error(`Unsafe numeric ID: ${value}`);
    }
    return String(value);
  }
  const trimmed = value.trim();
  if (!NUMERIC_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid numeric ID: ${value}`);
  }
  return trimmed;
}
