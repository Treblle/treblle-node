# Treblle - API Intelligence Platform

[![Treblle API Intelligence](https://github.com/user-attachments/assets/b268ae9e-7c8a-4ade-95da-b4ac6fce6eea)](https://treblle.com)

[Website](http://treblle.com/) • [Documentation](https://docs.treblle.com/) • [Pricing](https://treblle.com/pricing)

Treblle is an API intelligence platfom that helps developers, teams and organizations understand their APIs from a single integration point.

---

## Treblle JavaScript SDK

[![Latest Version](https://img.shields.io/npm/v/treblle)](https://www.npmjs.com/package/treblle)
[![Total Downloads](https://img.shields.io/npm/dt/treblle)](https://www.npmjs.com/package/treblle)
[![MIT Licence](https://img.shields.io/npm/l/treblle)](LICENSE.md)

## Requirements

- **Node.js**: `>=14.0.0` (supports all LTS versions from 14.x onwards)
- **Supported Framework**: Express, NestJS, Koa, Hono, Strapi, or Cloudflare Workers

## Dependencies

### Core Dependencies (All Frameworks)
- [`stack-trace`](https://www.npmjs.com/package/stack-trace) - Error stack parsing and debugging

### Runtime-Specific Dependencies
- [`node-fetch`](https://www.npmjs.com/package/node-fetch) - HTTP client (Node.js environments only)
  - **Used by**: Express, NestJS, Koa, Hono (Node.js), Strapi
  - **Not needed**: Cloudflare Workers (uses native `fetch`)

**Note**: Framework dependencies (Express, Koa, etc.) are peer dependencies - install the version your project uses.

## Supported Frameworks and Runtimes

| Framework | Supported Versions | Node.js Requirement | Status | Notes |
|-----------|-------------------|---------------------|--------|-------|
| **[Express](https://expressjs.com/)** | `4.x`, `5.x` | `>=14.0.0` | ✅ Full Support | Both versions fully supported |
| **[NestJS](https://nestjs.com/)** | `9.x`, `10.x`, `11.x` | `>=16.0.0` | ✅ Full Support | Built on Express/Fastify |
| **[Koa](https://koajs.com/)** | `2.x`, `3.x` | `>=18.0.0` | ✅ Full Support | Modern async/await support |
| **[Hono](https://hono.dev/)** | `4.x` | `>=16.0.0` | ✅ Full Support | Multi-runtime (Node.js, Bun, Deno) |
| **[Strapi](https://strapi.io/)** | `4.x`, `5.x` | `>=18.0.0` LTS | ✅ Full Support | Built on Koa |
| **[Cloudflare Workers](https://workers.cloudflare.com/)** | Workers Runtime | Web Standards API | ✅ Full Support | V8-based runtime |

## Installation (⚠️ Beta Release)

You can install the Treblle JavaScript SDK via [NPM](https://www.npmjs.com/). Simply run the following command:

```bash
$ npm install treblle@2.0.0-beta.3
```

Don't forget to load the required JS modules in your app.js like so:

```js
const express = require("express");
const { useTreblle } = require("treblle");
```

## Migrating from v1.x to v2.x

### Configuration options (⚠️ Breaking changes)

- The old `apiKey` value is now called `sdkToken` to match our new naming conventions
- The old `projectId` value is now called `apiKey` to match our new naming conventions
- `showErrors` is now renamed to `debug` for more clarity

```js
// This continues to work in v2.0+
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_", // renamed from apiKey  
  apiKey: "_YOUR_API_KEY_",     // renamed from projectId
  debug: true                   // renamed from showErrors
});
```

For more details on other changes and improvements please take a look at the [Changelog](#changelog) section.

## Getting started

Next, create a FREE account on <https://treblle.com> to get an SDK token and API key. After you have those simply initialize Treblle in your **app.js** file like so for Express:

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
  additionalFieldsToMask: ["customSecret", "internalId"], // Optional: Mask additional fields
  blocklistPaths: ["admin", "health"], // Optional: Skip logging certain paths
  ignoreDefaultBlockedPaths: false, // Optional: Disable default blocked paths (default: false)
  debug: true, // Optional: Show Treblle errors in console (default: false)
});
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `blocklistPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `ignoreDefaultBlockedPaths` (optional): Boolean to disable [default blocked paths](#default-blocked-paths) (default: false)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

That's it. Your API requests and responses are now being sent to your Treblle project. Just by adding that line of code you get features like: auto-documentation, real-time request/response monitoring, error tracking and so much more.

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
    additionalFieldsToMask: ["customSecret", "internalId"], // Optional: Mask additional fields
    blocklistPaths: ["admin", "health"], // Optional: Skip logging certain paths
    ignoreDefaultBlockedPaths: false, // Optional: Disable default blocked paths (default: false)
    debug: true, // Optional: Show Treblle errors in console (default: false)
  })
);
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `blocklistPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `ignoreDefaultBlockedPaths` (optional): Boolean to disable [default blocked paths](#default-blocked-paths) (default: false)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

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
    additionalFieldsToMask: ["customSecret", "internalId"], // Optional: Mask additional fields
    blocklistPaths: ["admin", "health"], // Optional: Skip logging certain paths
    ignoreDefaultBlockedPaths: false, // Optional: Disable default blocked paths (default: false)
    debug: true, // Optional: Show Treblle errors in console (default: false)
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
    blocklistPaths: /^\/(health|metrics|admin)/, // Using RegExp for complex patterns
  })
);
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `blocklistPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `ignoreDefaultBlockedPaths` (optional): Boolean to disable [default blocked paths](#default-blocked-paths) (default: false)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

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
          additionalFieldsToMask: ["customSecret", "internalId"], // Optional: Mask additional fields
          blocklistPaths: ["webhooks", "uploads"], // Optional: Skip logging certain paths
          ignoreDefaultBlockedPaths: false, // Optional: Disable default blocked paths (default: false)
          debug: true, // Optional: Show Treblle errors in console (default: false)
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
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `blocklistPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `ignoreDefaultBlockedPaths` (optional): Boolean to disable [default blocked paths](#default-blocked-paths) (default: false)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)
- `ignoreAdminRoutes` (optional): Array of admin route prefixes to ignore (default: `["admin", "content-type-builder", "content-manager"]`)

**Note:** The `ignoreAdminRoutes` option is Strapi-specific and helps avoid logging internal admin panel requests that are typically not part of your public API.

### Cloudflare Workers integration

Cloudflare Workers require bundling external packages. You need a bundler (Webpack or Rollup) to bundle Treblle with your worker code.

#### Service workers

**Setup Requirements:**

- A bundler (Webpack/Rollup) to bundle dependencies
- Polyfills for Node.js modules not available in Workers Runtime

**Step 1:** Configure Wrangler and Webpack:

```toml
# wrangler.toml
type = "webpack"
webpack_config = "webpack.config.js"

[build.upload]
format = "service-worker"
```

```js
// webpack.config.js
module.exports = {
  entry: "./index.js",
  target: "webworker",
  mode: "production",
  output: {
    filename: "worker.js",
  },
  resolve: {
    fallback: {
      os: false, // Required: Treblle uses Node.js modules not available in Workers
      url: false, // Required: These are polyfilled as empty modules
    },
  },
};
```

**Step 2:** Basic Service Worker setup:

```js
// worker.js
const { serviceWorkerTreblle } = require("treblle");

// Initialize Treblle
const treblle = serviceWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

// Wrap your fetch handler
addEventListener(
  "fetch",
  treblle((event) => {
    event.respondWith(
      new Response("Hello worker!", {
        headers: { "content-type": "text/plain" },
      })
    );
  })
);
```

**Step 3:** Service Worker with all options:

```js
const treblle = serviceWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  additionalFieldsToMask: ["key1", "key2"], // Optional: Mask additional fields
  debug: true, // Optional: Show Treblle errors in console (default: false)
});
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

**Note:** `blocklistPaths` is not available for Cloudflare Workers as path filtering should be handled in your worker logic.

#### Module workers

**Setup Requirements:**

- Same bundler setup as Service workers
- ES modules support for import/export syntax

**Step 1:** Basic Module Worker setup:

```js
// worker.js
import { moduleWorkerTreblle } from "treblle";

// Initialize Treblle
const treblle = moduleWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

export default {
  // Wrap your fetch handler
  fetch: treblle(async (request, env, context) => {
    // Your API logic here
    const url = new URL(request.url);

    if (url.pathname === "/api/users") {
      return new Response(JSON.stringify({ users: [] }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }),
};
```

**Step 2:** Module Worker with all options:

```js
const treblle = moduleWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  additionalFieldsToMask: ["key1", "key2"], // Optional: Mask additional fields
  debug: true, // Optional: Show Treblle errors in console (default: false)
});
```

**Available options:**

- `sdkToken` (required): Your Treblle SDK token
- `apiKey` (required): Your Treblle API key
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

**Important Notes:**

- Treblle uses Node native libraries (`os` & `url`) for other integrations that aren't supported in Cloudflare Workers Runtime
- These are polyfilled as empty modules since they're not used in the Workers integration
- See the webpack configuration above for required polyfills
- Example setup with Modules and CommonJS: [Cloudflare's official example](https://github.com/cloudflare/modules-webpack-commonjs)

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
  additionalFieldsToMask: ["customSecret", "internalId"], // Optional: Mask additional fields
  blocklistPaths: ["admin", "health"], // Optional: Skip logging certain paths
  ignoreDefaultBlockedPaths: false, // Optional: Disable default blocked paths (default: false)
  debug: true, // Optional: Show Treblle errors in console (default: false)
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
- `additionalFieldsToMask` (optional): Array of field names to mask in addition to [default fields](#default-masked-fields)
- `blocklistPaths` (optional): Array of path prefixes or RegExp to exclude from logging
- `ignoreDefaultBlockedPaths` (optional): Boolean to disable [default blocked paths](#default-blocked-paths) (default: false)
- `debug` (optional): Boolean to show Treblle-related errors in console (default: false)

**Important Notes:

- Must be called after `NestFactory.create()` but before `app.listen()`
- Only works with Express adapter (default NestJS adapter)
- For Fastify adapter, use regular Express integration with Fastify-specific setup

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

If you want to expand the list of fields you want to hide, you can pass property names you want to hide by using the `additionalFieldsToMask` setting like in the example below.

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  additionalFieldsToMask: ["secretField", "highlySensitiveField"],
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

## Configuration Reference

### Default masked fields

Treblle automatically masks sensitive fields in request and response bodies. The following fields are masked by default:

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

You can add additional fields to mask using the `additionalFieldsToMask` option:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  additionalFieldsToMask: ["customSecret", "internalId", "sessionToken"],
});
```

### Default blocked paths

Treblle automatically blocks common browser requests and static files from being logged to avoid noise in your API monitoring. The following paths and patterns are blocked by default:

**Specific Files:**
- `favicon.ico` - Browser icon requests
- `robots.txt` - Search engine crawler instructions
- `sitemap.xml` - Website sitemap files
- `manifest.json` - Progressive Web App manifest
- `sw.js` / `service-worker.js` - Service worker files
- `apple-touch-icon*` - iOS home screen icons
- `browserconfig.xml` - IE/Edge configuration
- `crossdomain.xml` - Flash crossdomain policy
- `ads.txt` - Advertising policy file

**Directory Patterns:**
- `/.well-known/` - IETF well-known URIs (certificates, etc.)
- `/static/` - Static file directories
- `/assets/` - Asset directories
- `/public/` - Public file directories
- `/images/` - Image directories
- `/css/` - Stylesheet directories
- `/js/` - JavaScript directories

**File Extensions:**
- Static assets: `.css`, `.js`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`
- Fonts: `.woff`, `.woff2`, `.ttf`, `.eot`

#### Disabling default blocked paths

If you want to log these requests (for example, to monitor static file access), you can disable the default blocking:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  ignoreDefaultBlockedPaths: true, // Disable automatic blocking
  blocklistPaths: ["favicon.ico"], // Manually specify what to block
});
```

#### Combining with custom blocked paths

By default, both the default blocked paths and your custom `blocklistPaths` are applied:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  blocklistPaths: ["admin", "health"], // Custom blocks
  // Default blocks (favicon.ico, robots.txt, etc.) still apply
});
```

### Path blocking examples

Block specific paths or patterns from being logged:

```js
// Block specific paths (string array)
blocklistPaths: ["admin", "health", "metrics"];

// Block using RegExp for complex patterns
blocklistPaths: /^\/(admin|health|metrics)/;

// Mixed array with strings and RegExp
blocklistPaths: ["admin", /^\/api\/v1\/internal/];
```

## Changelog

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

### Getting Help

If you continue to experience issues:

1. Enable `debug: true` and check console output
2. Verify your SDK token and API key are correct in Treblle dashboard
3. Test with a simple endpoint first
4. Check [Treblle documentation](https://docs.treblle.com) for the latest updates
5. Contact support at <https://treblle.com> or email support@treblle.com

## Support

If you have problems of any kind feel free to reach out via <https://treblle.com> or email support@treblle.com and we'll do our best to help you out.

## License

Copyright 2025, Treblle Inc. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php
