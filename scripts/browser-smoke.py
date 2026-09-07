#!/usr/bin/env python3
"""Optional Playwright integration test. Default: self-contained artifact, no server required.
With --url http://localhost:8080 it exercises the selected browser GPU backend and origin.
Use a fresh workspace: this script edits the current sample project.
"""
import argparse, json, os, pathlib, tempfile, time, traceback
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url')
parser.add_argument('--browser', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
parser.add_argument('--output', default=str(ROOT/'docs'/'browser-validation.json'))
args = parser.parse_args()
checks = []
errors = []
started = time.time()

def check(name, condition, detail=None):
    if not condition:
        raise AssertionError(f'{name}: {detail}')
    checks.append({'name': name, 'passed': True, 'detail': detail})
    print('PASS', name, flush=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1600, 'height':1000}, device_scale_factor=1)
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    result = {'environment': {}, 'checks': checks}
    try:
        if args.url:
            page.goto(args.url)
        else:
            page.set_content((ROOT/'dist'/'converge-studio.html').read_text(), wait_until='load')
        page.wait_for_function('!!window.converge || !!window.convergeError')
        check('application starts without fatal error', page.evaluate('!!window.converge'), page.evaluate('window.convergeError || null'))
        page.wait_for_function('Object.keys(converge.store.doc.results).length > 0 && !converge.ui.busy')
        result['environment'] = page.evaluate('({userAgent:navigator.userAgent,backend:converge.renderer.backend,origin:location.origin,indexedDBAvailable:!converge.ui.saveError})')
        check('five federated models / 143 real entities', page.evaluate('converge.store.doc.models.length===5 && converge.store.doc.entities.length===143'))
        check('initial triangle test reports 32 actual clashes', page.evaluate('converge.store.doc.results[converge.ui.test].results.length===32'))
        stats = page.evaluate('converge.store.doc.results[converge.ui.test].stats')
        check('initial test is evaluated, not reused or seeded', stats['tested']==32 and stats['reused']==0, stats)
        page.evaluate('document.querySelectorAll("#toastStack .toast button").forEach(b=>b.click())')
        page.wait_for_timeout(700)
        page.screenshot(path=str(ROOT/'docs'/'workspace.png'), full_page=True)

        # Locate two actual visible triangle hits without assuming a particular backend.
        page.evaluate('''window.visibleHits=(()=>{const {store,camera,renderer}=converge,r=renderer.canvas.getBoundingClientRect(),hits=[];
          for(let y=r.height*.27;y<r.height*.78;y+=r.height*.065)for(let x=r.width*.22;x<r.width*.76;x+=r.width*.05){
            const ray=camera.ray(x,y,r.width,r.height),hit=store.raycast(ray.origin,ray.direction);
            if(hit&&(!hits.length||hit.id!==hits[0].id))hits.push({x:r.left+x,y:r.top+y,id:hit.id});if(hits.length>=2)return hits;}
          return hits;})()''')
        hits = page.evaluate('visibleHits')
        check('visible triangle surfaces are available for picking', len(hits)==2)
        hit = hits[0]
        page.mouse.click(hit['x'], hit['y'])
        page.wait_for_function('converge.store.selection.size>0')
        check('viewport ID picking selects the ray-hit entity', page.evaluate('converge.store.selection.has(visibleHits[0].id)'))
        check('property inspector shows selected object', page.locator('#inspectorContent h3').count()==1)
        page.locator('[data-action="hide"]').first.click()
        check('hide changes model state', page.evaluate('converge.store.byId.get(visibleHits[0].id).visible===false'))
        page.locator('[data-action="undo"]').first.click()
        check('undo restores hidden entity', page.evaluate('converge.store.byId.get(visibleHits[0].id).visible!==false'))
        page.locator('[data-action="redo"]').first.click()
        check('redo hides entity again', page.evaluate('converge.store.byId.get(visibleHits[0].id).visible===false'))
        page.locator('[data-action="undo"]').first.click()

        page.locator('[data-tab="Review"]').click()
        page.locator('[data-action="save-set"]').first.click()
        page.locator('#f-name').fill('Browser review set')
        page.locator('#modal button[type=submit]').click()
        check('selection set stores stable entity references', page.evaluate('converge.store.doc.sets.some(s=>s.name==="Browser review set" && s.ids.includes(visibleHits[0].id))'))
        page.locator('[data-set]').last.click()
        check('selection set reselects entities', page.evaluate('converge.store.selection.has(visibleHits[0].id)'))

        page.locator('[data-action="section"]').first.click()
        check('six-plane section clipping is enabled', page.evaluate('converge.store.doc.section.enabled'))
        page.locator('[data-clip-axis="1"][data-clip-bound="max"]').fill('6.25')
        page.locator('[data-clip-axis="1"][data-clip-bound="max"]').press('Tab')
        check('section plane edit updates persisted project', page.evaluate('converge.store.doc.section.max[1]===6.25'))
        page.locator('[data-action="section"]').first.click()
        page.locator('[data-action="measure"]').first.click()
        page.mouse.click(hits[0]['x'], hits[0]['y'])
        page.wait_for_function('!!converge.ui.measureStart')
        page.mouse.click(hits[1]['x'], hits[1]['y'])
        page.wait_for_function('converge.store.doc.measurements.length===1')
        check('two surface picks create a nonzero 3D measurement', page.evaluate('(()=>{const m=converge.store.doc.measurements[0];return Math.hypot(...m.a.map((x,i)=>x-m.b[i]))>0.01})()'))
        check('measurement annotation is drawn', page.locator('#annotations text').count()>0)
        page.keyboard.press('Escape')

        page.locator('[data-tab="Viewpoint"]').click()
        page.locator('[data-action="save-view"]').first.click()
        page.locator('#f-name').fill('Browser review viewpoint')
        page.locator('#modal button[type=submit]').click()
        page.locator('[data-action="top"]').first.click()
        check('top preset changes projection', page.evaluate('converge.camera.ortho'))
        page.locator('[data-view]').last.click()
        check('saved viewpoint restores camera and projection', page.evaluate('!converge.camera.ortho && JSON.stringify(converge.camera.serialize())===JSON.stringify(converge.store.doc.views.at(-1).camera)'))
        page.locator('[data-action="undo"]').first.click()
        check('viewpoint restore participates in undo history', page.evaluate('converge.camera.ortho'))
        page.locator('[data-action="redo"]').first.click()

        page.locator('[data-bottom="clashes"]').click()
        page.locator('[data-issue-clash]').first.click()
        page.locator('#f-title').fill('Coordinate supply duct with beam')
        page.locator('#f-assignee').fill('Mechanical coordination')
        page.locator('#f-priority').select_option('High')
        page.locator('#modal button[type=submit]').click()
        check('clash issue links both entities and viewpoint', page.evaluate('converge.store.doc.issues.length===1 && converge.store.doc.issues[0].entityIds.length===2 && !!converge.store.doc.issues[0].view.camera'))
        page.locator('[data-issue]').first.click()
        page.locator('#f-status').select_option('Active')
        page.locator('#newComment').fill('Raise duct 250 mm after structural review.')
        page.locator('#modal button[type=submit]').click()
        check('issue status and comment are retained', page.evaluate('converge.store.doc.issues[0].status==="Active" && converge.store.doc.issues[0].comments.length===1'))

        page.locator('[data-bottom="clashes"]').click()
        page.locator('[data-clash-status]').first.select_option('Approved')
        check('clash review status updates', page.evaluate('converge.store.doc.results[converge.ui.test].results.some(r=>r.status==="Approved")'))
        page.evaluate('converge.runTest()')
        stats = page.evaluate('converge.store.doc.results[converge.ui.test].stats')
        check('incremental rerun reuses all 32 unchanged pairs', stats['tested']==0 and stats['reused']==32, stats)
        check('rerun preserves review status', page.evaluate('converge.store.doc.results[converge.ui.test].results.some(r=>r.status==="Approved")'))

        # Metadata, appearance and registration edits are live document commands.
        page.evaluate('converge.store.select(["demo-1"])')
        page.locator('[data-right="properties"]').click()
        page.locator('[data-action="edit-properties"]').click()
        page.locator('#f-status').fill('Coordination checked')
        page.locator('#coordNotes').fill('Verified clear access to column.')
        page.locator('#modal button[type=submit]').click()
        check('coordination property edits reach the element record', page.evaluate('converge.store.byId.get("demo-1").properties.Coordination.Status==="Coordination checked"'))
        page.locator('[data-action="undo"]').first.click()
        page.locator('[data-tab="Review"]').click()
        page.locator('#ribbon [data-action="color"]').click()
        page.locator('#f-color').fill('#aa8833')
        page.locator('#modal button[type=submit]').click()
        check('appearance override modifies the selected instance color', page.evaluate('Math.abs(converge.store.byId.get("demo-1").overrideColor[0]-170/255)<1e-8'))
        page.locator('[data-action="undo"]').first.click()
        page.locator('[data-action="element-transform"]').click()
        page.locator('#f-t0').fill('0.5')
        before_x = page.evaluate('converge.store.byId.get("demo-1").matrix[12]')
        page.locator('#modal button[type=submit]').click()
        check('selected-element transform changes placement without duplicating geometry', page.evaluate('converge.store.byId.get("demo-1").matrix[12]')==before_x+0.5)
        page.locator('[data-action="undo"]').first.click()
        page.locator('[data-tab="Coordination"]').click()
        page.locator('#ribbon [data-action="model-settings"]').click()
        page.locator('#f-model').select_option('mec')
        page.locator('#f-t0').fill('2.5')
        page.locator('#f-rotation').fill('15')
        page.locator('#modal button[type=submit]').click()
        check('federation transform applies translation and rotation', page.evaluate('converge.store.doc.models.find(m=>m.id==="mec").matrix[12]===2.5 && Math.abs(converge.store.doc.models.find(m=>m.id==="mec").matrix[8])>0.2'))
        check('federation transform invalidates prior clash results', page.evaluate('converge.store.doc.results["test-structure"].stale'))
        page.locator('[data-action="undo"]').first.click()
        check('undo restores model registration and valid prior results', page.evaluate('converge.store.doc.models.find(m=>m.id==="mec").matrix[12]===0 && !converge.store.doc.results["test-structure"].stale'))
        page.locator('[data-test="test-clearance"]').click()
        page.locator('#bottomContent [data-action="run"]').click()
        page.wait_for_function('!!converge.store.doc.results["test-clearance"] && !converge.ui.busy')
        check('clearance worker finds 12 conflicts at the 150 mm threshold', page.evaluate('converge.store.doc.results["test-clearance"].results.length===12'))
        check('clearance results include the actual 110 mm surface gap', page.evaluate('converge.store.doc.results["test-clearance"].results.some(r=>r.kind==="clearance" && Math.abs(r.distance-.11)<1e-6)'))
        page.locator('#ribbon [data-action="new-test"]').click()
        page.locator('#f-name').fill('Saved-set coordination test')
        page.locator('#f-scopeA').select_option('set:set-str')
        page.locator('#f-scopeB').select_option('model:mec')
        page.locator('#f-mode').select_option('clearance')
        page.locator('#f-clearance').fill('75')
        page.locator('#modal button[type=submit]').click()
        check('custom test stores set scopes and millimetre-to-metre conversion', page.evaluate('converge.store.doc.tests.at(-1).scopeA==="set:set-str" && converge.store.doc.tests.at(-1).clearance===.075'))

        # These imports exercise the actual dedicated import Worker and the file-input handler.
        page.locator('#fileInput').set_input_files(str(ROOT/'examples'/'coordination-sample.glb'))
        page.wait_for_function('!converge.ui.importBusy && converge.store.doc.models.length===6')
        check('GLB imports through worker into federated project', page.evaluate('converge.store.doc.entities.length===146'))
        page.locator('#fileInput').set_input_files(str(ROOT/'examples'/'coordination-sample.ifc'))
        page.wait_for_function('!converge.ui.importBusy && converge.store.doc.models.length===7')
        check('IFC sample imports geometry and properties through worker', page.evaluate('converge.store.doc.entities.length===150 && converge.store.doc.entities.some(e=>e.properties?.Pset_BeamCommon?.FireRating==="R120")'))
        check('import marks prior clash results stale', page.evaluate('Object.values(converge.store.doc.results).every(r=>r.stale)'))

        # Capture downloadable blobs without needing browser download permissions.
        page.evaluate('''(()=>{window.exported=[];window.originalObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.exported.push(blob);return window.originalObjectURL(blob)};window.originalAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return window.originalAnchorClick.call(this)};})()''')
        page.evaluate('converge.actions.report()')
        html = page.evaluate('exported.at(-1).text()')
        check('HTML report contains actual coordination and issue data', 'Coordinate supply duct with beam' in html and 'Mechanical coordination' in html and '32' in html)
        (ROOT/'docs'/'sample-coordination-report.html').write_text(html)
        page.evaluate('converge.actions.csv()')
        csv = page.evaluate('exported.at(-1).text()')
        check('CSV contains real clash result records', len(csv.splitlines())>=33 and 'Approved' in csv)
        page.evaluate('converge.actions.export()')
        packed = page.evaluate('exported.at(-1).text()')
        document = json.loads(packed)
        check('portable export includes geometry and coordination state', len(document['document']['entities'])==150 and len(document['document']['issues'])==1 and len(document['geometries'])>2)
        with tempfile.TemporaryDirectory() as folder:
            project = pathlib.Path(folder)/'roundtrip.converge'
            project.write_text(packed)
            page.locator('[data-action="rename"]').click()
            page.locator('#f-name').fill('Temporary changed project')
            page.locator('#modal button[type=submit]').click()
            page.locator('#fileInput').set_input_files(str(project))
            page.wait_for_function('!converge.ui.importBusy && converge.store.doc.name!=="Temporary changed project"')
        check('portable project import restores complete state', page.evaluate('converge.store.doc.entities.length===150 && converge.store.doc.issues.length===1 && converge.store.doc.measurements.length===1'))
        page.evaluate('(()=>{URL.createObjectURL=window.originalObjectURL;HTMLAnchorElement.prototype.click=window.originalAnchorClick})()')
        page.locator('[data-action="commands"]').first.click()
        page.locator('#commandSearch').fill('measure')
        check('command palette filters working commands', page.locator('#commandList [data-command]').count()==1)
        page.locator('#commandList [data-command]').click()
        check('command palette executes selected command', page.evaluate('converge.ui.tool==="measure"'))
        page.keyboard.press('Escape')
        check('no uncaught JavaScript errors', len(errors)==0, errors)
        result['passed']=True
    except Exception as exc:
        result['passed']=False
        result['failure']=str(exc)
        result['traceback']=traceback.format_exc()
        page.screenshot(path=str(ROOT/'docs'/'browser-failure.png'), full_page=True)
        print(result['traceback'], flush=True)
    finally:
        result['uncaughtErrors']=errors
        result['seconds']=round(time.time()-started,2)
        pathlib.Path(args.output).write_text(json.dumps(result,indent=2))
        print(json.dumps({'passed':result['passed'],'checks':len(checks),'environment':result['environment'],'seconds':result['seconds']},indent=2), flush=True)
        browser.close()
if not result['passed']:
    raise SystemExit(1)
