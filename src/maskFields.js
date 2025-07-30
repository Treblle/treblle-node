const fieldsToMask = [
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
];

// Pre-generate common mask strings for performance
const MASK_CACHE = new Map();
const MAX_MASK_LENGTH = 256;
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
 * Generates an object of fields to mask.
 *
 * We'll use an object because it's faster to check if a key exists in an object,
 * then it is to check if the key exists in an array.
 *
 * @param {string[]?} additionalFieldsToMask
 * @returns {object}
 */
function generateFieldsToMaskMap(additionalFieldsToMask = []) {
  const fields = [...fieldsToMask, ...additionalFieldsToMask];
  const fieldsMap = fields.reduce((acc, field) => {
    acc[field] = true;
    return acc;
  }, {});
  return fieldsMap;
}

/**
 * Takes an object representing the payload and masks its sensitive fields.
 *
 * @param {object} payloadObject
 * @returns {object}
 */
function maskSensitiveValues(payloadObject, fieldsToMaskMap) {
  if (typeof payloadObject === null) return null;
  if (typeof payloadObject !== "object") return payloadObject;
  if (Array.isArray(payloadObject)) {
    return payloadObject.map((val) =>
      maskSensitiveValues(val, fieldsToMaskMap)
    );
  }

  // Optimize: avoid object spread for better performance
  let objectToMask = payloadObject;

  let safeObject = Object.keys(objectToMask).reduce(function (acc, propName) {
    if (typeof objectToMask[propName] === "string") {
      if (fieldsToMaskMap[propName] === true) {
        acc[propName] = getMaskString(objectToMask[propName].length);
      } else {
        acc[propName] = objectToMask[propName];
      }
    } else if (Array.isArray(objectToMask[propName])) {
      acc[propName] = objectToMask[propName].map((val) =>
        maskSensitiveValues(val, fieldsToMaskMap)
      );
    } else if (
      typeof objectToMask[propName] === "object" &&
      objectToMask[propName] !== null
    ) {
      acc[propName] = maskSensitiveValues(
        objectToMask[propName],
        fieldsToMaskMap
      );
    } else {
      acc[propName] = objectToMask[propName];
    }

    return acc;
  }, {});

  return safeObject;
}

module.exports = {
  generateFieldsToMaskMap,
  maskSensitiveValues,
};
