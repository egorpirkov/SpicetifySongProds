# Genius Producers

Displays producer credits for the currently playing track using Genius.com data.

![Preview](assets/preview.gif)

## Installation
Currently in beta. To install manually:
1. Clone this repository into your Spicetify extensions folder.
2. Run `spicetify config extensions genius-producers.js`
3. Run `spicetify apply`

## How to get a Genius API Token
1. Go to [Genius API Clients](https://genius.com/api-clients).
2. Create a new API Client.
3. Generate an Access Token.
4. Open the extension settings in Spicetify and paste the token.

**Security Note:** The token is stored in the browser's `localStorage` engine and is technically visible via DevTools. It is highly recommended to use a proxy, and the proxy will see your token in pass-through mode but won't save it.

## Proxy Settings
Due to CORS policies, directly accessing the Genius API from the browser may result in network errors. You can specify a custom Proxy URL in the extension settings to bypass CORS.

## Known Limitations
- Does not work for local files by default.
- Relies on Genius API having exact matches.

## Troubleshooting
- **No producers showing**: This might mean the track isn't correctly matched or Genius has no producers. Try manually testing your token.
