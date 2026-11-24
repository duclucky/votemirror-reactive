import json
tl=json.load(open('timeline.json'))
rd=lambda f:[l.rstrip() for l in open(f).read().splitlines() if l.strip()]
logs={k:rd(k+'.log') for k in ['for','against','skip','retry']}
logs['test']=rd('test.log')
d=json.load(open('../deployments/testnet.json'))
dep={'governor':d['demoGovernor'],'voteMirror':d['voteMirror'],'mirrorReactive':d['mirrorReactive'],'token':d['demoToken']}
h=open('page.html').read().replace('__TL__',json.dumps(tl)).replace('__LOGS__',json.dumps(logs)).replace('__DEP__',json.dumps(dep))
assert '__' not in h.replace('__TL','')
open('video.html','w').write(h)
