/** Fail at the boundary where an expected record or DOM element is missing. */
export function required<T>(value: T | null | undefined, message = 'Required value is missing'): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}
