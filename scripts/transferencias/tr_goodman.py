import os
import json,numpy as np,collections,sys
from scipy.optimize import lsq_linear
D=json.load(open('dados/tr_sec.json'))
CATS=['Lula','Flávio','Cury','Renan','Caiado','Zema','Outros','Branco/nulo','Abstenção']
OUTS=['Lula','Flávio','Branco/nulo','Abstenção']
def mats(rows):
    X=[];Y=[];W=[]
    for r in rows:
        ap=r[7];v=r[12:19]
        x=list(v)+[r[10],ap-r[8]]; y=[r[19],r[20],r[11],ap-r[9]]
        X.append([a/ap for a in x]);Y.append([a/ap for a in y]);W.append(ap)
    return np.array(X),np.array(Y),np.array(W,float)
def fit(rows):
    X,Y,W=mats(rows);sw=np.sqrt(W)
    P=np.zeros((9,4))
    for j in range(4):
        P[:,j]=lsq_linear(X*sw[:,None],Y[:,j]*sw,bounds=(0,1)).x
    P=P/np.maximum(P.sum(1,keepdims=True),1e-9)
    N=(X*W[:,None]).sum(0)  # votos por categoria
    return P,N
def strat(rows,key):
    G=collections.defaultdict(list)
    for r in rows: G[key(r)].append(r)
    tot=np.zeros((9,4));Ntot=np.zeros(9)
    for g,rs in G.items():
        if len(rs)<30: continue
        P,N=fit(rs);tot+=P*N[:,None];Ntot+=N
    return tot/Ntot[:,None],Ntot
def show(lab,P,N):
    print(lab)
    for i,c in enumerate(CATS):
        print(f"  {c:12s} {N[i]:>12,.0f} -> "+"  ".join(f"{o} {P[i,j]*100:5.1f}%" for j,o in enumerate(OUTS)))
if __name__=='__main__':
    P,N=strat(D,lambda r:r[0]);show('BR estratificado por UF',P,N)
    P,N=strat(D,lambda r:r[0]+r[1]);show('BR estratificado por município',P,N)
