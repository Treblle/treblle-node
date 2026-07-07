// Default list of keywords that get masked in request/response bodies and
// headers. This is the default *value* of the `maskedKeywords` option:
// consumers can replace it with their own list, extend it (spread this array),
// or pass an empty array to turn masking off entirely.
const DEFAULT_MASKED_KEYWORDS = [
  "password",
  "pwd",
  "secret",
  "password_confirmation",
  "passwordConfirmation",
  "cc",
  "card_number",
  "cardNumber",
  "ccv",
  "ssn",
  "credit_score",
  "creditScore",
  // Authentication / session credentials commonly present in headers & bodies
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "bearer",
  "x-auth-token",
];

// Pre-generate common mask strings for performance
const MASK_CACHE = new Map();
const MAX_MASK_LENGTH = 32;
for (let i = 1; i <= MAX_MASK_LENGTH; i++) {
  MASK_CACHE.set(i, "*".repeat(i));
}

function getMaskString(length) {
  if (length <= MAX_MASK_LENGTH) {
    return MASK_CACHE.get(length);
  }
  return "*".repeat(length);
}

/**
 * Generates a lookup map of the keywords to mask.
 *
 * We'll use an object because it's faster to check if a key exists in an object,
 * than it is to check if the key exists in an array.
 *
 * The passed array is the authoritative list of keywords to mask. When it is
 * omitted (undefined) the built-in {@link DEFAULT_MASKED_KEYWORDS} are used.
 * When it is an empty array masking is disabled — we return `null` so callers
 * (via {@link maskSensitiveValues}) can skip masking entirely.
 *
 * @param {string[]?} maskedKeywords the keywords to mask (defaults to the built-in list)
 * @returns {object|null} lookup map, or null when masking is disabled
 */
function generateFieldsToMaskMap(maskedKeywords = DEFAULT_MASKED_KEYWORDS) {
  if (!Array.isArray(maskedKeywords) || maskedKeywords.length === 0) {
    // No keywords configured — masking is turned off.
    return null;
  }
  const fieldsMap = {};
  // Keys are stored lower-cased so matching is case-insensitive.
  for (const field of maskedKeywords) {
    fieldsMap[String(field).toLowerCase()] = true;
  }
  return fieldsMap;
}

/**
 * Masks a value that belongs to a sensitive field, regardless of its type.
 * Strings/numbers/booleans become a run of asterisks; nested
 * objects/arrays are masked recursively so no leaf value leaks.
 *
 * @param {*} value
 * @returns {*}
 */
function maskValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return getMaskString(value.length);
  if (typeof value === "number" || typeof value === "boolean") {
    return getMaskString(String(value).length);
  }
  if (Array.isArray(value)) return value.map(maskValue);
  if (typeof value === "object") {
    const masked = {};
    for (const key in value) {
      masked[key] = maskValue(value[key]);
    }
    return masked;
  }
  return value;
}

/**
 * Takes an object representing the payload and masks its sensitive fields.
 * Matching is case-insensitive and applies to values of any type.
 *
 * Uses a copy-on-write strategy: subtrees that contain no masked values are
 * returned by reference rather than being rebuilt. In the common case where a
 * request/response body has no sensitive fields, the original object flows
 * straight through with zero extra allocation (the previous implementation
 * deep-cloned every body on every request). The input is never mutated — a
 * fresh container is allocated the moment a descendant actually changes.
 *
 * @param {object} payloadObject
 * @returns {object}
 */
function maskSensitiveValues(payloadObject, fieldsToMaskMap) {
  // No map means masking is disabled — the payload flows through untouched.
  if (!fieldsToMaskMap) return payloadObject;
  if (payloadObject === null || payloadObject === undefined) {
    return payloadObject;
  }
  if (typeof payloadObject !== "object") return payloadObject;

  if (Array.isArray(payloadObject)) {
    let changed = false;
    const out = new Array(payloadObject.length);
    for (let i = 0; i < payloadObject.length; i++) {
      const masked = maskSensitiveValues(payloadObject[i], fieldsToMaskMap);
      out[i] = masked;
      if (masked !== payloadObject[i]) changed = true;
    }
    return changed ? out : payloadObject;
  }

  // Alias the input; only clone once a value below us actually differs.
  let safeObject = payloadObject;
  for (const propName in payloadObject) {
    const value = payloadObject[propName];

    let masked;
    if (fieldsToMaskMap[propName.toLowerCase()] === true) {
      masked = maskValue(value);
    } else if (value !== null && typeof value === "object") {
      masked = maskSensitiveValues(value, fieldsToMaskMap);
    } else {
      masked = value;
    }

    if (masked !== value) {
      if (safeObject === payloadObject) safeObject = { ...payloadObject };
      safeObject[propName] = masked;
    }
  }

  return safeObject;
}

module.exports = {
  DEFAULT_MASKED_KEYWORDS,
  generateFieldsToMaskMap,
  maskSensitiveValues,
};
