import os
import zipfile,csv,io,json,collections
CAT={'13':0,'22':1,'70':2,'14':3,'55':4,'30':5}  # L F Cury Renan Caiado Zema; outros=6
z=zipfile.ZipFile(os.environ.get('TSE_DETALHE_SECAO','detalhe_votacao_secao_2026.zip'))
S={}
for r in csv.DictReader(io.TextIOWrapper(z.open('detalhe_votacao_secao_2026_BR.csv'),encoding='latin1'),delimiter=';'):
    if r['SG_UF']=='ZZ': continue
    k=(r['SG_UF'],r['CD_MUNICIPIO'],r['NR_ZONA'],r['NR_SECAO'])
    d=S.setdefault(k,{'nm':r['NM_MUNICIPIO'],'loc':r['NM_LOCAL_VOTACAO'],'end':r['DS_LOCAL_VOTACAO_ENDERECO']})
    d[r['NR_TURNO']]=(int(r['QT_APTOS']),int(r['QT_COMPARECIMENTO']),int(r['QT_VOTOS_BRANCOS'])+int(r['QT_VOTOS_NULOS']))
print('S',len(S),flush=True)
z=zipfile.ZipFile(os.environ.get('TSE_VOTACAO_SECAO','votacao_secao_2026_BR.zip'))
V={}
for r in csv.DictReader(io.TextIOWrapper(z.open('votacao_secao_2026_BR.csv'),encoding='latin1'),delimiter=';'):
    if r['SG_UF']=='ZZ': continue
    n=r['NR_VOTAVEL']
    if n in ('95','96'): continue
    k=(r['SG_UF'],r['CD_MUNICIPIO'],r['NR_ZONA'],r['NR_SECAO'],r['NR_TURNO'])
    v=V.get(k)
    if v is None: v=V[k]=[0]*7
    v[CAT.get(n,6)]+=int(r['QT_VOTOS'])
print('V',len(V),flush=True)
out=[]
for k,t in S.items():
    if '1' not in t or '2' not in t: continue
    a1,a2=t['1'],t['2']
    if a1[0]<50 or a1[0]!=a2[0]: continue
    v1=V.get(k+('1',)); v2=V.get(k+('2',))
    if not v1 or not v2: continue
    out.append([k[0],k[1],k[2],k[3],t['nm'],t['loc'],t['end'],a1[0],a1[1],a2[1],a1[2],a2[2]]+v1+[v2[0],v2[1]])
json.dump(out,open('dados/tr_sec.json','w'),ensure_ascii=False)
print('rows',len(out))
