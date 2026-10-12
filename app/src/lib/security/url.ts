import { AppError } from '../errors';

/**
 * Validation for user-supplied source URLs.
 * The same rules must be enforced again by any future server-side proxy
 * (after DNS resolution) — this module is the single source of truth for them.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'metadata.google.internal', 'metadata', 'instance-data', '0.0.0.0', '[::]', '[::1]',
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||          // link-local + cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224
  );
}

function isPrivateIPv6(host: string): boolean {
  if (!host.startsWith('[')) return false;
  const h = host.slice(1, -1).toLowerCase();
  return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
}

export function validateSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError('invalid-url');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new AppError('invalid-url');
  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || isPrivateIPv4(host) || isPrivateIPv6(host)
  ) {
    throw new AppError('blocked-host');
  }
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol === 'http:') {
    // Browsers refuse http:// requests from an https:// page (mixed content).
    throw new AppError('insecure-source');
  }
  return url;
}

/** Strip anything that could carry markup; names are always rendered as text anyway. */
export const sanitizeText = (value: string, max = 200): string =>
  value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

/** Only http(s) and data:image URLs may be used as artwork. */
export function safeImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : undefined;
}
