// Payload size limits and helpers
//
// Payloads larger than this are dropped and replaced with a small marker
// object. Anything bigger would be stripped out by Treblle's ingress ETL
// anyway, so there is no point spending bandwidth sending it.
const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024; // 2MB in bytes

function estimateObjectSize(obj, visited = new WeakSet()) {
  if (!obj || typeof obj !== "object" || visited.has(obj)) return 0;
  visited.add(obj);

  let size = 0;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      const type = typeof item;
      if (type === "string") {
        size += Buffer.byteLength(item, "utf8");
      } else if (type === "object") {
        size += estimateObjectSize(item, visited);
      } else {
        size += 8; // rough estimate for primitives
      }

      // Early exit if we exceed limit
      if (size > MAX_PAYLOAD_SIZE) return size;
    }
  } else {
    // Walk own enumerable keys with `for...in` rather than Object.entries: the
    // latter allocates a [key, value] pair array for every property, which
    // dominates the cost of this per-request size check on large bodies.
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const value = obj[key];
      size += Buffer.byteLength(key, "utf8"); // key size

      const type = typeof value;
      if (type === "string") {
        size += Buffer.byteLength(value, "utf8");
      } else if (type === "object") {
        size += estimateObjectSize(value, visited);
      } else {
        size += 8; // rough estimate for primitives
      }

      // Early exit if we exceed limit
      if (size > MAX_PAYLOAD_SIZE) return size;
    }
  }

  return size;
}

function getPayloadSize(payload) {
  if (!payload) return 0;
  if (typeof payload === "string") {
    return Buffer.byteLength(payload, "utf8");
  }
  if (Buffer.isBuffer(payload)) {
    return payload.length;
  }
  // Fast recursive estimation without full serialization
  return estimateObjectSize(payload);
}

/**
 * Returns the payload unchanged when it fits under MAX_PAYLOAD_SIZE, otherwise
 * replaces it with a small marker object describing why it was dropped and how
 * big it actually was. The marker is a normal JSON object so it flows through
 * masking and serialization like any other body.
 *
 * @param {*} payload parsed request/response body
 * @param {"request"|"response"} [kind] which body this is, used in the message
 * @returns {*} the original payload, or the too-large marker
 */
function checkPayloadSize(payload, kind = "request") {
  const size = getPayloadSize(payload);
  if (size > MAX_PAYLOAD_SIZE) {
    const label = kind === "response" ? "Response" : "Request";
    return {
      message: `${label} payload is too large`,
      size_bytes: size,
    };
  }
  return payload;
}

module.exports = {
  MAX_PAYLOAD_SIZE,
  getPayloadSize,
  checkPayloadSize,
};
