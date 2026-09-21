/**
 * Safe JSON fetch and parse utilities for high resilience across Cloudflare,
 * Cloudflare Pages, edge proxies, and offline environments.
 *
 * Prevents "JSON.parse: unexpected end of data at line 1 column 1 of the JSON data"
 * errors caused by:
 * - Empty response bodies (0-byte responses, 204 No Content, empty proxy replies)
 * - Cloudflare proxy timeouts (HTTP 524, 521, 520) returning empty or HTML responses
 * - Cloudflare Pages SPA fallback returning HTML (index.html) instead of API JSON
 * - DNS-over-HTTPS queries with missing Accept headers or rate-limits
 */

export interface SafeFetchResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  isHtml?: boolean;
  isEmpty?: boolean;
  rawText?: string;
}

/**
 * Safely fetches a URL and parses JSON without throwing SyntaxError on empty or HTML bodies.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(input, init);
    const text = await res.text();

    if (!text || !text.trim()) {
      return {
        ok: false,
        status: res.status,
        data: null,
        isEmpty: true,
        error: `Server or Cloudflare returned an empty response (HTTP ${res.status}).`
      };
    }

    const trimmed = text.trim();

    // Check if the response is an HTML document (e.g. Cloudflare SPA fallback or HTML error page)
    if (
      trimmed.startsWith('<') ||
      trimmed.toLowerCase().startsWith('<!doctype') ||
      trimmed.toLowerCase().startsWith('<html')
    ) {
      return {
        ok: false,
        status: res.status,
        data: null,
        isHtml: true,
        rawText: trimmed.slice(0, 300),
        error: `Received HTML document instead of JSON (HTTP ${res.status}). This usually indicates Cloudflare static routing or a missing backend endpoint.`
      };
    }

    try {
      const data = JSON.parse(trimmed) as T;
      return {
        ok: res.ok,
        status: res.status,
        data,
        error: res.ok ? undefined : (data as any)?.error || (data as any)?.message || `Request failed with HTTP ${res.status}`
      };
    } catch (parseErr: any) {
      return {
        ok: false,
        status: res.status,
        data: null,
        rawText: trimmed.slice(0, 300),
        error: `Invalid JSON returned by server: ${parseErr.message}`
      };
    }
  } catch (netErr: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: netErr.message || 'Network request failed or was blocked.'
    };
  }
}

/**
 * Safely parses a JSON string, returning a default fallback if the string is
 * empty, corrupted, HTML, or invalid.
 */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/**
 * Client-Side DNS MX Resolver using DNS-over-HTTPS (DoH).
 * Works 100% in the browser with Google DoH and Cloudflare DoH fallback.
 * Operates without requiring any Node.js backend.
 */
export async function resolveDomainMxClientSide(domain: string): Promise<{
  isLive: boolean;
  hasMx: boolean;
  mxHost?: string;
  provider?: string;
  error?: string;
}> {
  const cleanDomain = domain
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
    .split('/')[0]
    .trim();

  if (!cleanDomain || !cleanDomain.includes('.')) {
    return { isLive: false, hasMx: false, error: 'Invalid domain syntax' };
  }

  // 1. Attempt Google DNS-over-HTTPS
  try {
    const gRes = await safeFetchJson<any>(
      `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=MX`
    );

    if (gRes.data && Array.isArray(gRes.data.Answer) && gRes.data.Answer.length > 0) {
      const records = gRes.data.Answer
        .map((a: any) => (a.data || '').toLowerCase().trim())
        .filter(Boolean);

      const bestMx = records[0] || 'mail.server.active';
      return {
        isLive: true,
        hasMx: true,
        mxHost: bestMx,
      };
    }
  } catch {
    // Continue to fallback
  }

  // 2. Fallback to Cloudflare DNS-over-HTTPS with strict Accept header
  try {
    const cfRes = await safeFetchJson<any>(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=MX`,
      {
        headers: { Accept: 'application/dns-json' }
      }
    );

    if (cfRes.data && Array.isArray(cfRes.data.Answer) && cfRes.data.Answer.length > 0) {
      const records = cfRes.data.Answer
        .map((a: any) => (a.data || '').toLowerCase().trim())
        .filter(Boolean);

      const bestMx = records[0] || 'mail.server.active';
      return {
        isLive: true,
        hasMx: true,
        mxHost: bestMx,
      };
    }
  } catch {
    // Continue to A record check
  }

  // 3. If no MX answers found, check A record to verify if domain is active website or completely dead
  try {
    const aRes = await safeFetchJson<any>(
      `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=A`
    );

    if (aRes.data && Array.isArray(aRes.data.Answer) && aRes.data.Answer.length > 0) {
      return {
        isLive: false,
        hasMx: false,
        error: 'Active web domain but no MX mail exchange configured'
      };
    }
  } catch {}

  return {
    isLive: false,
    hasMx: false,
    error: 'Dead or unregistered domain (No MX or A records)'
  };
}
