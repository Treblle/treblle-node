
# Treblle for Node
Treblle makes it super easy to understand what’s going on with your APIs and the apps that use them. To get started with Treblle create a FREE account on <https://treblle.com>.

## Requirements
* nodejs

## Dependencies
* [`express`](https://www.npmjs.com/package/express)
* [`node-fetch`](https://www.npmjs.com/package/node-fetch)

## Installation
You can install Treblle via [NPM](https://www.npmjs.com/). Simply run the following command:
```bash
$ npm install treblle
```
Don't forget to load the required JS modules in your app.js like so:

```js
const express = require("express");
const { useTreblle } = require("treblle");
```

## Getting started
The first thing you need to do is create a FREE account on <https://treblle.com> to get an API key and Project ID. After that all you need to do is initialize Treblle in your **app.js** file like so: 

```js
const app = express();
app.use(express.json());

useTreblle(app, {
  apiKey: '_YOUR_API_KEY_',
  projectId: '_YOUR_PROJECT_ID_',
});
```
That's it. Your API requests and responses are now being sent to your Treblle project. Just by adding that line of code you get features like: auto-documentation, real-time request/response monitoring, error tracking and so much more.

## Support
If you have problems adding, installing or using Treblle feel free to reach out via <https://treblle.com> or contact vedran@flip.hr and we will make sure to do a FREE integration for you. 

## License
Copyright 2020, Treblle. Licensed under the MIT license:
http://www.opensource.org/licenses/mit-license.php
