# Optional IFC engine

Run `npm install` from the project root. Its postinstall script copies
`web-ifc-api.js`, `web-ifc.wasm` and the upstream license into this directory.

The source application checks for this local JS file before choosing the
broader WebAssembly adapter. Without it, the original native IFC subset remains
available and reports unsupported geometry. The self-contained build always
uses that native subset. See the root README and THIRD_PARTY.md.
