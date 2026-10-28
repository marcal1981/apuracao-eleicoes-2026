import os
import json,numpy as np,collections,sys
sys.path.insert(0,os.path.dirname(__file__))
from tr_goodman import strat,CATS,OUTS,fit
import tr_homog
D=json.load(open('dados/tr_sec.json'))
CANDS=['Cury','Renan','Caiado','Zema','Outros']
FULL={'Cury':'Augusto Cury','Renan':'Renan Santos','Caiado':'Ronaldo Caiado','Zema':'Romeu Zema','Outros':'Demais candidatos'}
def tr(P,N,i): return {o:round(float(P[i,j]*100),1) for j,o in enumerate(OUTS)}|{'votos':int(N[i])}
def scope(rows,label,homog_top=0.01,strat_key=None):
    out={'label':label,'secoes':len(rows)}
    Pm,Nm=strat(rows,strat_key or (lambda r:r[0]+r[1]))
    try: Pu,Nu=strat(rows,lambda r:r[0])
    except Exception: Pu,Nu=Pm,Nm
    H=tr_homog.run(rows,top=homog_top,minap=100)
    flows={}
    for c in CATS:
        i=CATS.index(c); f={'principal':tr(Pm,Nm,i),'alternativo':tr(Pu,Nu,i)}
        if c in H:
            h=H[c]; f['homogeneas']={'Lula':round(h['dL_per100'],1),'Flávio':round(h['dF_per100'],1),'Branco/nulo':round(h['dBN_per100'],1),'Abstenção':round(h['dABS_per100'],1),'secoes':h['n'],'excesso_pts':round(h['excess_pts'],2),'confiavel':bool(h['excess_pts']>=2 and all(-5<=x<=105 for x in (h['dL_per100'],h['dF_per100'],h['dBN_per100'],h['dABS_per100'])) and 80<=h['dL_per100']+h['dF_per100']+h['dBN_per100']+h['dABS_per100']<=125 and h['n']>=30)}
        flows[c]=f
    out['fluxos']=flows
    # urnas-símbolo: top 10 por candidato (aptos>=150)
    top={}
    for k,ci in (('Cury',14),('Renan',15),('Caiado',16),('Zema',17)):
        cand=[r for r in rows if r[7]>=150]
        cand.sort(key=lambda r:-r[ci]/max(sum(r[12:19]),1))
        L=[]
        for r in cand[:10]:
            v1=sum(r[12:19]); v2=r[19]+r[20]
            L.append({'uf':r[0],'municipio':r[4],'zona':r[2],'secao':r[3],'local':r[5],'endereco':r[6],'aptos':r[7],
                      'pct':round(r[ci]/v1*100,1),'votos':r[ci],'lula1':r[12],'flavio1':r[13],'lula2':r[19],'flavio2':r[20],
                      'abst1':round((1-r[8]/r[7])*100,1),'abst2':round((1-r[9]/r[7])*100,1),'bn1':r[10],'bn2':r[11]})
        top[k]=L
    out['urnas']=top
    tot={c:int(sum(r[12+i] for r in rows)) for i,c in enumerate(['Lula','Flávio','Cury','Renan','Caiado','Zema','Outros'])}
    tot['Lula2']=int(sum(r[19] for r in rows));tot['Flávio2']=int(sum(r[20] for r in rows))
    out['totais']=tot
    return out
R={'gerado':'2026-10-28','fonte':'TSE — votação por seção eleitoral 2026 (1º e 2º turnos, Presidente)','escopos':{}}
R['escopos']['BR']=scope(D,'Brasil')
for uf in sorted({r[0] for r in D}):
    R['escopos'][uf]=scope([r for r in D if r[0]==uf],uf); print(uf,flush=True)
sjc=[r for r in D if r[1]=='70998']
R['escopos']['SJC']=scope(sjc,'São José dos Campos',homog_top=0.05,strat_key=lambda r:r[2])
json.dump(R,open('apps/web/public/data/transferencias-2026.json','w'),ensure_ascii=False,separators=(',',':'))
for k in ('BR','SP','SJC'):
    print(k);[print(' ',c,R['escopos'][k]['fluxos'][c]) for c in CANDS+['Branco/nulo','Abstenção']]
