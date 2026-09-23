import { URL } from 'node:url';

/**
 * Checks whether an IPv4 address belongs to private, loopback, or reserved ranges.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv4(ip) {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 100.64.0.0/10 (Shared address space)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24, 192.0.2.0/24 (Documentation/TEST-NET-1)
  if (a === 192 && b === 0) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address belongs to loopback, private, or link-local ranges.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv6(ip) {
  const cleanIp = ip.replace(/^\[|\]$/g, '').toLowerCase();

  // ::1 loopback or :: unspecified
  if (cleanIp === '::1' || cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Unique local: fc00::/7 (starts with fc or fd)
  if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
    return true;
  }

  // Link-local unicast: fe80::/10 (starts with fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(cleanIp)) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc)
  if (cleanIp.includes('::ffff:')) {
    const ipv4Part = cleanIp.split('::ffff:')[1];
    if (ipv4Part && isPrivateOrReservedIpv4(ipv4Part)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates and normalizes a company website URL.
 * Enforces protocol, hostname, and SSRF restrictions.
 *
 * @param {string} inputUrl
 * @param {Object} options
 * @param {boolean} [options.allowLocal=false]
 * @returns {{ valid: boolean, normalizedUrl?: string, error?: string }}
 */
export function validateCompanyUrl(inputUrl, options = {}) {
  const { allowLocal = false } = options;

  if (typeof inputUrl !== 'string' || !inputUrl.trim()) {
    return { valid: false, error: 'Company website URL is required' };
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Enforce http/https protocols only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https protocols are supported' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!hostname) {
    return { valid: false, error: 'URL must contain a valid hostname' };
  }

  if (!allowLocal) {
    // Check localhost string
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return { valid: false, error: 'Localhost addresses are not permitted' };
    }

    // Check IPv4 addresses
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      if (isPrivateOrReservedIpv4(hostname)) {
        return { valid: false, error: 'Private or loopback IP addresses are not permitted' };
      }
    }

    // Check IPv6 addresses
    if (hostname.includes(':') || hostname.startsWith('[')) {
      if (isPrivateOrReservedIpv6(hostname)) {
        return { valid: false, error: 'Private or loopback IPv6 addresses are not permitted' };
      }
    }
  }

  // Remove hash and trailing slash for standard company root where appropriate
  parsed.hash = '';

  return {
    valid: true,
    normalizedUrl: parsed.href
  };
}
