import json, subprocess, wave, os, numpy as np
from narration import S
os.makedirs("audio", exist_ok=True)
SR=22050; LEAD=0.7; GAP=0.28; TAIL=0.9
from piper import PiperVoice
v=PiperVoice.load("voices/en_US-ryan-high.onnx")
def synth(text):
    out=[]
    for ch in v.synthesize(text): out.append(ch.audio_int16_array)
    a=np.concatenate(out)
    nz=np.where(np.abs(a)>300)[0]
    return a[max(nz[0]-400,0):nz[-1]+1200]
full=[]; t=0.0; cues={}; scenes=[]
for name,lines in S.items():
    start=t; sil=np.zeros(int(LEAD*SR),np.int16); full.append(sil); t+=len(sil)/SR
    cl=[]
    for cap,say in lines:
        a=synth(say); cl.append({"cap":cap,"t0":round(t-start,3),"t1":round(t-start+len(a)/SR,3)})
        full.append(a); t+=len(a)/SR
        g=np.zeros(int(GAP*SR),np.int16); full.append(g); t+=len(g)/SR
    sil=np.zeros(int(TAIL*SR),np.int16); full.append(sil); t+=len(sil)/SR
    scenes.append({"name":name,"start":round(start,3),"dur":round(t-start,3),"lines":cl})
a=np.concatenate(full)
w=wave.open("audio/voice.wav","wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(a.tobytes()); w.close()
json.dump({"total":round(t,3),"scenes":scenes},open("timeline.json","w"),indent=1)
print(round(t,2)); [print(s["name"],s["start"],s["dur"]) for s in scenes]
