/** Pause for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep calling `action` until it returns a value (not null),
 * or throw an error when the timeout is reached.
 * Example: wait until the magic-link email arrives.
 */
export async function waitUntil<T>(
  action: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number,
): Promise<T> {
  const endTime = Date.now() + timeoutMs;

  while (Date.now() < endTime) {
    const result = await action();
    if (result !== null) {
      return result;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs / 1000} seconds`);
}
