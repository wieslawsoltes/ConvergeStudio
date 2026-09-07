# Third-party components and references

## Runtime dependency: optional broader IFC adapter

- Package: **web-ifc 0.0.77**, the That Open Company IFC geometry engine.
- License: **Mozilla Public License 2.0 (MPL-2.0)**, separate from this project's MIT license.
- Upstream: https://github.com/ThatOpen/engine_web-ifc
- API documentation: https://thatopen.github.io/engine_web-ifc/docs/
- Installed artifacts: `vendor/web-ifc-api.js`, `vendor/web-ifc.wasm`, and the upstream license copied by `scripts/vendor-ifc.mjs`.

The JS/WASM artifacts are not included in this delivery because the execution environment could not download the package. `npm install` installs the exact direct dependency and runs the vendor-copy script. Retain the upstream license when distributing those files, and follow the upstream license obligations for any modifications to the dependency itself. The offline/native IFC reader is original code and does not depend on web-ifc.

No Three.js, Babylon.js, React, Vue, external viewer, commercial BIM SDK, CDN stylesheet or font file is included. Inline SVG icons and all supplied model fixtures were created for this project.

## Technical references

- WebGPU specification: https://www.w3.org/TR/webgpu/
- glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Autodesk Navisworks workflow reference: https://www.autodesk.com/products/navisworks/features

These are references, not runtime dependencies. Converge Studio is not affiliated with Autodesk. It does not include Autodesk source code, binary readers, logos or proprietary model files.

## Optional test tooling

The browser workflow script uses an externally installed Python Playwright package and Chromium. Neither package nor browser is redistributed here. The application and its build/test scripts otherwise use browser APIs and Node.js standard-library modules.
