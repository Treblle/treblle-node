# Treblle - Runtime Intelligence Platform

[Website](http://treblle.com/) • [Documentation](https://docs.treblle.com/) • [Pricing](https://treblle.com/pricing)

Discover, Govern, and Secure APIs, Agents, and AI Across Any Cloud, Gateway or Technology.

---

## Treblle JavaScript SDK

[![Latest Version](https://img.shields.io/npm/v/treblle)](https://www.npmjs.com/package/treblle)
[![Total Downloads](https://img.shields.io/npm/dt/treblle)](https://www.npmjs.com/package/treblle)
[![MIT Licence](https://img.shields.io/npm/l/treblle)](LICENSE.md)

## Requirements

- **Node.js**: `>=18.0.0` (relies on the built-in global `fetch`)
- **Supported Framework**: Express, NestJS, Koa, Hono, Fastify, or Strapi

## Dependencies

### Core Dependencies (All Frameworks)
- [`stack-trace`](https://www.npmjs.com/package/stack-trace) - Error stack parsing and debugging

**Note**: Framework dependencies (Express, Koa, etc.) are peer dependencies - install the version your project uses.

## Supported Frameworks and Runtimes

| Framework | Supported Versions | Node.js Requirement | Status | Notes |
|-----------|-------------------|---------------------|--------|-------|
| **[Express](https://expressjs.com/)** | `4.x`, `5.x` | `>=18.0.0` | ✅ Full Support | Both versions fully supported |
| **[NestJS](https://nestjs.com/)** | `9.x`, `10.x`, `11.x` | `>=18.0.0` | ✅ Full Support | Built on Express/Fastify |
| **[Koa](https://koajs.com/)** | `2.x`, `3.x` | `>=18.0.0` | ✅ Full Support | Modern async/await support |
| **[Hono](https://hono.dev/)** | `4.x` | `>=18.0.0` | ✅ Full Support | Multi-runtime (Node.js, Bun, Deno) |
| **[Fastify](https://fastify.dev/)** | `4.x`, `5.x` | `>=18.0.0` | ✅ Full Support | Registered as lifecycle hooks |
| **[Strapi](https://strapi.io/)** | `4.x`, `5.x` | `>=18.0.0` LTS | ✅ Full Support | Built on Koa |

## Installation

You can install the Treblle JavaScript SDK via [NPM](https://www.npmjs.com/). Simply run the following command:

```bash
$ npm install treblle@^3.0.0
```

Don't forget to load the required JS modules in your app.js like so:

```js
const express = require("express");
const { useTreblle } = require("treblle");
```

## Migrating from v2.x to v3.x

### Cloudflare Workers support removed (⚠️ Breaking change)

The `moduleWorkerTreblle` and `serviceWorkerTreblle` exports have been removed. If you use Treblle in Cloudflare Workers, stay on `treblle@2.x` for now - a dedicated web-standards edge SDK covering Cloudflare Workers, Deno, Fastly and similar runtimes is coming as a separate package.

All other integrations (Express, NestJS, Koa, Hono, Strapi) use the same setup functions and behavior. v3 also adds per-framework subpath imports (e.g. `require("treblle/express")`) so bundlers only include the integration you use.

### Configuration options renamed (⚠️ Breaking changes)

Several options were renamed for clarity and consistency. Update your config:

| v2 option | v3 option | Notes |
| --- | --- | --- |
| `additionalFieldsToMask` | `maskedKeywords` | Same behavior - replaces the defaults, `[]` turns masking off |
| `blocklistPaths` | `blockedPaths` | Same behavior |
| `endpoint` | `ingressEndpoint` | Same behavior |
| `ignoreDefaultBlockedPaths` | *removed* | The default blocked paths are now always applied and cannot be disabled |

`sdkToken` and `apiKey` keep their names. Internally they are now sent to the ingress as `sdk_token` and `api_key` respectively (previously `api_key` and `project_id`) - this only matters if you consume the raw wire payload directly.

### Masking now on by default everywhere (⚠️ Behavior fix)

In v2, `koaTreblle`, `strapiTreblle`, and `honoTreblle` accidentally disabled masking when `maskedKeywords` was omitted. v3 fixes this: every integration masks the [default keywords](#default-masked-keywords) unless you explicitly pass `maskedKeywords: []` to turn masking off - exactly as documented and as Express already behaved.

### Deep imports locked down

v3 adds a package.json `exports` map. Importing internal files (e.g. `treblle/src/sender`) no longer works - use the root import or the framework subpaths (`treblle/express`, `treblle/koa`, `treblle/strapi`, `treblle/hono`, `treblle/fastify`).

```js
// Root import - same as v2
const { useTreblle } = require("treblle");

// New in v3: framework subpath, bundles only the Express adapter
const { useTreblle } = require("treblle/express");
```

For more details on other changes and improvements please take a look at the [Changelog](#changelog) section.

## Getting started

Grab your SDK token and API key from <https://treblle.com>. After you have those simply initialize Treblle in your **app.js** file like so for Express:

### Basic Express setup

```js
const express = require("express");
const { useTreblle } = require("treblle");

const app = express();
app.use(express.json());

// Treblle automatically adds both request/response and error handling middleware
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

app.get("/api/users", (req, res) => {
  res.json({ users: [] });
});

app.listen(3000);
```

**Note on Middleware Ordering**: Ensure Treblle is registered after body parsing middleware:
   ```js
   app.use(express.json());        // First: body parsing
   app.use(express.urlencoded({ extended: true }));
   
   useTreblle(app, { /* config */ }); // Then: Treblle
   
   // Finally: your routes
   app.get('/api/users', handler);
   ```

### Express with all options

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
  blockedPaths: ["admin", "health"], // Optional: Skip logging certain paths
  debug: true, // Optional: Show Treblle errors in console (default: false)
  ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
});
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`

That's it. Your API requests and responses are now being sent to your Treblle project. Just by adding that line of code you get features like: auto-documentation, real-time request/response monitoring, error tracking and so much more.

### Choosing where data is sent (custom ingress endpoint / data region)

By default the SDK sends all data to `https://ingress.treblle.com`. If you need
your data to be processed in a specific region, set the `ingressEndpoint` option
to the appropriate Treblle ingress URL. This option is supported by every
framework integration (Express, NestJS, Koa, Hono, Fastify and Strapi).

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  ingressEndpoint: "https://ingress-eu.treblle.com", // send data to the EU ingress
});
```

When `ingressEndpoint` is omitted (or empty), the SDK falls back to the default
`https://ingress.treblle.com`.

### Koa integration

#### Basic Koa setup

```js
const Koa = require("koa");
const KoaRouter = require("koa-router");
const KoaBody = require("koa-body");
const { koaTreblle } = require("treblle");

const app = new Koa();
const router = new KoaRouter();

// Add Treblle middleware
app.use(
  koaTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Add other middleware
app.use(KoaBody());

// Add routes
router.get("/api/users", (ctx) => {
  ctx.body = { users: [] };
});

app.use(router.routes());
app.listen(3000);
```

#### Koa with all options

```js
app.use(
  koaTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
    maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
    blockedPaths: ["admin", "health"], // Optional: Skip logging certain paths
      debug: true, // Optional: Show Treblle errors in console (default: false)
    ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
  })
);
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`

### Hono integration

#### Basic Hono setup

```js
import { Hono } from "hono";
import { honoTreblle } from "treblle";

const app = new Hono();

// Add Treblle middleware to all routes
app.use(
  "*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Add your routes
app.get("/api/users", (c) => c.json({ users: [] }));
app.post("/api/users", async (c) => {
  const body = await c.req.json();
  return c.json({ success: true, user: body });
});

export default app;
```

#### Hono with all options

```js
app.use(
  "*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
    maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
    blockedPaths: ["admin", "health"], // Optional: Skip logging certain paths
      debug: true, // Optional: Show Treblle errors in console (default: false)
    ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
  })
);
```

#### Hono with selective route monitoring

```js
// Monitor only API routes
app.use(
  "/api/*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Or exclude specific paths
app.use(
  "*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
    blockedPaths: /^\/(health|metrics|admin)/, // Using RegExp for complex patterns
  })
);
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`

### Fastify integration

Unlike the middleware-style integrations, Fastify is wired up by registering
Treblle's lifecycle hooks on your instance. Call `useFastifyTreblle` on the root
instance **before** you register your routes so the hooks apply to every route.

#### Basic Fastify setup

```js
const Fastify = require("fastify");
const { useFastifyTreblle } = require("treblle");

const app = Fastify();

// Register Treblle before your routes
useFastifyTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

app.get("/api/users", async () => ({ users: [] }));
app.post("/api/users", async (request) => ({ success: true, user: request.body }));

app.listen({ port: 3000 });
```

#### Fastify with all options

```js
useFastifyTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
  blockedPaths: ["admin", "health"], // Optional: Skip logging certain paths
  debug: true, // Optional: Show Treblle errors in console (default: false)
  ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
});
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`

#### NestJS on the Fastify platform

If your NestJS app runs on the Fastify adapter (instead of the default Express
one), use `useNestFastifyTreblle` and pass the underlying Fastify instance:

```js
import { useNestFastifyTreblle } from "treblle";

const app = await NestFactory.create(AppModule, new FastifyAdapter());
useNestFastifyTreblle(app.getHttpAdapter().getInstance(), {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});
```

### Strapi integration

Treblle has support for Strapi as well. Since Strapi runs on Koa under the hood, you need to define the middleware first and then enable it.

#### Basic Strapi setup

This guide is based on the strapi quickstart project, you can create it and follow by running:

```sh
npx create-strapi-app my-project --quickstart
```

**Step 1:** Create the middleware in `middlewares/treblle/index.js`:

```js
const { strapiTreblle } = require("treblle");

module.exports = (strapi) => {
  return {
    initialize() {
      strapi.app.use(
        strapiTreblle({
          sdkToken: "_YOUR_SDK_TOKEN_",
          apiKey: "_YOUR_API_KEY_",
        })
      );
    },
  };
};
```

**Step 2:** Enable the middleware in `config/middleware.js`:

```js
module.exports = {
  settings: {
    treblle: {
      enabled: true,
    },
  },
};
```

#### Strapi with all options

```js
// middlewares/treblle/index.js
const { strapiTreblle } = require("treblle");

module.exports = (strapi) => {
  return {
    initialize() {
      strapi.app.use(
        strapiTreblle({
          sdkToken: "_YOUR_SDK_TOKEN_",
          apiKey: "_YOUR_API_KEY_",
          maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
          blockedPaths: ["webhooks", "uploads"], // Optional: Skip logging certain paths
                  debug: true, // Optional: Show Treblle errors in console (default: false)
          ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
          ignoreAdminRoutes: ["admin", "content-manager", "upload"], // Optional: Ignore admin routes (default: ["admin", "content-type-builder", "content-manager"])
        })
      );
    },
  };
};
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`
- `ignoreAdminRoutes` (optional): Array of admin route prefixes to ignore (default: `["admin", "content-type-builder", "content-manager"]`)

**Note:** The `ignoreAdminRoutes` option is Strapi-specific and helps avoid logging internal admin panel requests that are typically not part of your public API.

### NestJS integration

NestJS uses Express under the hood, so Treblle integrates by accessing the underlying Express instance.

#### Basic NestJS setup

```js
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { useNestTreblle } from "treblle";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get the underlying Express instance
  const expressInstance = app.getHttpAdapter().getInstance();

  // Add Treblle middleware
  useNestTreblle(expressInstance, {
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  });

  await app.listen(3000);
}
bootstrap();
```

#### NestJS with all options

```js
useNestTreblle(expressInstance, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: ["customSecret", "internalId"], // Optional: Mask additional fields
  blockedPaths: ["admin", "health"], // Optional: Skip logging certain paths
  debug: true, // Optional: Show Treblle errors in console (default: false)
  ingressEndpoint: "https://ingress-eu.treblle.com", // Optional: Custom ingress endpoint (default: https://ingress.treblle.com)
});
```

#### NestJS with environment variables

```js
// main.ts
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const expressInstance = app.getHttpAdapter().getInstance();

  useNestTreblle(expressInstance, {
    sdkToken: configService.get("TREBLLE_SDK_TOKEN"),
    apiKey: configService.get("TREBLLE_API_KEY"),
    debug: configService.get("NODE_ENV") !== "production",
  });

  await app.listen(3000);
}
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `maskedKeywords` (optional): Keywords to mask in request/response bodies and headers. Replaces the [default keywords](#default-masked-keywords) - spread `DEFAULT_MASKED_KEYWORDS` to extend them. Pass `[]` to [turn masking off](#turning-masking-off). See [Masking sensitive data](#masking-sensitive-data)
- `blockedPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ingressEndpoint` (optional): Custom Treblle ingress endpoint URL to send data to (default: `https://ingress.treblle.com`). Use this to send data to a region-specific ingress, e.g. `https://ingress-eu.treblle.com`

**Important Notes:**

- Must be called after `NestFactory.create()` but before `app.listen()`
- `useNestTreblle` targets the default Express adapter - pass the underlying Express instance via `app.getHttpAdapter().getInstance()`
- If your app runs on the Fastify adapter, use [`useNestFastifyTreblle`](#nestjs-on-the-fastify-platform) with the underlying Fastify instance instead

### Running Treblle only in production

If you want to run Treblle only in production, you can rely on the environment variables, or use a similar approach via config.

```js
const app = express();
app.use(express.json());

if (process.env.NODE_ENV === "production") {
  useTreblle(app, {
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  });
}
```

### Need to hide additional fields?

Use the `maskedKeywords` setting to control which keywords are masked.
Since it replaces the built-in defaults, spread `DEFAULT_MASKED_KEYWORDS` to keep
them and add your own on top. See [Masking sensitive data](#masking-sensitive-data)
for full details (including how to turn masking off).

```js
const { useTreblle, DEFAULT_MASKED_KEYWORDS } = require("treblle");

useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: [...DEFAULT_MASKED_KEYWORDS, "secretField", "highlySensitiveField"],
});
```

### Logging errors

For easier debugging when sending the data to Treblle errors are visible by default, you can control it via the `debug` flag, you can disable the errors with `debug` set to `false`:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  debug: false,
});
```

### Tracking database queries

Treblle can show the SQL queries executed during each request (with their
execution time) in the `data.queries` array of the payload. Node has no
framework-wide "a query ran" event, so query tracking is **opt-in**: you wire
your database layer's query event to Treblle's `trackQuery` helper **once**, and
every query made during a request is captured automatically. Until you do this,
`data.queries` is simply an empty array.

`trackQuery(sql, time)` records a query against the request that is currently
in flight (it uses `AsyncLocalStorage` under the hood, so you don't need access
to `req`). It is a no-op when called outside of a request.

> **Privacy:** Only pass the **parameterized** SQL string (e.g.
> `SELECT * FROM users WHERE id = $1`) - never the parameter bindings. The ORM
> events below already keep bindings separate, so no sensitive values are
> captured. As a safety net, `trackQuery` also scrubs any inline string/number
> literals it finds (replacing them with `?`).

```js
const { trackQuery } = require("treblle");
```

**Prisma** - enable the `query` event log and forward each event:

```js
const prisma = new PrismaClient({
  log: [{ level: "query", emit: "event" }],
});

prisma.$on("query", (e) => trackQuery(e.query, e.duration));
```

> Note: Prisma emits `query` events on an internal async channel, which can lose
> the request's context in some setups. If queries don't appear, prefer a
> per-request Prisma extension/middleware that calls `trackQuery`.

**Knex** - subscribe to its (synchronous, reliable) query events:

```js
const timers = new Map();
knex.on("query", (q) => timers.set(q.__knexQueryUid, process.hrtime.bigint()));
knex.on("query-response", (_res, q) => {
  const start = timers.get(q.__knexQueryUid);
  const ms = start ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
  timers.delete(q.__knexQueryUid);
  trackQuery(q.sql, ms);
});
```

**Sequelize** - turn on `benchmark` and forward from the `logging` callback:

```js
const sequelize = new Sequelize(connectionString, {
  benchmark: true, // provides the execution time (ms) as the 2nd arg
  logging: (sql, ms) => trackQuery(sql, ms),
});
```

### Adding custom metadata

Attach your own key/value properties to each request - for example `user-id`,
`plan`, or `region` - so you can search and filter on them in Treblle. The pairs
are sent in the payload as a `data.metadata` object, sitting at the same level as
`data.request`, `data.response`, and `data.queries`:

```json
"metadata": { "user-id": "john", "plan": "premium", "region": "eu" }
```

`setMetadata` works the same way in every framework (Express, Fastify, Koa, Hono,
NestJS, Strapi) with no extra setup. Like `trackQuery`, it uses
`AsyncLocalStorage` under the hood, so you can call it from anywhere during a
request without access to `req` - and it is a no-op when called outside of one.
It accepts either a single key/value or an object of pairs:

```js
const { setMetadata } = require("treblle");

app.get("/orders", (req, res) => {
  setMetadata("user-id", req.user.id);
  setMetadata({ plan: req.user.plan, region: "eu" });

  res.json({ ok: true });
});
```

To keep the payload small and search-friendly, metadata is limited:

- **Max 20 keys** per request (extra new keys are dropped).
- **Keys** up to **64 characters** (longer keys are truncated).
- **Values** must be a **string, number, or boolean**; strings up to **128
  characters** (longer values are truncated, unsupported types are dropped).

Anything over a limit is dropped or truncated silently.

> **⚠️ Security warning:** Metadata is **not** masked - values are sent verbatim.
> Never put secrets, tokens, or sensitive personal data in metadata.

## Configuration Reference

### Masking sensitive data

Treblle masks sensitive values in request/response **bodies and headers** before
anything leaves your server. Matching is case-insensitive and applies to values
of any type (strings, numbers, nested objects and arrays).

Masking is driven entirely by the `maskedKeywords` option, which is the
authoritative list of keywords to mask. Its behavior depends on what you pass:

| `maskedKeywords` | Behavior |
| --- | --- |
| **not set** (default) | The built-in [default keywords](#default-masked-keywords) are masked |
| **your own array** | Exactly the keywords you list are masked - this **replaces** the defaults |
| **`[]` (empty array)** | Masking is **turned off entirely** - bodies and headers are sent as-is |

#### Default masked keywords

When you don't set `maskedKeywords`, the following keywords are masked by default:

- `password`
- `pwd`
- `secret`
- `password_confirmation`
- `passwordConfirmation`
- `cc`
- `card_number`
- `cardNumber`
- `ccv`
- `ssn`
- `credit_score`
- `creditScore`
- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- `api_key`
- `apikey`
- `token`
- `access_token`
- `accessToken`
- `refresh_token`
- `refreshToken`
- `bearer`
- `x-auth-token`

#### Adding to the defaults

Because your array replaces the defaults, extend them by spreading the exported
`DEFAULT_MASKED_KEYWORDS` list rather than listing every default by hand:

```js
const { useTreblle, DEFAULT_MASKED_KEYWORDS } = require("treblle");

useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: [...DEFAULT_MASKED_KEYWORDS, "customSecret", "internalId"],
});
```

If you only want to mask your own specific keywords (and none of the defaults),
just pass your list directly:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: ["customSecret", "internalId"], // defaults are NOT applied
});
```

#### Turning masking off

Pass an empty array to disable masking completely. Treblle then skips masking
altogether and sends bodies and headers exactly as received:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  maskedKeywords: [], // masking disabled
});
```

> ⚠️ **Security warning:** With masking off, sensitive request/response body
> fields **and headers** - including `Authorization`, `Cookie`, API keys and
> tokens - are sent to Treblle in plaintext. Only disable masking when you are
> certain no sensitive data flows through the monitored endpoints.


### Path blocking examples

Block specific paths or patterns from being logged:

```js
// Block specific paths (string array)
blockedPaths: ["admin", "health", "metrics"];

// Block using RegExp for complex patterns
blockedPaths: /^\/(admin|health|metrics)/;

// Mixed array with strings and RegExp
blockedPaths: ["admin", /^\/api\/v1\/internal/];
```

## Changelog

### v3.0

- **Unified core architecture**: one payload builder, transport, and config layer shared by every framework via thin adapters - identical envelopes from all integrations
- **Per-framework subpath imports**: `treblle/express`, `treblle/koa`, `treblle/strapi`, `treblle/hono`
- **Removed Cloudflare Workers support** (moving to a dedicated edge SDK package)
- **Node.js `>=18` required**: dropped the `node-fetch` fallback and now relies on the built-in global `fetch`

### v2.0

- **Express v5 Support**: Full compatibility with both Express 4.x and 5.x
- **Improved Express Integration**: Replaced invasive method patching with standard middleware patterns
- **Better Error Handling**: Uses proper Express error middleware instead of overriding internal methods
- Dramatically improved networking performance
- Dramatically improved memory usage and consumption
- Dramatically improved masking performance
- Added support for Hono
- Extended support for Cloudflare Workers
- Added built-in endpoint detection
- Improved Debugging
- Improved Readme with more examples

## License

Copyright 2026, Treblle Inc. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php