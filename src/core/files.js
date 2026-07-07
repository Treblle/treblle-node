// Uploaded-file detection and redaction.
//
// Treblle is a JSON API observability tool — it has no use for the raw bytes of
// an uploaded image or PDF, and sending them would be wasteful (and often blow
// past the 2MB body cap). Instead we detect file uploads in the parsed request
// body and replace each file with a small descriptor of its name, MIME type and
// size, mirroring the behaviour of the other Treblle SDKs.
//
// Different body parsers expose files with different property names:
//   - multer / @koa/multer:  { fieldname, originalname, mimetype, size, buffer }
//   - formidable / koa-body: { originalFilename, mimetype, size, filepath }
//   - @fastify/multipart:    { type: "file", filename, mimetype, _buf }
//   - web standard:          File / Blob { name, type, size }
// `describeFile` normalizes all of these to { name, type, size }.

/**
 * Returns true when `value` looks like an uploaded-file object produced by a
 * body-parsing middleware, or a web-standard File/Blob. Detection requires both
 * a filename-ish field and file metadata (mimetype or size) so plain objects
 * don't get mistaken for files.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isFileLike(value) {
  if (!value || typeof value !== "object") return false;

  // Web-standard File/Blob (available on modern Node and edge runtimes).
  if (typeof File !== "undefined" && value instanceof File) return true;

  const hasName =
    typeof value.originalname === "string" ||
    typeof value.originalFilename === "string" ||
    typeof value.newFilename === "string" ||
    typeof value.filename === "string" ||
    typeof value.filepath === "string" ||
    typeof value.path === "string";

  const hasFileMeta =
    typeof value.mimetype === "string" ||
    typeof value.size === "number" ||
    Buffer.isBuffer(value.buffer) ||
    Buffer.isBuffer(value._buf);

  return hasName && hasFileMeta;
}

/**
 * Normalizes a framework file object into the Treblle file descriptor.
 *
 * @param {object} file a multer/formidable/web file object
 * @returns {{name: (string|null), type: (string|null), size: (number|null)}}
 */
function describeFile(file) {
  const name =
    file.originalname ||
    file.originalFilename ||
    file.filename ||
    file.name ||
    null;
  // Web File/Blob carry the MIME type on `file.type`; @fastify/multipart instead
  // sets `file.type` to the literal "file" (a field-kind tag), so ignore that.
  let type = file.mimetype || null;
  if (!type && file.type && file.type !== "file") {
    type = file.type;
  }

  let size = typeof file.size === "number" ? file.size : null;
  if (size === null && Buffer.isBuffer(file.buffer)) {
    size = file.buffer.length;
  }
  if (size === null && Buffer.isBuffer(file._buf)) {
    size = file._buf.length;
  }

  return { name, type, size };
}

/**
 * Collapses a framework's raw file collection into a map of
 * `{ fieldName: descriptor | descriptor[] }`. Handles every shape the supported
 * parsers produce:
 *   - a single file object            (multer `upload.single`)
 *   - an array of file objects        (multer `upload.array` / `.any`)
 *   - a `{ field: file | file[] }` map (multer `upload.fields`, koa-body, formidable)
 *
 * Fields carrying multiple files collapse to an array of descriptors.
 *
 * @param {*} files framework-specific file collection (req.files, ctx.request.files, …)
 * @returns {Object<string, object>} descriptors keyed by form field name
 */
function descriptorsFromFiles(files) {
  const out = {};

  const add = (field, file) => {
    const descriptor = describeFile(file);
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = [].concat(out[field], descriptor);
    } else {
      out[field] = descriptor;
    }
  };

  if (Array.isArray(files)) {
    for (const file of files) {
      if (isFileLike(file)) add(file.fieldname || "file", file);
    }
  } else if (files && typeof files === "object") {
    if (isFileLike(files)) {
      // A single file object (e.g. multer's req.file).
      add(files.fieldname || "file", files);
    } else {
      // A `{ field: file | file[] }` map. An array value stays an array so the
      // descriptor shape mirrors how the field was submitted.
      for (const [field, value] of Object.entries(files)) {
        if (Array.isArray(value)) {
          out[field] = value.filter(isFileLike).map(describeFile);
        } else if (isFileLike(value)) {
          out[field] = describeFile(value);
        }
      }
    }
  }

  return out;
}

/**
 * Returns a copy of the parsed request body with file descriptors merged in
 * under their form field names. When there are no files the original body is
 * returned untouched (no copy, no allocation) so the common no-upload path is
 * free. The input body is never mutated.
 *
 * @param {*} body parsed request body (text fields only for multipart requests)
 * @param {*} rawFiles framework-specific file collection
 * @returns {*} body with file descriptors folded in
 */
function applyFileDescriptors(body, rawFiles) {
  const descriptors = descriptorsFromFiles(rawFiles);
  const fields = Object.keys(descriptors);
  if (fields.length === 0) return body;

  const base =
    body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
  for (const field of fields) {
    base[field] = descriptors[field];
  }
  return base;
}

/**
 * Redacts file uploads that live *inside* the parsed body rather than in a
 * sidecar collection. Hono's `c.req.parseBody()` returns web `File` objects
 * directly under their form field names (alongside plain text fields), so we
 * walk the body and swap any file-like value for its descriptor. Non-file
 * fields are left as-is and the input is never mutated.
 *
 * @param {*} body parsed request body (may hold File values inline)
 * @returns {*} body with any inline files replaced by descriptors
 */
function redactInlineFiles(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  // descriptorsFromFiles picks out just the file-like fields; applying them
  // back over the body replaces those fields while keeping the text ones.
  return applyFileDescriptors(body, body);
}

/**
 * Redacts a raw binary request body (a `Buffer`, e.g. an image or PDF posted
 * with `express.raw()` or a raw content type) into a descriptor. Such a body
 * has no field name, so `name` is null and the MIME type comes from the request
 * `Content-Type` header. Non-Buffer bodies are returned unchanged.
 *
 * @param {*} body parsed request body
 * @param {string?} contentType the request Content-Type header value
 * @returns {*} the original body, or a { name, type, size } descriptor
 */
function redactBufferBody(body, contentType) {
  if (!Buffer.isBuffer(body)) return body;
  return {
    name: null,
    type: typeof contentType === "string" ? contentType : null,
    size: body.length,
  };
}

module.exports = {
  isFileLike,
  describeFile,
  descriptorsFromFiles,
  applyFileDescriptors,
  redactInlineFiles,
  redactBufferBody,
};
