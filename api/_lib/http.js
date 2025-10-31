// api/_lib/http.js

/**
 * Fetch with timeout and retry for transient errors
 */
export async function fetchWithTimeout(
  url,
  opts = {},
  { timeoutMs = 12000, retries = 2 } = {}
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });

    // Retry on transient errors
    if (
      !res.ok &&
      retries > 0 &&
      [429, 500, 502, 503, 504].includes(res.status)
    ) {
      await new Promise((r) =>
        setTimeout(r, 300 + Math.random() * 500)
      );
      return fetchWithTimeout(url, opts, {
        timeoutMs,
        retries: retries - 1,
      });
    }

    return res;
  } finally {
    clearTimeout(t);
  }
}
