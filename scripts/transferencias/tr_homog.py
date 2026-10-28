import os
import json,numpy as np,collections
D=json.load(open('dados/tr_sec.json'))
NAMES=['Lula','Flávio','Cury','Renan','Caiado','Zema','Outros']
def run(rows,top=0.01,minap=100):
    rows=[r for r in rows if r[7]>=minap]
    ap=np.array([r[7] for r in rows],float); valid1=np.array([sum(r[12:19]) for r in rows],float)
    X={n:np.array([r[12+i] for r in rows])/ap for i,n in enumerate(NAMES)}
    sh={n:np.array([r[12+i] for r in rows])/np.maximum(valid1,1) for i,n in enumerate(NAMES)}
    abs1=1-np.array([r[8] for r in rows])/ap; abs2=1-np.array([r[9] for r in rows])/ap
    bn1=np.array([r[10] for r in rows])/ap; bn2=np.array([r[11] for r in rows])/ap
    L2=np.array([r[19] for r in rows])/ap; F2=np.array([r[20] for r in rows])/ap
    out={'dL':L2-X['Lula'],'dF':F2-X['Flávio'],'dBN':bn2-bn1,'dABS':abs2-abs1}
    city=np.array([r[0]+r[1] for r in rows]); idx={c:i for i,c in enumerate(set(city))}; g=np.array([idx[c] for c in city])
    def dm(v):
        s=np.bincount(g,weights=v*ap);n=np.bincount(g,weights=ap);return v-(s/n)[g]
    res={}
    for k in ['Cury','Renan','Caiado','Zema']:
        e=dm(X[k]); cut=np.quantile(e,1-top); m=e>=cut
        ex=np.average(e[m],weights=ap[m])
        r={'n':int(m.sum()),'share_top':float(np.average(sh[k][m],weights=valid1[m])),'share_all':float(sh[k].dot(valid1)/valid1.sum()),'excess_pts':float(ex*100)}
        for o,v in out.items():
            r[o]=float(np.average(dm(v)[m],weights=ap[m])*100); r[o+'_per100']=float(r[o]/r['excess_pts']*100)
        # also: excess of Lula/Flávio r1 there
        r['exL1']=float(np.average(dm(X['Lula'])[m],weights=ap[m])*100); r['exF1']=float(np.average(dm(X['Flávio'])[m],weights=ap[m])*100)
        res[k]=r
    return res
if __name__=='__main__':
    for k,r in run(D).items():
        print(k,{a:round(b,2) for a,b in r.items()})
