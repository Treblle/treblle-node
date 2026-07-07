const { normalizeConfig } = require("../core/config");
const { captureAndSend } = require("../core/capture");
const { shouldTrack, extractPathname } = require("../core/blocklist");
const { createStartTime } = require("../core/timing");
const { applyFileDescriptors } = require("../core/files");
const { createQueryStore, runWithQueryContext } = require("../queryTracking");

/**
 * Treblle middleware for Koa.
 *
 * @param {object} settings see core/config.js for the shared options
 * @returns {function} koa middleware function
 */
function koaTreblle(settings) {
  const config = normalizeConfig(settings, { sdk: "koa" });

  return async function (ctx, next) {
    // Check if the request path is blocked
    if (!shouldTrack(config, ctx.request.url)) {
      return next();
    }

    return koaMiddlewareFn(config, ctx, next);
  };
}

/**
 * Treblle middleware for Strapi (which serves everything through Koa).
 *
 * Accepts the shared options plus:
 * @param {string[]?} settings.ignoreAdminRoutes admin route prefixes to skip
 *   (default: ["admin", "content-type-builder", "content-manager"])
 * @returns {function} koa middleware function
 */
function strapiTreblle(settings) {
  const config = normalizeConfig(settings, { sdk: "strapi" });
  const {
    ignoreAdminRoutes = ["admin", "content-type-builder", "content-manager"],
  } = config.extras;

  return async function (ctx, next) {
    const pathname = extractPathname(ctx.request.url);

    // option to ignore admin routes since everything is served via koa
    const [_, path] = pathname.split("/");
    if (ignoreAdminRoutes.includes(path)) {
      return next();
    }

    // Check if the request path is blocked
    if (!shouldTrack(config, pathname)) {
      return next();
    }

    return koaMiddlewareFn(config, ctx, next);
  };
}

async function koaMiddlewareFn(config, ctx, next) {
  const requestStartTime = createStartTime();
  const queryStore = createQueryStore();

  // Run the handler, remembering any error it throws so the single payload we
  // send below carries it. The error is re-thrown afterwards so Koa's own error
  // handling still runs.
  let caughtError;
  try {
    await runWithQueryContext(queryStore, () => next());
  } catch (error) {
    caughtError = error;
  }

  captureAndSend(
    config,
    buildKoaSnapshot(ctx, {
      requestStartTime,
      error: caughtError,
      queries: queryStore.queries,
      metadata: queryStore.metadata,
    }),
  );

  if (caughtError) throw caughtError;
}

/**
 * Builds the normalized snapshot for a Koa/Strapi context.
 * See core/payload.js for the snapshot contract.
 */
function buildKoaSnapshot(ctx, { requestStartTime, error, queries, metadata }) {
  return {
    protocol: `${ctx.request.protocol.toUpperCase()}/${ctx.request.req.httpVersion}`,
    request: {
      ip: ctx.request.ip,
      url: `${ctx.request.protocol}://${ctx.request.get("host")}${ctx.request.originalUrl}`,
      userAgent: ctx.request.header["user-agent"],
      method: ctx.request.method,
      headers: ctx.request.headers,
      // koa-body/formidable expose files on ctx.request.files; @koa/multer uses
      // ctx.files/ctx.file. Fold in descriptors so uploads are recorded without
      // shipping the raw bytes.
      body:
        ctx.request.method === "GET"
          ? ctx.request.query
          : applyFileDescriptors(
              ctx.request.body,
              ctx.request.files || ctx.files || ctx.file,
            ),
      routePath: getKoaRoutePath(ctx),
    },
    response: {
      statusCode: ctx.response.status,
      headers: ctx.response.headers,
      body: ctx.response.body,
      size: ctx.response.length || null,
    },
    error,
    queries,
    metadata,
    startTime: requestStartTime,
  };
}

/**
 * Extracts the raw route path pattern from Koa context
 * @param {object} ctx Koa context object
 * @returns {string|null} Route pattern or null if not available
 */
function getKoaRoutePath(ctx) {
  // Koa Router path pattern
  if (ctx._matchedRoute) {
    return ctx._matchedRoute;
  }
  // Alternative: check for matched routes array
  if (ctx.matched && ctx.matched.length > 0) {
    const lastMatch = ctx.matched[ctx.matched.length - 1];
    if (lastMatch && lastMatch.path) {
      return lastMatch.path;
    }
  }
  // Check for router layer path
  if (ctx.routerPath) {
    return ctx.routerPath;
  }
  return null;
}

module.exports = {
  koaTreblle,
  strapiTreblle,
  // Exported for unit testing
  buildKoaSnapshot,
};
