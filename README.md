<div align="center">
  <img src="https://github.com/user-attachments/assets/b268ae9e-7c8a-4ade-95da-b4ac6fce6eea"/>
</div>
<div align="center">

# Treblle

<a href="https://docs.treblle.com/en/integrations" target="_blank">Integrations</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="http://treblle.com/" target="_blank">Website</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://docs.treblle.com" target="_blank">Docs</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://blog.treblle.com" target="_blank">Blog</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://twitter.com/treblleapi" target="_blank">Twitter</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://treblle.com/chat" target="_blank">Discord</a>
<br />

  <hr />
</div>

API Intelligence Platform. 🚀

Treblle is a lightweight SDK that helps Engineering and Product teams build, ship & maintain REST-based APIs faster.

## Features

<div align="center">
  <br />
  <img src="https://github.com/user-attachments/assets/02afd9f5-ab47-48ff-929a-0f3fcddcca34"/>
  <br />
  <br />
</div>

- [API Monitoring & Observability](https://www.treblle.com/features/api-monitoring-observability)
- [Auto-generated API Docs](https://www.treblle.com/features/auto-generated-api-docs)
- [API analytics](https://www.treblle.com/features/api-analytics)
- [Treblle API Score](https://www.treblle.com/features/api-quality-score)
- [API Lifecycle Collaboration](https://www.treblle.com/features/api-lifecycle)
- [Native Treblle Apps](https://www.treblle.com/features/native-apps)


## Treblle for Node

[![Latest Version](https://img.shields.io/npm/v/treblle)](https://img.shields.io/npm/v/treblle)
[![Total Downloads](https://img.shields.io/npm/dt/treblle)](https://img.shields.io/npm/dt/treblle)
[![MIT Licence](https://img.shields.io/npm/l/treblle)](LICENSE.md)

Treblle makes it super easy to understand what’s going on with your APIs and the apps that use them. Just by adding Treblle to your API out of the box you get:

- Real-time API monitoring and logging
- Auto-generated API docs with OAS support
- API analytics
- Quality scoring
- One-click testing
- API managment on the go
- and more...

## Requirements

- nodejs

## Dependencies

- [`express`](https://www.npmjs.com/package/express)
- [`node-fetch`](https://www.npmjs.com/package/node-fetch)

## Installation

You can install Treblle for Node via [NPM](https://www.npmjs.com/). Simply run the following command:

```bash
$ npm install treblle
```

Don't forget to load the required JS modules in your app.js like so:

```js
const express = require("express");
const { useTreblle } = require("treblle");
```

## Getting started

Next, create a FREE account on <https://treblle.com> to get an API key and Project ID. After you have those simply initialize Treblle in your **app.js** file like so for Express:

```js
const app = express();
app.use(express.json());

useTreblle(app, {
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
});
```

That's it. Your API requests and responses are now being sent to your Treblle project. Just by adding that line of code you get features like: auto-documentation, real-time request/response monitoring, error tracking and so much more.

### Koa integration

If you're using koa, then you can enable Treblle like this:

```js
const Koa = require("koa");
const KoaRouter = require("koa-router");
const KoaBody = require("koa-body");
const { koaTreblle } = require("treblle");

const app = new Koa();
const router = new KoaRouter();

app.use(
  koaTreblle({
    apiKey: "_YOUR_API_KEY_",
    projectId: "_YOUR_PROJECT_ID_",
  })
);
```

### Strapi integration

Treblle has support for Strapi as well, to start using it you need to define the middleware first and then enable the middleware.

This guide is based on the strapi quickstart project, you can create it and follow by running the following command:

```sh
npx create-strapi-app my-project --quickstart
```

First define the middleware in `middlewares/treblle/index.js` like this:

```js
const { strapiTreblle } = require("treblle");

module.exports = (strapi) => {
  return {
    initialize() {
      strapi.app.use(
        strapiTreblle({
          apiKey: "_YOUR_API_KEY_",
          projectId: "_YOUR_PROJECT_ID_",
        })
      );
    },
  };
};
```

Then enable the Treblle middleware in `config/middleware.js` like this:

```js
module.exports = {
  settings: {
    treblle: {
      enabled: true,
    },
  },
};
```

### Cloudflare Workers integration

#### Service workers

To use external packages (like Treblle) inside your workers you need a bundler (eg. Webpack or Rollup) to gather all dependencies into a single file which can be then deployed to Cloudflare. Read more about it in Cloudflare [webpack](https://developers.cloudflare.com/workers/cli-wrangler/webpack/) & [configuration](https://developers.cloudflare.com/workers/cli-wrangler/configuration/#service-workers) official documentation, and in an [official example](https://github.com/cloudflare/service-worker-custom-build).

Example - Wrangler's webpack

```toml
# wrangler.toml

...
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
};
```

```js
// worker.js

const { serviceWorkerTreblle } = require("treblle");

// Call this function for initialization, Treblle will attach itself to the 'fetch' event to be able to listen for response
const treblle = serviceWorkerTreblle({
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
  additionalFieldsToMask: ['key1', 'key2'], // Optional
  showErrors: true, // Optional, defaults to true
});

// Wrap your 'fetch' handler inside returned Treblle function, so Treblle can listen for unhandled application errors in your code
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

#### Module workers

Similar as with Service workers above, you need a bundler to package Treblle SDK together with your application code. Be sure to check out official Cloudflare documentation about [webpack]() & [modules configuration](https://developers.cloudflare.com/workers/cli-wrangler/configuration/#modules) if you are stuck.

Here is also an official example of a setup with both Modules and CommonJS, using Webpack: [link](https://github.com/cloudflare/modules-webpack-commonjs).

Example

```js
// worker.js

import { moduleWorkerTreblle } from "treblle";

// Initialize Treblle with this function, and store Treblle wrapper inside a variable
const treblle = moduleWorkerTreblle({
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
  additionalFieldsToMask: ['key1', 'key2'], // Optional
  showErrors: true, // Optional, defaults to true
});

export default {
  // Wrap your 'fetch' handlers inside Treblle wrapper function to use it
  fetch: treblle(async (request) => {
    return new Response(JSON.stringify({ sample: "json" }), {
      headers: { "content-type": "application/json" },
    });
  }),
};
```

**Important Note**

Treblle package (currently) uses some Node native libraries for other integrations, like `os` & `url`, which are not supported in Cloudflare Workers Runtime. They are not used in this integration, so it is enough to polyfil them with empty modules.

```js
// webpack.config.js

...
  resolve: {
    fallback: {
      os: false,
      url: false
    }
  }
...
```

### NestJS (with Express)


```js
// NestJS's boostrap function

const app = await NestFactory.create(AppModule);

...

const expressInstance = app.getHttpAdapter().getInstance();

useNestTreblle(expressInstance, {
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
});

...
```


### Running Treblle only in production

If you want to run Treblle only in production, you can rely on the environment variables, or use a similar approach via config.

```js
const app = express();
app.use(express.json());

if (process.env.NODE_ENV === "production") {
  useTreblle(app, {
    apiKey: "_YOUR_API_KEY_",
    projectId: "_YOUR_PROJECT_ID_",
  });
}
```

### Need to hide additional fields?

If you want to expand the list of fields you want to hide, you can pass property names you want to hide by using the `additionalFieldsToMask` setting like in the example below.

```js
useTreblle(app, {
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
  additionalFieldsToMask: ["secretField", "highlySensitiveField"],
});
```

### Logging errors

For easier debugging when sending the data to Treblle errors are visible by default, you can control it via the `showErrors` flag, you can disable the errors with `showErrors` set to `false`:

```js
useTreblle(app, {
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
  showErrors: false,
});
```

## Support

If you have problems of any kind feel free to reach out via <https://treblle.com> or email vedran@treblle.com and we'll do our best to help you out.

## License

Copyright 2021, Treblle Limited. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php
