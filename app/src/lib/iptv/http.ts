import { AppError } from '../errors';

/** fetch() with a timeout, no cookies, no referrer — and no credential logging, ever. */
export async function fetchSource(url: string, timeoutMs = 45_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) throw new AppError('auth');
    if (!res.ok) throw new AppError('network', `HTTP ${res.status}`);
    return res;
  } catch (e) {
    if (e instanceof AppError) throw e;
    // CORS failures, DNS errors and timeouts are indistinguishable by design.
    throw new AppError('network');
  } finally {
    clearTimeout(timer);
  }
}

/** Reads text, transparently inflating .gz payloads (common for XMLTV guides). */
export async function readText(res: Response, url: string): Promise<string> {
  const gz = /\.gz(\?|$)/i.test(url) && typeof DecompressionStream !== 'undefined' && res.body;
  if (!gz) return res.text();
  try {
    return await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).text();
  } catch {
    throw new AppError('network');
  }
}
