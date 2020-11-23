# treblle

Middleware for [Treblle](https://treblle.com) integration.


## Installation

```sh
$ npm install treblle
```

## Usage

To use the treblle middleware successfuly:

```javascript
const app = express();

app.use(express.json());

useTreblle(app, {
  apiKey: __treblle_apiKey__,
  projectId: __treblle_projectId__,
});
```

You have to enable JSON parsing before calling the `useTreblle` function.

### body-parser

If you are using the `body-parser` package then enable the plugin like this:

```javascript
const app = express();

app.use(bodyParser.json())

useTreblle(app, {
  apiKey: __treblle_apiKey__,
  projectId: __treblle_projectId__,
});
```


## API Key and Project ID

Both the API key and Project ID can be fetched from Treblle's site.

The API key can be found in [User settings](https://treblle.com/users/settings).
And the Project ID can be found in your project settings, you can find your projects in [Treblle's Dashboard](https://treblle.com/dashboard).

## License

[MIT](https://github.com/Treblle/treblle-node/blob/master/LICENSE)