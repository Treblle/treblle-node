const { DefaultBlockedPatterns } = require("../consts");

/**
 * Normalizes a URL or path down to just its pathname, stripping any query
 * string or hash. Handles both absolute URLs (e.g. Hono's `c.req.url`) and
 * plain paths (e.g. Koa's `ctx.request.url`) so blocklist matching is
 * consistent across frameworks and anchored regexes still match.
 * @param {string} urlOrPath
 * @returns {string}
 */
function extractPathname(urlOrPath) {
  if (typeof urlOrPath !== "string") return urlOrPath;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) {
    try {
      return new URL(urlOrPath).pathname;
    } catch {
      // fall through to manual stripping
    }
  }

  const queryIndex = urlOrPath.search(/[?#]/);
  return queryIndex === -1 ? urlOrPath : urlOrPath.slice(0, queryIndex);
}

/**
 * Checks if a request path should be blocked from Treblle tracking.
 *
 * The built-in default patterns (favicon.ico, robots.txt, static assets, etc.)
 * are always applied and cannot be disabled — they are noise that never belongs
 * in an API's traffic. User-defined paths are blocked on top of them.
 *
 * @param {string} path - The request path to check
 * @param {(string[]|RegExp|null)} userBlockedPaths - User-defined blocked paths
 * @returns {boolean} - True if the path should be blocked
 */
function isPathBlocked(path, userBlockedPaths = []) {
  // Check user-defined blocked paths first
  if (userBlockedPaths) {
    if (userBlockedPaths instanceof RegExp) {
      if (userBlockedPaths.test(path)) return true;
    } else if (Array.isArray(userBlockedPaths)) {
      const isUserBlocked = userBlockedPaths.some((blockedPath) => {
        if (typeof blockedPath === 'string') {
          return path.startsWith(`/${blockedPath}`) || path === `/${blockedPath}` || path === blockedPath;
        }
        if (blockedPath instanceof RegExp) {
          return blockedPath.test(path);
        }
        return false;
      });
      if (isUserBlocked) return true;
    }
  }

  // Always apply the built-in default patterns.
  return DefaultBlockedPatterns.some((pattern) => pattern.test(path));
}

/**
 * Convenience wrapper combining pathname extraction and blocklist matching
 * against a normalized config.
 *
 * @param {object} config normalized config from core/config.js
 * @param {string} urlOrPath full URL or plain path of the incoming request
 * @returns {boolean} true when the request should be sent to Treblle
 */
function shouldTrack(config, urlOrPath) {
  return !isPathBlocked(extractPathname(urlOrPath), config.blockedPaths);
}

module.exports = {
  extractPathname,
  isPathBlocked,
  shouldTrack,
};
