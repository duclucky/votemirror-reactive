# Read-only: checks every address and hash of main's README / deployments/testnet.json against the chains
# and writes <mode>.log in the format script/demo.sh prints. Sends no transaction.
import json, re, subprocess, sys, urllib.request
R=__import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
BASE='https://sepolia.base.org'; LASNA='https://lasna-rpc.rnk.dev/'
D=json.load(open(R+'/deployments/testnet.json'))
GOV,VM,MR,TOK,PROXY=[D[k].lower() for k in ('demoGovernor','voteMirror','mirrorReactive','demoToken','callbackProxy')]
TR=[a.lower() for a in D['trustedVoters']]
def rpc(u,m,p):
    q=urllib.request.Request(u,json.dumps({'jsonrpc':'2.0','id':1,'method':m,'params':p}).encode(),{'Content-Type':'application/json','User-Agent':'curl/8'})
    for _ in range(4):
        try: return json.load(urllib.request.urlopen(q,timeout=30))['result']
        except Exception as e: err=e
    raise err
def k(sig): return subprocess.check_output(['cast','keccak',sig]).decode().strip()
def call(u,to,sig,*a): return subprocess.check_output(['cast','call',to,sig,*a,'--rpc-url',u]).decode().strip()
T={n:k(s) for n,s in dict(PC='ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)',VC='VoteCast(address,uint256,uint8,uint256,string)',
 MQ='MirrorRequested(uint256,uint8,uint256)',MT='MirrorRetried(uint256,uint8,uint256)',MI='Mirrored(uint256,uint8,uint256)',SK='Skipped(uint256,uint8,uint8)',PS='PausedSet(bool)',SS='SkipSet(uint256,bool)').items()}
REASON=['Paused','SkippedByOwner','AlreadyVoted','NotActive','CastFailed','NotConfirmed']
ok=True
def chk(c,msg):
    global ok
    if not c: ok=False; print('FAIL',msg)
def rc(u,h):
    r=rpc(u,'eth_getTransactionReceipt',[h]); chk(r is not None,'no receipt '+h)
    chk(r['status']=='0x1','status '+h); return r
