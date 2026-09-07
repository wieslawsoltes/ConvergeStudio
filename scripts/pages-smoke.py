#!/usr/bin/env python3
"""Verify a real HTTP origin, nested asset paths, IFC WASM and saved-project reload."""
import argparse, json, os, pathlib
from playwright.sync_api import sync_playwright
parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--browser', default=os.environ.get('CHROMIUM_PATH'))
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.browser, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1600,'height':1000})
    page.set_default_timeout(60000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    response = page.goto(args.url, wait_until='load')
    assert response.status == 200, response.status
    page.wait_for_function('!!window.converge || !!window.convergeError')
    assert page.evaluate('!!window.converge'), page.evaluate('window.convergeError')
    page.wait_for_function('!converge.ui.busy && Object.keys(converge.store.doc.results).length > 0')
    assert page.evaluate('converge.store.doc.entities.length') == 143
    metadata = page.request.get(args.url.rstrip('/') + '/deployment.json').json()
    assert metadata['application'] == 'Converge Studio'
    wasm = page.evaluate('''async () => {
      const mod = await import(new URL('vendor/web-ifc-api.js', location.href).href);
      const api = new mod.IfcAPI();
      api.SetWasmPath(new URL('vendor/', location.href).href, true);
      await api.Init(undefined, true);
      const version = api.GetVersion();
      api.Dispose?.();
      return version;
    }''')
    assert wasm == '0.0.77', wasm
    page.locator('[data-action="rename"]').click()
    page.locator('#f-name').fill('Pages persistence validation')
    page.locator('#modal button[type=submit]').click()
    page.wait_for_timeout(2200)
    assert page.evaluate('!converge.ui.saveError'), 'IndexedDB save failed'
    page.reload(wait_until='load')
    page.wait_for_function('!!window.converge')
    page.wait_for_function('converge.store.doc.name === "Pages persistence validation"')
    assert not errors, errors
    result = dict(passed=True, sourceCommit=metadata['sourceCommit'], url=args.url,
                  backend=page.evaluate('converge.renderer.backend'), ifcVersion=wasm,
                  initialEntities=143, indexedDBReload=True, uncaughtErrors=errors)
    print(json.dumps(result, indent=2), flush=True)
    browser.close()
