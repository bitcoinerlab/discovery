export async function waitFor(
  description: string,
  check: () => Promise<void>,
  timeout = 30000
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const detail =
        lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Timed out waiting for ${description}: ${detail}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