def ts(u,r): return int(rpc(u,'eth_getBlockByNumber',[r['blockNumber'],False])['timestamp'],16)
def logs(r,addr,t): return [l for l in r['logs'] if l['address'].lower()==addr and l['topics'][0]==t]
w=lambda d,i:int(d[2+64*i:66+64*i],16)
# hashes from the README table, in row order
rd=open(R+'/README.md').read(); tab=rd[rd.index('## Demo loops'):rd.index("### VoteMirror's own check")]
rows=[l for l in tab.splitlines() if l.startswith('| ') and '0x' in l]
hx=lambda s:re.findall(r'0x[0-9a-f]{64}',s)
def cells(l): return [sorted(set(hx(c)),key=hx(c).index) for c in l.split('|')[2:6]]
prop,v1,v2,re_,cb,ask,cb2=[cells(l) for l in rows[:7]]
modes=['for','against','skip','retry']; want=[1,0,1,1]; out={}
for i,m in enumerate(modes):
    L=[]
    L.append('MirrorReactive: %s lREACT, debt %s'%(call(LASNA,MR,'debt()(uint256)') and subprocess.check_output(['cast','balance',MR,'--ether','--rpc-url',LASNA]).decode().strip(),0)) if False else None
    r=rc(BASE,prop[i][0]); chk(r['to'].lower()==GOV,'propose to'); pc=logs(r,GOV,T['PC']); chk(len(pc)==1,'ProposalCreated'); pid=w(pc[0]['data'],0)
    L+=['proposal:       %d'%pid,'propose tx:     '+prop[i][0]]
    if m in('skip','retry'):
        r=rc(BASE,prop[i][1]); chk(r['to'].lower()==VM,m+' aux to')
        if m=='skip': l=logs(r,VM,T['SS']); chk(len(l)==1 and int(l[0]['topics'][1],16)==pid and w(l[0]['data'],0)==1,'SkipSet'); L.append('skip tx:        '+prop[i][1])
        else: l=logs(r,VM,T['PS']); chk(len(l)==1 and w(l[0]['data'],0)==1,'PausedSet true'); L.append('pause tx:       '+prop[i][1])
    for j,v in enumerate((v1,v2)):
        r=rc(BASE,v[i][0]); chk(r['to'].lower()==GOV,'vote to'); l=logs(r,GOV,T['VC']); chk(len(l)==1,'VoteCast')
        voter='0x'+l[0]['topics'][1][-40:]; chk(voter==TR[j],'voter %d'%j); chk(w(l[0]['data'],0)==pid and w(l[0]['data'],1)==want[i],'vote pid/support')
        L.append('VoteCast tx %d:  %s  (%s)'%(j+1,v[i][0],D['trustedVoters'][j])); tv=ts(BASE,r)
    r=rc(LASNA,re_[i][0]); l=logs(r,MR,T['MQ']); chk(len(l)==1 and int(l[0]['topics'][1],16)==pid and w(l[0]['data'],0)==want[i] and w(l[0]['data'],1)==2,'MirrorRequested')
    L.append('react() tx:     %s (Lasna, MirrorRequested)'%re_[i][0])
    def cbres(h):
        r=rc(BASE,h); chk(r['to'].lower()==PROXY,'callback to proxy')
        a=logs(r,VM,T['MI']); b=logs(r,VM,T['SK']); chk(len(a)+len(b)==1,'callback event')
        if a: chk(int(a[0]['topics'][1],16)==pid and w(a[0]['data'],0)==want[i] and w(a[0]['data'],1)==10**21,'Mirrored'); return 'Mirrored',ts(BASE,r)
        chk(int(b[0]['topics'][1],16)==pid,'Skipped pid'); return 'Skipped(%s)'%REASON[w(b[0]['data'],1)],ts(BASE,r)
    res,tc=cbres(cb[i][0]); exp={'for':'Mirrored','against':'Mirrored','skip':'Skipped(SkippedByOwner)','retry':'Skipped(Paused)'}[m]; chk(res==exp,'result '+res)
    L.append('callback tx:    %s (Base Sepolia, %s, %ds after the last trusted vote)'%(cb[i][0],res.split('(')[0],tc-tv)); delay=tc-tv
    if m=='retry':
        un,rt=ask[3]; r=rc(BASE,un); chk(r['to'].lower()==VM,'unpause to'); l=logs(r,VM,T['PS']); chk(len(l)==1 and w(l[0]['data'],0)==0,'PausedSet false'); L.append('unpause tx:     '+un)
        r=rc(LASNA,rt); l=logs(r,MR,T['MT']); chk(len(l)==1 and int(l[0]['topics'][1],16)==pid and w(l[0]['data'],0)==1,'MirrorRetried'); L.append('retry tx:       %s (Lasna, MirrorRetried)'%rt)
        res2,_=cbres(cb2[3][0]); chk(res2=='Mirrored','second callback'); L.append('callback tx 2:  %s (Base Sepolia, %s)'%(cb2[3][0],res2))
    hv=call(BASE,GOV,'hasVoted(uint256,address)(bool)',str(pid),VM); pv=call(BASE,GOV,'proposalVotes(uint256)(uint256,uint256,uint256)',str(pid)).replace('\n',' ')
    chk(hv==('false' if m=='skip' else 'true'),'hasVoted'); n=[int(x.split()[0]) for x in pv.split(' ') if x[:1].isdigit() and 'e' not in x]
    chk([x//10**18 for x in n]=={'for':[0,3000,0],'against':[3000,0,0],'skip':[0,2000,0],'retry':[0,3000,0]}[m],'tally %s'%n)
    L+=['VoteMirror voted: '+hv,'votes (against, for, abstain): '+pv]
    L=[x for x in L if x]; open(m+'.log','w').write('\n'.join(L)+'\n'); out[m]={'pid':pid,'res':res,'delay':delay}
# deployment
for n,a,u in(('gov',GOV,BASE),('vm',VM,BASE),('tok',TOK,BASE),('mr',MR,LASNA)): chk(len(rpc(u,'eth_getCode',[a,'latest']))>2,'code '+n)
chk(call(LASNA,MR,'mirror()(address)').lower()==VM,'MR.mirror'); chk(call(LASNA,MR,'threshold()(uint256)').split()[0]=='2','MR.threshold'); chk(call(BASE,VM,'threshold()(uint256)').split()[0]=='2','VM.threshold')
chk(call(BASE,VM,'paused()(bool)')=='false','VM not paused'); chk(call(BASE,VM,'owner()(address)').lower()==D['owner'].lower(),'VM owner')
for a in D['trustedVoters']: chk(call(LASNA,MR,'isTrusted(address)(bool)',a)=='true','MR trusted'); 
for t in('setMirrorTx',): rc(LASNA,D[t])
rc(BASE,D['delegateTx'])
for a in(VM,GOV,TOK):
    j=json.load(urllib.request.urlopen(urllib.request.Request('https://base-sepolia.blockscout.com/api/v2/smart-contracts/'+a,headers={'User-Agent':'curl/8'}),timeout=30)); chk(j.get('is_verified') and j.get('is_fully_verified'),'blockscout '+a)
j=json.load(urllib.request.urlopen(urllib.request.Request('https://sourcify.dev/server/v2/contract/5318007/'+D['mirrorReactive'],headers={'User-Agent':'curl/8'}),timeout=30)); chk(j.get('match')=='exact_match','sourcify')
json.dump(out,open('verify.json','w'),default=str); print('ALL OK' if ok else 'FAILED',{m:(o['res'],o['delay']) for m,o in out.items()})
