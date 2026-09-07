# GitHub Pages publishing

Live application: https://wieslawsoltes.github.io/ConvergeStudio/

The **Publish Converge Studio** workflow runs on pushes to `main` and can also be run manually from Actions. It installs the pinned IFC dependency, runs the core tests, builds both standalone and modular distributions, checks browser workflows at a nested `/ConvergeStudio/` path, and uploads only `_site/` as the Pages artifact. Deployment uses the `github-pages` environment and the built-in `GITHUB_TOKEN`; no personal token is required.

The deployed modular application includes `vendor/web-ifc-api.js` and `vendor/web-ifc.wasm`. Workers, scripts, styles and WASM paths are relative to the project URL. The optional `standalone.html` deliberately uses the offline native IFC subset.

`deployment.json` identifies the source commit and contains SHA-256 digests of critical assets. The workflow verifies the public metadata and critical asset responses after deployment. A failed build/test does not publish a new artifact.

## Local build

```sh
npm ci
mkdir -p examples
npm run examples
npm test
npm run build
npm run build:pages
```

Serve `_site/` using a static HTTP server. Never open the modular `index.html` using `file://`; ES modules and Web Workers require a suitable HTTP origin. HTTPS is used on GitHub Pages.

## Initial source repair

The previous repository upload contained reduced modules rather than the original delivered application. A one-time, SHA-256-verified recovery step restores the 34 original text source files from a Brotli/base64 transfer payload. The payload is removed in a normal follow-up commit after the tests pass. This is not a runtime dependency; subsequent builds use the checked-in, readable source files and package lock normally.

Pages must already be enabled. The workflow publishes using the official GitHub Pages artifact/deployment actions. Application data remains in the visitor's browser; deployment does not upload local user models or projects.
