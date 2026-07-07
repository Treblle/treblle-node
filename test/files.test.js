// Unit tests for uploaded-file detection and redaction (src/core/files.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  isFileLike,
  describeFile,
  descriptorsFromFiles,
  applyFileDescriptors,
  redactInlineFiles,
  redactBufferBody,
} = require("../src/core/files");

// A multer file object (memory storage).
const multerFile = {
  fieldname: "avatar",
  originalname: "invoice.pdf",
  encoding: "7bit",
  mimetype: "application/pdf",
  size: 20345,
  buffer: Buffer.alloc(4),
};

// A formidable file object (koa-body).
const formidableFile = {
  originalFilename: "photo.png",
  newFilename: "abc123.png",
  filepath: "/tmp/abc123.png",
  mimetype: "image/png",
  size: 8192,
};

test("isFileLike recognizes multer and formidable files", () => {
  assert.equal(isFileLike(multerFile), true);
  assert.equal(isFileLike(formidableFile), true);
});

test("isFileLike rejects plain objects and primitives", () => {
  assert.equal(isFileLike({ name: "Ada", age: 30 }), false);
  assert.equal(isFileLike({ originalname: "x.png" }), false); // no meta
  assert.equal(isFileLike(null), false);
  assert.equal(isFileLike("file"), false);
  assert.equal(isFileLike(42), false);
});

test("describeFile normalizes multer files to name/type/size", () => {
  assert.deepEqual(describeFile(multerFile), {
    name: "invoice.pdf",
    type: "application/pdf",
    size: 20345,
  });
});

test("describeFile normalizes formidable files to name/type/size", () => {
  assert.deepEqual(describeFile(formidableFile), {
    name: "photo.png",
    type: "image/png",
    size: 8192,
  });
});

test("describeFile falls back to buffer length when size is absent", () => {
  const file = {
    originalname: "raw.bin",
    mimetype: "application/octet-stream",
    buffer: Buffer.alloc(16),
  };
  assert.deepEqual(describeFile(file), {
    name: "raw.bin",
    type: "application/octet-stream",
    size: 16,
  });
});

test("descriptorsFromFiles handles a single file object (upload.single)", () => {
  assert.deepEqual(descriptorsFromFiles(multerFile), {
    avatar: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
  });
});

test("descriptorsFromFiles groups an array by field name (upload.array)", () => {
  const files = [
    {
      fieldname: "photos",
      originalname: "a.png",
      mimetype: "image/png",
      size: 1,
    },
    {
      fieldname: "photos",
      originalname: "b.png",
      mimetype: "image/png",
      size: 2,
    },
  ];
  assert.deepEqual(descriptorsFromFiles(files), {
    photos: [
      { name: "a.png", type: "image/png", size: 1 },
      { name: "b.png", type: "image/png", size: 2 },
    ],
  });
});

test("descriptorsFromFiles handles a field map (upload.fields / koa-body)", () => {
  const files = {
    avatar: multerFile,
    docs: [formidableFile],
  };
  assert.deepEqual(descriptorsFromFiles(files), {
    avatar: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
    docs: [{ name: "photo.png", type: "image/png", size: 8192 }],
  });
});

test("applyFileDescriptors merges file descriptors into the text body", () => {
  const body = { title: "My upload" };
  const merged = applyFileDescriptors(body, multerFile);
  assert.deepEqual(merged, {
    title: "My upload",
    avatar: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
  });
  // input body is not mutated
  assert.deepEqual(body, { title: "My upload" });
});

test("applyFileDescriptors returns the body untouched when there are no files", () => {
  const body = { title: "no files" };
  assert.equal(applyFileDescriptors(body, undefined), body);
  assert.equal(applyFileDescriptors(body, {}), body);
  assert.equal(applyFileDescriptors(body, []), body);
});

test("applyFileDescriptors copes with an empty/absent text body", () => {
  assert.deepEqual(applyFileDescriptors(undefined, multerFile), {
    avatar: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
  });
});

test("isFileLike and describeFile recognize web File objects", () => {
  const file = new File([new Uint8Array(12)], "photo.png", {
    type: "image/png",
  });
  assert.equal(isFileLike(file), true);
  assert.deepEqual(describeFile(file), {
    name: "photo.png",
    type: "image/png",
    size: 12,
  });
});

test("redactInlineFiles replaces inline File values, keeping text fields", () => {
  const body = {
    title: "My upload",
    document: new File([new Uint8Array(20345)], "invoice.pdf", {
      type: "application/pdf",
    }),
  };
  const redacted = redactInlineFiles(body);
  assert.deepEqual(redacted, {
    title: "My upload",
    document: { name: "invoice.pdf", type: "application/pdf", size: 20345 },
  });
  // original body is not mutated
  assert.ok(body.document instanceof File);
});

test("redactInlineFiles handles an array of inline files under one field", () => {
  const body = {
    photos: [
      new File([new Uint8Array(1)], "a.png", { type: "image/png" }),
      new File([new Uint8Array(2)], "b.png", { type: "image/png" }),
    ],
  };
  assert.deepEqual(redactInlineFiles(body), {
    photos: [
      { name: "a.png", type: "image/png", size: 1 },
      { name: "b.png", type: "image/png", size: 2 },
    ],
  });
});

test("redactInlineFiles returns non-object bodies untouched", () => {
  assert.equal(redactInlineFiles("plain text"), "plain text");
  assert.equal(redactInlineFiles(null), null);
});

// @fastify/multipart (attachFieldsToBody) file object.
const fastifyFile = {
  type: "file",
  fieldname: "document",
  filename: "invoice.pdf",
  mimetype: "application/pdf",
  _buf: Buffer.alloc(20345),
};

test("isFileLike recognizes @fastify/multipart file objects", () => {
  assert.equal(isFileLike(fastifyFile), true);
});

test("describeFile normalizes fastify files, ignoring the 'file' type tag", () => {
  assert.deepEqual(describeFile(fastifyFile), {
    name: "invoice.pdf",
    type: "application/pdf",
    size: 20345,
  });
});

test("redactBufferBody collapses a raw Buffer body to a descriptor", () => {
  const body = Buffer.alloc(4096);
  assert.deepEqual(redactBufferBody(body, "application/pdf"), {
    name: null,
    type: "application/pdf",
    size: 4096,
  });
});

test("redactBufferBody uses null type when Content-Type is missing", () => {
  assert.deepEqual(redactBufferBody(Buffer.alloc(2), undefined), {
    name: null,
    type: null,
    size: 2,
  });
});

test("redactBufferBody leaves non-Buffer bodies untouched", () => {
  const body = { hello: "world" };
  assert.equal(redactBufferBody(body, "application/json"), body);
  assert.equal(redactBufferBody("text", "text/plain"), "text");
});
