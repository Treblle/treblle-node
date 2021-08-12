# Treblle for Node

[![Latest Version](https://img.shields.io/npm/v/treblle)](https://img.shields.io/npm/v/treblle)
[![Total Downloads](https://img.shields.io/npm/dt/treblle)](https://img.shields.io/npm/dt/treblle)
[![MIT Licence](https://img.shields.io/npm/l/treblle)](LICENSE.md)

Treblle makes it super easy to understand what’s going on with your APIs and the apps that use them. Just by adding Treblle to your API out of the box you get:
* Real-time API monitoring and logging
* Auto-generated API docs with OAS support
* API analytics
* Quality scoring
* One-click testing
* API managment on the go
* and more...

## Requirements
* nodejs

## Dependencies
* [`express`](https://www.npmjs.com/package/express)
* [`node-fetch`](https://www.npmjs.com/package/node-fetch)

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
Next, create a FREE account on <https://treblle.com> to get an API key and Project ID. After you have those simply initialize Treblle in your **app.js** file like so:

```js
const app = express();
app.use(express.json());

useTreblle(app, {
  apiKey: "_YOUR_API_KEY_",
  projectId: "_YOUR_PROJECT_ID_",
});
```
That's it. Your API requests and responses are now being sent to your Treblle project. Just by adding that line of code you get features like: auto-documentation, real-time request/response monitoring, error tracking and so much more.


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
    additionalFieldsToMask: ["secretField", "highlySensitiveField"]
  });
```

### Logging errors
For easier debugging when sending the data to Treblle errors are visible by default, you can control it via the `showErrors` flag, you can disable the errors with `showErrors` set to `false`:

```js
useTreblle(app, {
    apiKey: "_YOUR_API_KEY_",
    projectId: "_YOUR_PROJECT_ID_",
    showErrors: false
  });
```

## Support
If you have problems of any kind feel free to reach out via <https://treblle.com> or email vedran@treblle.com and we'll do our best to help you out.

## License
Copyright 2021, Treblle Limited. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php
