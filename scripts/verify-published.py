#!/usr/bin/env python3
"""Verify the exact published source revision and content, not just HTTP 200."""
import hashlib, json, os, time, urllib.parse, urllib.request
base = os.environ['SITE_URL'].rstrip('/') + '/'
expected = os.environ['EXPECTED_SOURCE']
def fetch(name):
    url = urllib.parse.urljoin(base, name) + '?revision=' + expected
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()
last_error = None
for attempt in range(24):
    try:
        metadata = json.loads(fetch('deployment.json'))
        assert metadata['application'] == 'Converge Studio'
        assert metadata['sourceCommit'] == expected, metadata['sourceCommit']
        for name, digest in metadata['assets'].items():
            actual = hashlib.sha256(fetch(name)).hexdigest()
            assert actual == digest, 'Published asset checksum mismatch: ' + name
        print(json.dumps(dict(published=True, url=base, sourceCommit=expected,
                              verifiedAssets=len(metadata['assets'])), indent=2))
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write(f'## Published Converge Studio\n\n[Open application]({base})\n\nSource: `{expected}`. All {len(metadata["assets"])} critical published assets verified by SHA-256.\n')
        break
    except Exception as error:
        last_error = error
        print(f'Publication verification attempt {attempt + 1}: {error}', flush=True)
        if attempt == 23:
            raise RuntimeError('Public deployment verification failed') from last_error
        time.sleep(5)
