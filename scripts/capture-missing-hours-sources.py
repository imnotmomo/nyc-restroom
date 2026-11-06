"""Read-only public source capture. Captures are candidates, not published facts."""
from pathlib import Path
from datetime import datetime, timezone
import concurrent.futures
import hashlib
import html.parser
import json
import re
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/hours-research-2026-11-05/captures'
DEST.mkdir(exist_ok=True)
missing = json.loads((DEST.parent / 'unknown-hours.json').read_text())
targets = []
for place in missing:
    if place.get('website'):
        url = place['website']['url'] if isinstance(place['website'], dict) else place['website']
        targets.append({'key': place['id'], 'url': url, 'placeIDs': [place['id']]})
targets.extend([
    {'key': 'nyc-public-restrooms', 'url': 'https://data.cityofnewyork.us/resource/i7jb-7jku.json?' + urllib.parse.urlencode({'$limit': 5000, '$order': ':id', '$select': ':id as source_row_id,facility_name,location_type,operator,status,open,hours_of_operation,website,latitude,longitude,additional_notes'}), 'placeIDs': []},
    {'key': 'parks-legacy-restrooms', 'url': 'https://www.nycgovparks.org/bigapps/DPR_PublicRestrooms_001.json', 'placeIDs': []},
    {'key': 'central-park-restrooms', 'url': 'https://www.centralparknyc.org/restrooms', 'placeIDs': []},
    {'key': 'bbp-hours', 'url': 'https://brooklynbridgepark.org/about/', 'placeIDs': []},
    {'key': 'bpca-faqs', 'url': 'https://bpca.ny.gov/places/parks/', 'placeIDs': []},
    {'key': 'stadium-tennis', 'url': 'https://www.stadiumtennisnyc.com/contact/', 'placeIDs': []},
    {'key': 'highline-visit', 'url': 'https://www.thehighline.org/visit/', 'placeIDs': []},
])

class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ['script', 'style', 'noscript']: self.skip += 1
        if tag in ['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'br', 'td', 'dt', 'dd']: self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ['script', 'style', 'noscript']: self.skip = max(0, self.skip - 1)
    def handle_data(self, value):
        if not self.skip: self.parts.append(value)

def capture(target):
    key = hashlib.sha256(target['key'].encode()).hexdigest()[:20]
    result = {**target, 'retrievedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
    try:
        req = urllib.request.Request(target['url'], headers={'User-Agent': 'Mozilla/5.0 (compatible; RestroomReadyHoursResearch/1.0)'})
        with urllib.request.urlopen(req, timeout=35) as response:
            raw = response.read(8_000_001)
            if len(raw) > 8_000_000: raise ValueError('Source exceeds bounded capture size')
            result.update(status=response.status, finalURL=response.url, contentType=response.headers.get('Content-Type'))
        suffix = '.json' if 'json' in (result['contentType'] or '') else '.html'
        (DEST / (key + suffix)).write_bytes(raw)
        text = raw.decode('utf-8', errors='replace')
        parser = Text(); parser.feed(text)
        visible = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())
        (DEST / (key + '.txt')).write_text(visible)
        result.update(path=key + suffix, textPath=key + '.txt', sha256=hashlib.sha256(raw).hexdigest())
        result['candidateLines'] = [line[:800] for line in visible.splitlines() if re.search(r'hours|closed|closure|renovation|reopen|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b[1-9][0-2]?\s?(?:am|pm)\b', line, re.I)][:75]
    except Exception as error:
        result.update(status='unavailable', error=str(error)[:300])
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(capture, targets))
(DEST / 'manifest.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps([{'key': row['key'], 'status': row['status'], 'path': row.get('path'), 'candidateLines': row.get('candidateLines', [])[:12]} for row in results]))
