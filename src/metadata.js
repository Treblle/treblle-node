const { getActiveStore } = require("./queryTracking");

// Upper bounds to keep custom metadata small and predictable. Metadata is meant
// for search/filtering, not for shipping payloads — so keys past the cap and
// over-long strings are dropped/truncated silently, mirroring `trackQuery`.
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_VALUE_LENGTH = 128;

// Returned by `normalizeValue` to signal "this value can't be stored" so the
// caller skips the pair. `undefined` can't be used as the sentinel because it is
// itself an unstorable value we want to reject.
const INVALID_VALUE = Symbol("invalid-metadata-value");

/**
 * Normalizes a metadata key: it must be a non-empty string, is trimmed, and is
 * truncated to `MAX_METADATA_KEY_LENGTH`.
 * @param {*} key
 * @returns {string|null} the cleaned key, or null if unusable
 */
function normalizeKey(key) {
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_METADATA_KEY_LENGTH
    ? trimmed.slice(0, MAX_METADATA_KEY_LENGTH)
    : trimmed;
}

/**
 * Normalizes a metadata value. Only primitives useful for search/filtering are
 * kept: strings (truncated), finite numbers, and booleans. Everything else
 * (objects, arrays, null, undefined, bigint, symbol, function, NaN/Infinity) is
 * rejected with the `INVALID_VALUE` sentinel.
 * @param {*} value
 * @returns {string|number|boolean|typeof INVALID_VALUE}
 */
function normalizeValue(value) {
  const type = typeof value;
  if (type === "string") {
    return value.length > MAX_METADATA_VALUE_LENGTH
      ? value.slice(0, MAX_METADATA_VALUE_LENGTH)
      : value;
  }
  if (type === "number") {
    return Number.isFinite(value) ? value : INVALID_VALUE;
  }
  if (type === "boolean") {
    return value;
  }
  return INVALID_VALUE;
}

/**
 * Writes a single normalized pair into the store's metadata bucket. Overwriting
 * an existing key is always allowed; a brand-new key is dropped once the bucket
 * already holds `MAX_METADATA_KEYS`.
 * @param {object} metadata the store.metadata object
 * @param {*} key
 * @param {*} value
 */
function applyPair(metadata, key, value) {
  const cleanKey = normalizeKey(key);
  if (cleanKey === null) return;

  const cleanValue = normalizeValue(value);
  if (cleanValue === INVALID_VALUE) return;

  const isNewKey = !Object.prototype.hasOwnProperty.call(metadata, cleanKey);
  if (isNewKey && Object.keys(metadata).length >= MAX_METADATA_KEYS) return;

  metadata[cleanKey] = cleanValue;
}

/**
 * Attaches custom key/value metadata to the current request. The collected pairs
 * are sent to Treblle as `data.metadata`, alongside `data.request` /
 * `data.response` / `data.queries`, and are primarily used for search and
 * filtering.
 *
 * Two call shapes are supported:
 *   setMetadata("user-id", "john");
 *   setMetadata({ plan: "premium", region: "eu" });
 *
 * Safe to call from anywhere; it is a no-op when there is no active request
 * context (e.g. called outside a request, or when the framework isn't wired up).
 * Values are limited to strings, finite numbers, and booleans; keys and string
 * values are length-limited and there is a cap on the number of keys per request
 * (see the MAX_METADATA_* constants). Anything exceeding a limit is dropped or
 * truncated silently — metadata is not masked, so never put secrets in it.
 *
 * @param {string|Record<string, string|number|boolean>} keyOrObject a key, or an
 *   object of key/value pairs
 * @param {string|number|boolean} [value] the value, when a key is passed
 */
function setMetadata(keyOrObject, value) {
  const store = getActiveStore();
  if (!store) return;
  if (!store.metadata || typeof store.metadata !== "object") {
    store.metadata = {};
  }

  if (
    keyOrObject &&
    typeof keyOrObject === "object" &&
    !Array.isArray(keyOrObject)
  ) {
    for (const key of Object.keys(keyOrObject)) {
      applyPair(store.metadata, key, keyOrObject[key]);
    }
    return;
  }

  applyPair(store.metadata, keyOrObject, value);
}

/**
 * Returns the metadata recorded on a store, or an empty object.
 * @param {object} store store from `createQueryStore`
 * @returns {Record<string, string|number|boolean>}
 */
function getMetadata(store) {
  return store && store.metadata && typeof store.metadata === "object"
    ? store.metadata
    : {};
}

module.exports = {
  MAX_METADATA_KEYS,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  setMetadata,
  getMetadata,
  normalizeKey,
  normalizeValue,
};
