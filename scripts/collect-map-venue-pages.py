"""Read-only capture of public directory-linked venue pages. Captures are candidates, not reviewed facts."""
import concurrent.futures, hashlib, html.parser, json, pathlib, re, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/research-map-2026-10-24/linked-pages'
DEST.mkdir(parents=True, exist_ok=True)
places = json.loads((ROOT / 'data/research-map-2026-10-24/map-inventory.json').read_text())['places']
allowed = {'nypl.org','bklynlibrary.org','queenslibrary.org','queenslibrary.org','nycgovparks.org','nyc.gov','nps.gov','centralparknyc.org','hudsonriverpark.org'}

class Visible(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.skip=0; self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript'): self.skip+=1
        if tag in ('p','div','li','tr','h1','h2','h3','br'): self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def capture(p):
    url=p['baseRecord'].get('website')
    if isinstance(url,dict): url=url.get('url')
    if not isinstance(url,str): return None
    u=urllib.parse.urlparse(url)
    host=u.hostname or ''
    if u.scheme not in ('http','https') or u.username or u.password or not any(host==x or host.endswith('.'+x) for x in allowed): return None
    if u.scheme=='http': url='https://'+url[7:]
    out={'placeID':p['id'],'name':p['name'],'requestedURL':url,'retrievedAt':datetime.now(timezone.utc).isoformat(),'status':'capture-pending-review','reviewed':False}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'RestroomReadyResearch/1.0 (public venue information)'})
        with urllib.request.urlopen(req,timeout=18) as r:
            body=r.read(2_000_001); out['httpStatus']=r.status; out['finalURL']=r.url
        if len(body)>2_000_000: raise ValueError('response exceeds capture bound')
        raw=body.decode('utf-8',errors='replace'); out['responseSHA256']=hashlib.sha256(body).hexdigest()
        parser=Visible(); parser.feed(raw)
        lines=[' '.join(s.split()) for s in ''.join(parser.parts).splitlines()]; lines=[s for s in lines if s]
        text='\n'.join(lines)
        out['title']=next(iter(re.findall(r'<title[^>]*>(.*?)</title>',raw,re.S|re.I)),None)
        out['visibleText']=text[:80000];out['textTruncated']=len(text)>80000
        out['candidateLines']=[s[:1500] for s in lines if re.search(r'restroom|bathroom|elevator|stairs|accessible|accessibility|hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday',s,re.I)][:80]
        out['structuredData']=[s[:20000] for s in re.findall(r'<script[^>]*type=[\"\x27]application/ld\+json[\"\x27][^>]*>(.*?)</script>',raw,re.S|re.I)][:6]
        if re.search(r'access denied|verify you are human|enable javascript and cookies|just a moment|request unsuccessful|incapsula',text[:1000],re.I): out['status']='blocked-not-reviewed'
    except Exception as e:
        out['status']='fetch-failed-not-reviewed';out['error']=type(e).__name__+': '+str(e)[:220]
    path=DEST/(hashlib.sha256(p['id'].encode()).hexdigest()[:20]+'.json')
    path.write_text(json.dumps(out,indent=2)+'\n')
    return {k:v for k,v in out.items() if k not in ('visibleText','candidateLines','structuredData')}

targets=[p for p in places if p['sourceKind']=='city' and p['baseRecord'].get('website')]
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for result in pool.map(capture,targets):
        if result: results.append(result)
        if len(results)%25==0: print(json.dumps({'captures':len(results),'targets':len(targets)}),flush=True)
        time.sleep(.15)
(DEST/'index.json').write_text(json.dumps({'readOnly':True,'targets':len(targets),'captures':results},indent=2)+'\n')
print(json.dumps({'completedCaptures':len(results),'targets':len(targets),'reviewed':0,'productionWrites':0}),flush=True)
