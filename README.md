# Treblle - API Intelligence Platform

[![Treblle API Intelligence](https://github.com/user-attachments/assets/b268ae9e-7c8a-4ade-95da-b4ac6fce6eea)](https://treblle.com)

[Website](http://treblle.com/) • [Documentation](https://docs.treblle.com/) • [Pricing](https://treblle.com/pricing)

Treblle is an API intelligence platform that helps developers, teams and organizations understand their APIs from a single integration point.

***

## Treblle JavaScript SDK

[![Latest Version](https://img.shields.io/npm/v/treblle)](https://www.npmjs.com/package/treblle)
[![Total Downloads](https://img.shields.io/npm/dt/treblle)](https://www.npmjs.com/package/treblle)
[![MIT Licence](https://img.shields.io/npm/l/treblle)](LICENSE.md)

## Requirements

- Node.js 14.0.0 or higher

## Dependencies

- [`express`](https://www.npmjs.com/package/express) (for Express integration)
- [`node-fetch`](https://www.npmjs.com/package/node-fetch) (internal HTTP client)

## Supported Frameworks and Runtimes

- [Express](https://expressjs.com/)
- [NestJS](https://nestjs.com/)
- [Koa](https://koajs.com/)
- [Hono](https://hono.dev/)
- [Strapi](https://strapi.io/)
- [Cloudflare Workers](https://workers.cloudflare.com/)

## Installation

### Latest Stable Release (Recommended)

```bash
npm install treblle
```

### Beta Release (v2.0.0-beta.1)

⚠️ **Beta Notice**: This version includes performance improvements and new features but may have breaking changes.

```bash
npm install treblle@2.0.0-beta.1
```

Don't forget to import the required modules in your app:

```js
const express = require("express");
const { useTreblle } = require("treblle");
```

## Quick Start Guide

1. **Create a FREE account** on [treblle.com](https://treblle.com)
2. **Get your credentials** from your Treblle dashboard:
   - SDK Token (starts with your project name)
   - API Key (shorter alphanumeric string)
3. **Choose your integration** from the examples below

## Migrating from v1.x to v2.x

### Breaking Changes in v2.0

| v1.x Configuration | v2.x Configuration | Notes |
|-------------------|-------------------|-------|
| `apiKey` | `sdkToken` | Renamed for clarity |
| `projectId` | `apiKey` | Swapped naming convention |
| `showErrors` | `debug` | Renamed for consistency |

### Migration Example

**v1.x Configuration:**
```js
useTreblle(app, {
  apiKey: "your-long-sdk-token-here",
  projectId: "your-short-api-key-here",
  showErrors: true
});
```

**v2.x Configuration:**
```js
useTreblle(app, {
  sdkToken: "your-long-sdk-token-here",  // was 'apiKey'
  apiKey: "your-short-api-key-here",     // was 'projectId'
  debug: true                            // was 'showErrors'
});
```

## Framework Integrations

### Express Integration

#### Basic Express Setup

```js
const express = require("express");
const { useTreblle } = require("treblle");

const app = express();
app.use(express.json());

// Initialize Treblle BEFORE your routes
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

// Your API routes
app.get("/api/users", (req, res) => {
  res.json({ users: [] });
});

app.post("/api/users", (req, res) => {
  // Sensitive fields like 'password' are automatically masked
  const { name, email, password } = req.body;
  res.json({ success: true, user: { name, email } });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

#### Express with All Options

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  
  // Optional: Mask custom sensitive fields
  additionalFieldsToMask: ["customSecret", "internalId", "sessionToken"], 
  
  // Optional: Skip logging certain paths
  blocklistPaths: ["admin", "health", /^\/internal/], 
  
  // Optional: Show Treblle errors in console (useful for debugging)
  debug: process.env.NODE_ENV !== "production"
});
```

#### Production-Ready Express Setup

```js
const express = require("express");
const { useTreblle } = require("treblle");

const app = express();
app.use(express.json({ limit: '10mb' }));

// Only run Treblle in production/staging
if (process.env.NODE_ENV !== "development") {
  useTreblle(app, {
    sdkToken: process.env.TREBLLE_SDK_TOKEN,
    apiKey: process.env.TREBLLE_API_KEY,
    additionalFieldsToMask: [
      "apiKey", "sessionToken", "refreshToken", 
      "internalId", "adminPassword"
    ],
    blocklistPaths: [
      "health", "metrics", "admin", 
      /^\/webhooks\/internal/
    ],
    debug: process.env.NODE_ENV === "staging"
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(process.env.PORT || 3000);
```

### Koa Integration

#### Basic Koa Setup

```js
const Koa = require("koa");
const KoaRouter = require("koa-router");
const KoaBody = require("koa-body");
const { koaTreblle } = require("treblle");

const app = new Koa();
const router = new KoaRouter();

// Add Treblle middleware FIRST
app.use(
  koaTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Add body parsing middleware
app.use(KoaBody());

// Add your routes
router.get("/api/users", (ctx) => {
  ctx.body = { users: [] };
});

router.post("/api/users", (ctx) => {
  // Treblle automatically masks sensitive fields
  const userData = ctx.request.body;
  ctx.body = { success: true, user: userData };
});

app.use(router.routes());
app.listen(3000);
```

### Hono Integration

#### Basic Hono Setup

```js
import { Hono } from "hono";
import { honoTreblle } from "treblle";

const app = new Hono();

// Add Treblle middleware globally
app.use(
  "*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Your API routes
app.get("/api/users", (c) => c.json({ users: [] }));

app.post("/api/users", async (c) => {
  const body = await c.req.json();
  // Sensitive fields are automatically masked
  return c.json({ success: true, user: body });
});

export default app;
```

#### Hono with Selective Monitoring

```js
// Monitor only API routes (more efficient)
app.use(
  "/api/*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
  })
);

// Or exclude specific paths using RegExp
app.use(
  "*",
  honoTreblle({
    sdkToken: "_YOUR_SDK_TOKEN_",
    apiKey: "_YOUR_API_KEY_",
    blocklistPaths: /^\/(health|metrics|admin)/, // Complex patterns
  })
);
```

### NestJS Integration

#### Basic NestJS Setup

```typescript
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
    sdkToken: process.env.TREBLLE_SDK_TOKEN,
    apiKey: process.env.TREBLLE_API_KEY,
    debug: process.env.NODE_ENV !== "production"
  });

  await app.listen(3000);
}
bootstrap();
```

#### NestJS with Environment Configuration

```typescript
// main.ts
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const expressInstance = app.getHttpAdapter().getInstance();

  // Only enable in production/staging
  if (configService.get("NODE_ENV") !== "development") {
    useNestTreblle(expressInstance, {
      sdkToken: configService.get("TREBLLE_SDK_TOKEN"),
      apiKey: configService.get("TREBLLE_API_KEY"),
      additionalFieldsToMask: ["customSecret", "internalToken"],
      blocklistPaths: ["health", "metrics"],
      debug: configService.get("NODE_ENV") === "staging",
    });
  }

  await app.listen(3000);
}
```

### Strapi Integration

#### Basic Strapi Setup

This example is based on the Strapi quickstart project:

```sh
npx create-strapi-app@latest my-project --quickstart
```

**Step 1:** Create the middleware in `src/middlewares/treblle/index.js`:

```js
const { strapiTreblle } = require("treblle");

module.exports = () => {
  return strapiTreblle({
    sdkToken: process.env.TREBLLE_SDK_TOKEN,
    apiKey: process.env.TREBLLE_API_KEY,
    // Ignore Strapi admin routes by default
    ignoreAdminRoutes: ["admin", "content-manager", "upload"],
    debug: process.env.NODE_ENV !== "production"
  });
};
```

**Step 2:** Enable the middleware in `config/middlewares.js`:

```js
module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  {
    name: 'global::treblle',
    config: {
      enabled: process.env.NODE_ENV !== 'development'
    }
  }
];
```

### Cloudflare Workers Integration

⚠️ **Requirements**: Cloudflare Workers require bundling external packages with Webpack or similar.

#### Webpack Configuration

```js
// webpack.config.js
module.exports = {
  entry: "./src/worker.js",
  target: "webworker",
  mode: "production",
  output: {
    filename: "worker.js",
  },
  resolve: {
    fallback: {
      os: false,    // Required: Node.js modules not available in Workers
      url: false,   // These get polyfilled as empty modules
    },
  },
};
```

#### Service Worker Integration

```js
// src/worker.js
const { serviceWorkerTreblle } = require("treblle");

// Initialize Treblle
const treblle = serviceWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  debug: false // Keep false in production
});

// Wrap your fetch handler
addEventListener("fetch", treblle((event) => {
  event.respondWith(handleRequest(event.request));
}));

async function handleRequest(request) {
  const url = new URL(request.url);
  
  if (url.pathname === "/api/users") {
    return new Response(JSON.stringify({ users: [] }), {
      headers: { "content-type": "application/json" },
    });
  }
  
  return new Response("Not found", { status: 404 });
}
```

#### Module Worker Integration

```js
// src/worker.js
import { moduleWorkerTreblle } from "treblle";

// Initialize Treblle
const treblle = moduleWorkerTreblle({
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
});

export default {
  fetch: treblle(async (request, env, context) => {
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

## Configuration Reference

### Required Configuration

| Option | Type | Description |
|--------|------|-------------|
| `sdkToken` | string | Your Treblle SDK token from dashboard |
| `apiKey` | string | Your Treblle API key from dashboard |

### Optional Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `additionalFieldsToMask` | string[] | `[]` | Custom fields to mask beyond defaults |
| `blocklistPaths` | (string\|RegExp)[] | `[]` | Paths to exclude from logging |
| `debug` | boolean | `false` | Show Treblle errors in console |
| `ignoreAdminRoutes` | string[] | `["admin"]` | Strapi-only: Admin paths to ignore |

### Default Masked Fields

Treblle automatically masks these sensitive fields in requests and responses:

**Authentication & Passwords:**
- `password`
- `pwd` 
- `secret`
- `password_confirmation`
- `passwordConfirmation`

**Payment Information:**
- `cc`
- `card_number`
- `cardNumber`
- `ccv`

**Personal Identifiable Information:**
- `ssn`
- `credit_score`
- `creditScore`

**Custom Fields Example:**

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  additionalFieldsToMask: [
    "apiKey", "sessionToken", "refreshToken",
    "internalId", "customSecret", "userToken"
  ],
});
```

### Path Blocking Examples

```js
// Block specific paths (string matching)
blocklistPaths: ["admin", "health", "metrics"]

// Block using RegExp for complex patterns  
blocklistPaths: [/^\/(admin|health|metrics)/, /\/internal$/]

// Mixed array with strings and RegExp
blocklistPaths: ["admin", "health", /^\/api\/v1\/internal/]

// Block file uploads and downloads
blocklistPaths: ["uploads", "downloads", /\.(pdf|zip|exe)$/]
```

## Troubleshooting

### Common Issues and Solutions

#### "Treblle SDK token or API key is missing"

**Cause:** Required credentials not provided or undefined.

**Solution:**
```js
// Verify environment variables are set
console.log("SDK Token:", process.env.TREBLLE_SDK_TOKEN ? "✅ Set" : "❌ Missing");
console.log("API Key:", process.env.TREBLLE_API_KEY ? "✅ Set" : "❌ Missing");

useTreblle(app, {
  sdkToken: process.env.TREBLLE_SDK_TOKEN, // Must be defined
  apiKey: process.env.TREBLLE_API_KEY,     // Must be defined
});
```

#### "No data appearing in Treblle dashboard"

**Debugging steps:**

1. **Enable debug mode:**
```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  debug: true // Shows connection errors
});
```

2. **Check middleware order:**
```js
// Correct order
app.use(express.json());
useTreblle(app, { /* config */ }); // BEFORE routes
app.get("/api/users", handler);    // Routes AFTER

// Wrong order  
app.get("/api/users", handler);    // Routes first
useTreblle(app, { /* config */ }); // Treblle after (won't work)
```

3. **Verify routes aren't blocked:**
```js
// Check if your routes match blocklistPaths
blocklistPaths: ["api"] // This blocks all /api/* routes!
```

#### "Request payload too large"

**Solution:** Exclude large file upload routes:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  blocklistPaths: [
    "uploads", "files", "attachments",  // File uploads
    "exports", "reports",               // Large exports
    /\.(zip|pdf|exe|dmg)$/             // Large file types
  ]
});
```

#### "High memory usage"

**Solutions:**

1. **Block large response endpoints:**
```js
blocklistPaths: ["downloads", "exports", "reports"]
```

2. **Use selective monitoring:**
```js
// Only monitor critical API endpoints
app.use("/api/v1/users", treblle, userRoutes);
app.use("/api/v1/orders", treblle, orderRoutes);
// Skip file/media routes entirely
```

#### Framework-specific issues

**Express - Missing request body:**
```js
// Ensure body parser comes BEFORE Treblle
app.use(express.json());                    // ✅ First
app.use(express.urlencoded({ extended: true }));
useTreblle(app, { /* config */ });          // ✅ Then Treblle
```

**NestJS - Integration errors:**
```js
// Must be called AFTER NestFactory.create() but BEFORE app.listen()
const app = await NestFactory.create(AppModule);  // ✅ First
useNestTreblle(expressInstance, { /* config */ }); // ✅ Then Treblle  
await app.listen(3000);                            // ✅ Finally listen
```

**Cloudflare Workers - Build errors:**
```js
// webpack.config.js - Required polyfills
resolve: {
  fallback: {
    os: false,   // ✅ Required
    url: false   // ✅ Required  
  }
}
```

### Debug Mode

Enable debug mode to see detailed error information:

```js
useTreblle(app, {
  sdkToken: "_YOUR_SDK_TOKEN_",
  apiKey: "_YOUR_API_KEY_",
  debug: true // Shows network errors, payload issues, etc.
});
```

Common debug output:
- `✅ Treblle request sent successfully`
- `❌ Network error: CONNECTION_REFUSED`  
- `⚠️ Payload too large, truncating...`
- `🔍 Masking 5 sensitive fields`

## Changelog

### v2.0.0-beta.1
- **Performance**: 40-90% improvements across networking, memory, and masking
- **New Framework Support**: Added Hono integration
- **Enhanced Cloudflare Workers**: Extended support with better module handling
- **Improved Endpoint Detection**: Better automatic route detection
- **Enhanced Debugging**: More detailed error messages and troubleshooting
- **Documentation**: Comprehensive examples and best practices
- **Breaking Changes**: Configuration option names changed (see migration guide)

### v1.5.2 (Stable)
- Bug fixes and stability improvements
- Enhanced field masking
- Better error reporting

## Getting Help

If you continue experiencing issues:

1. **Enable debug mode** and check console output
2. **Verify credentials** in your Treblle dashboard  
3. **Test with a simple endpoint** first
4. **Check the latest docs** at [docs.treblle.com](https://docs.treblle.com)
5. **Contact support**:
   - Website: [treblle.com](https://treblle.com)
   - Email: support@treblle.com
   - GitHub Issues: Report bugs and feature requests

## License

Copyright 2025, Treblle Inc. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php
