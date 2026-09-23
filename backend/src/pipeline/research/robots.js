import { URL } from 'node:url';
import { RESEARCH_DEFAULTS } from './types.js';

/**
 * Parses robots.txt content into structured rules grouped by user-agent.
 * If targetAgent is specified, returns flat list of rules for that agent.
 *
 * @param {string} robotsText
 * @param {string} [targetAgent]
 * @returns {Array}
 */
export function parseRobotsTxt(robotsText, targetAgent = null) {
  if (typeof robotsText !== 'string' || !robotsText.trim()) {
    return [];
  }

  const lines = robotsText.split(/\r?\n/);
  const groups = [];
  let currentAgents = [];
  let currentGroup = null;

  for (let rawLine of lines) {
    const commentIndex = rawLine.indexOf('#');
    const line = (commentIndex !== -1 ? rawLine.slice(0, commentIndex) : rawLine).trim();
    if (!line) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (directive === 'user-agent') {
      const agent = value.toLowerCase();
      if (currentGroup && (currentGroup.disallows.length > 0 || currentGroup.allows.length > 0)) {
        groups.push(currentGroup);
        currentGroup = null;
        currentAgents = [];
      }
      currentAgents.push(agent);
      if (!currentGroup) {
        currentGroup = {
          userAgents: [...currentAgents],
          disallows: [],
          allows: [],
          rules: []
        };
      } else {
        currentGroup.userAgents.push(agent);
      }
    } else if (directive === 'disallow' && currentGroup) {
      if (value) {
        currentGroup.disallows.push(value);
        currentGroup.rules.push({ type: 'disallow', path: value });
      }
    } else if (directive === 'allow' && currentGroup) {
      if (value) {
        currentGroup.allows.push(value);
        currentGroup.rules.push({ type: 'allow', path: value });
      }
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  if (targetAgent) {
    const normalizedTarget = targetAgent.toLowerCase();
    let matchingGroup = groups.find((g) =>
      g.userAgents?.some((a) => a === normalizedTarget || normalizedTarget.includes(a))
    );
    if (!matchingGroup) {
      matchingGroup = groups.find((g) => g.userAgents?.includes('*'));
    }
    return matchingGroup ? matchingGroup.rules : [];
  }

  return groups;
}

/**
 * Evaluates whether a pathname is allowed by parsed robots rules.
 * Supports both group objects and flat rule lists [{ type, path }].
 *
 * @param {string} pathname
 * @param {Array} parsedRules
 * @param {string} [userAgent]
 * @returns {boolean}
 */
export function isPathAllowed(pathname, parsedRules, userAgent = 'IPE-ResearchBot') {
  if (!parsedRules || parsedRules.length === 0) {
    return true; // No rules found, access is permitted
  }

  // 1. Support flat rules array [{ type: 'allow'|'disallow', path }]
  if (parsedRules[0] && parsedRules[0].type && parsedRules[0].path) {
    // Longer prefix matches take precedence in robots.txt standard
    const sorted = [...parsedRules].sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0));
    for (const rule of sorted) {
      if (pathMatches(pathname, rule.path)) {
        return rule.type === 'allow';
      }
    }
    return true;
  }

  // 2. Structured group rules
  const targetAgent = userAgent.toLowerCase();

  let matchingGroup = parsedRules.find((g) =>
    g.userAgents?.some((a) => a === targetAgent || targetAgent.includes(a))
  );

  if (!matchingGroup) {
    matchingGroup = parsedRules.find((g) => g.userAgents?.includes('*'));
  }

  if (!matchingGroup) {
    return true; // No applicable rule group
  }

  // Check explicit allows first
  for (const allowPattern of matchingGroup.allows || []) {
    if (pathMatches(pathname, allowPattern)) {
      return true;
    }
  }

  // Check disallows
  for (const disallowPattern of matchingGroup.disallows || []) {
    if (pathMatches(pathname, disallowPattern)) {
      return false;
    }
  }

  return true;
}

function pathMatches(pathname, pattern) {
  if (!pattern) return false;
  if (pattern === '/') return true;

  // Simple prefix match conforming to standard robots.txt semantics
  if (pattern.endsWith('$')) {
    const rawPattern = pattern.slice(0, -1);
    return pathname === rawPattern;
  }

  return pathname.startsWith(pattern);
}

/**
 * Fetches and parses robots.txt for a given target origin.
 * @param {string} targetUrl
 * @param {Object} [options]
 * @returns {Promise<{ allowed: boolean, rules: Array, warning: string | null }>}
 */
export async function checkRobotsPermission(targetUrl, options = {}) {
  const { fetcher, userAgent = RESEARCH_DEFAULTS.userAgent } = options;

  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;

    if (!fetcher) {
      return { allowed: true, rules: [], warning: null };
    }

    const response = await fetcher(robotsUrl, { isRobots: true });

    if (!response.ok) {
      if (response.status === 404) {
        // 404 indicates no robots restrictions
        return { allowed: true, rules: [], warning: null };
      }
      // 403 or 5xx: conservative approach with warning
      return {
        allowed: true,
        rules: [],
        warning: `robots.txt returned HTTP ${response.status}; proceeded with conservative rate-limited crawling.`
      };
    }

    const rules = parseRobotsTxt(response.text);
    const allowed = isPathAllowed(parsed.pathname || '/', rules, userAgent);

    return {
      allowed,
      rules,
      warning: allowed ? null : `Access to ${parsed.pathname} disallowed by robots.txt`
    };
  } catch (err) {
    return {
      allowed: true,
      rules: [],
      warning: `Unable to retrieve robots.txt (${err.message}); proceeding cautiously.`
    };
  }
}
