# Plataforma Eleições 2026 — Apuração em Tempo Real

## 1. Visão geral

Projeto de uma plataforma independente para **visualização, acompanhamento e análise de dados oficiais das Eleições 2026**, com atualização em tempo real, ranking dos candidatos por votação, evolução da apuração, mapas, análise por município/UF e mecanismos de auditoria.

### Objetivo

Oferecer ao eleitor uma interface mais simples e analítica para acompanhar:

- Presidente;
- Governador;
- Senador;
- Deputado Federal;
- Deputado Estadual/Distrital;
- 1º e 2º turnos;
- votos;
- percentuais;
- posições;
- evolução da apuração;
- seções totalizadas;
- municípios;
- partidos/federações;
- distribuição de cadeiras;
- Boletins de Urna;
- histórico;
- dados por região.

### Princípio central

A fonte primária dos resultados deve ser o **Tribunal Superior Eleitoral (TSE)**. O sistema próprio não deve substituir o resultado oficial, mas organizar, acelerar a visualização e produzir análises calculadas a partir dos dados oficiais.

---

# 2. Fontes de dados

## 2.1 Fonte primária — TSE

### Portal de resultados

https://resultados.tse.jus.br/

Uso:

- resultados em tempo real;
- totalização;
- votos;
- percentuais;
- seções totalizadas;
- candidatos;
- municípios;
- UFs.

### Documentação técnica do TSE

https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados

Uso:

- estrutura dos arquivos;
- URLs;
- formatos;
- regras de atualização;
- códigos;
- arquivos de acompanhamento;
- limites técnicos;
- simulados;
- informações específicas das Eleições 2026.

### Dados Abertos do TSE

https://dadosabertos.tse.jus.br/

Uso:

- candidatos;
- partidos;
- federações;
- eleitorado;
- bens;
- prestação de contas;
- resultados históricos;
- dados cadastrais;
- informações eleitorais complementares.

### Boletins de Urna

Uso:

- conferência;
- auditoria;
- consulta por seção;
- comparação entre resultado de seção e totalização.

---

## 2.2 Fontes complementares

### TREs

Utilização:

- informações eleitorais estaduais;
- comunicados;
- informações locais;
- complementação institucional.

### IBGE

Utilização:

- municípios;
- UF;
- códigos geográficos;
- informações territoriais.

Fonte:

https://www.ibge.gov.br/

### Legislação eleitoral

Usar TSE e legislação oficial como referência para regras de:

- eleição;
- distribuição de cadeiras;
- segundo turno;
- situações de candidatura;
- totalização;
- eleição majoritária e proporcional.

---

# 3. Regra de confiabilidade

Hierarquia recomendada:

1. TSE — resultado oficial;
2. TSE Dados Abertos;
3. TRE;
4. IBGE para dados geográficos;
5. outras fontes somente como contexto.

**Portais jornalísticos não devem ser usados como fonte primária dos resultados.**

---

# 4. Arquitetura geral

```text
                         ┌──────────────────┐
                         │       TSE        │
                         │ Dados oficiais   │
                         └────────┬─────────┘
                                  │
                         JSON / CSV / BU
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │    ELECTION INGESTOR    │
                    │      Node + TypeScript  │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             Raw Storage                PostgreSQL
                    │                         │
                    │                         ▼
                    │                    Aggregator
                    │                         │
                    └─────────────┐           ▼
                                  │          Redis
                                  │           │
                                  ▼           ▼
                              API própria + SSE
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
                   Next.js                        Mobile
                       │
                       ▼
                    Eleitor
```

---

# 5. Stack tecnológica

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- Recharts
- MapLibre GL

## Backend

- Node.js
- TypeScript
- NestJS
- Prisma

## Banco

- PostgreSQL

## Cache

- Redis

## Tempo real

- Server-Sent Events (SSE)

## Infraestrutura

- Cloudflare
- CDN
- Object Storage
- PostgreSQL gerenciado
- Redis gerenciado

## Monitoramento

- Sentry
- ferramenta de uptime
- logs estruturados

---

# 6. Modelo de dados

A arquitetura deve ser genérica para permitir eleições futuras.

## Principais entidades

```text
elections
election_rounds
states
cities
zones
sections

offices
positions

parties
federations

candidates

candidate_results
party_results

section_results
city_results
state_results
national_results

vote_updates
elected_candidates

sources
source_files
source_versions

ingestion_runs
ingestion_errors

audit_events
```

---

# 7. Cargos

Não criar o sistema pensando em campos fixos apenas para 2026.

Modelo genérico:

```text
office
├── PRESIDENTE
├── GOVERNADOR
├── SENADOR
├── DEPUTADO_FEDERAL
└── DEPUTADO_ESTADUAL
```

Para 2026:

- Presidente;
- Governador;
- Senador;
- Deputado Federal;
- Deputado Estadual/Distrital.

---

# 8. Particularidade do Senado

O sistema precisa tratar corretamente a quantidade de vagas.

Em 2026:

```text
SENADO
Vagas: 2
```

A interface deve apresentar:

```text
1º Candidato A
2º Candidato B
----------------
3º Candidato C
4º Candidato D
```

A informação de eleito deve ser baseada no resultado oficial, e não simplesmente no primeiro/segundo lugar calculado pela interface.

---

# 9. Deputados — tratamento especial

Não basta ordenar os candidatos por votos.

É necessário considerar:

- votação nominal;
- votação de legenda;
- partido;
- federação;
- número de vagas;
- regras da eleição proporcional;
- distribuição das cadeiras;
- resultado oficial.

Dashboard:

```text
Câmara dos Deputados — SP

Total de vagas: XX

Partido/Federação     Cadeiras
--------------------------------
Federação A              XX
Partido B                XX
Federação C              XX
```

Depois:

```text
ELEITOS

1. Candidato
2. Candidato
3. Candidato
...
```

---

# 10. Banco PostgreSQL

## Tabelas principais

### elections

```text
id
year
name
status
created_at
updated_at
```

### election_rounds

```text
id
election_id
round_number
date
status
```

### states

```text
id
code
name
ibge_code
```

### cities

```text
id
state_id
ibge_code
name
```

### offices

```text
id
code
name
scope
seats
```

### parties

```text
id
number
name
acronym
```

### federations

```text
id
name
acronym
```

### candidates

```text
id
tse_id
name
ballot_name
number
party_id
federation_id
office_id
state_id
status
photo_url
```

### candidate_results

```text
id
candidate_id
election_id
round_id
state_id
city_id
votes
percentage
position
updated_at
```

### section_results

```text
id
section_id
candidate_id
votes
source_file_id
received_at
```

### vote_updates

```text
id
election_id
round_id
office_id
timestamp
totalized_percentage
total_votes
payload_hash
```

---

# 11. API própria

Base:

```text
/api/v1
```

## Eleições

```http
GET /api/v1/elections
GET /api/v1/elections/2026
GET /api/v1/elections/2026/rounds
```

## Cargos

```http
GET /api/v1/elections/2026/offices
```

## Candidatos

```http
GET /api/v1/candidates
GET /api/v1/candidates/:id
GET /api/v1/candidates/:id/results
```

Filtros:

```text
office
state
city
party
federation
round
```

## Resultados

```http
GET /api/v1/results
```

Exemplo:

```text
year=2026
round=1
office=senator
state=SP
```

## Ranking

```http
GET /api/v1/results/ranking
```

## Municípios

```http
GET /api/v1/cities/:id/results
```

## Estados

```http
GET /api/v1/states/:uf/results
```

## Partidos

```http
GET /api/v1/parties/:id/results
```

## Boletim de Urna

```http
GET /api/v1/sections/:id
GET /api/v1/sections/:id/results
```

---

# 12. Estrutura de resposta da API

Exemplo:

```json
{
  "election": 2026,
  "round": 1,
  "office": "senator",
  "state": "SP",
  "totalized": 72.43,
  "updatedAt": "2026-10-04T18:42:31-03:00",
  "candidates": [
    {
      "position": 1,
      "candidateId": "123",
      "name": "Candidato A",
      "votes": 1234567,
      "percentage": 31.42
    }
  ]
}
```

---

# 13. Ranking

Os candidatos devem ser ordenados automaticamente por votos.

Campos recomendados:

```text
posição atual
posição anterior
variação de posição
votos
percentual
diferença para o anterior
```

Exemplo:

| Posição | Candidato | Votos | % | Variação |
|---:|---|---:|---:|---:|
| 1 | Candidato A | 1.240.321 | 31,2% | — |
| 2 | Candidato B | 1.101.442 | 27,7% | ↑1 |
| 3 | Candidato C | 980.312 | 24,6% | ↓1 |

A variação deve ser calculada comparando snapshots sucessivos da apuração.

---

# 14. Dashboard principal

## Indicadores

```text
ELEIÇÕES 2026

Seções totalizadas
82,4%

Votos apurados
XX.XXX.XXX

Eleitorado
XX.XXX.XXX

Comparecimento
XX,XX%

Abstenção
XX,XX%

Última atualização
18:42:31
```

## Situação

Estados possíveis:

```text
AGUARDANDO
APURAÇÃO EM ANDAMENTO
DADOS SENDO ATUALIZADOS
TOTALIZAÇÃO FINALIZADA
```

---

# 15. Dashboard por cargo

## Presidente

Mostrar:

- ranking;
- votos;
- percentual;
- evolução;
- diferença;
- mapa;
- distribuição por UF;
- municípios;
- situação do turno.

## Governador

Mostrar:

- ranking por estado;
- votos;
- percentual;
- evolução;
- mapa;
- municípios;
- situação do turno.

## Senador

Mostrar:

- duas vagas;
- ranking;
- votos;
- percentual;
- candidatos;
- mapa;
- evolução.

## Deputado Federal

Mostrar:

- ranking nominal;
- votos;
- partido;
- federação;
- cadeiras;
- distribuição proporcional;
- eleitos conforme resultado oficial.

## Deputado Estadual/Distrital

Mesma estrutura dos deputados federais, adaptada à respectiva assembleia/câmara.

---

# 16. Evolução da apuração

Guardar snapshots.

Exemplo:

```text
18:00 → 1.000.000 votos
18:05 → 1.200.000
18:10 → 1.350.000
```

Nunca sobrescrever apenas o resultado anterior.

Isso permite:

- gráfico de evolução;
- variação de posição;
- velocidade de totalização;
- histórico da apuração;
- auditoria.

---

# 17. Gráficos

### Gráfico de votação

```text
% votos
35 ┤                ╭──── A
30 ┤           ╭────╯
25 ┤      ╭────╯
20 ┤──────╯
15 ┤
10 ┤
   └────────────────────
    17h  18h  19h  20h
```

### Outros gráficos

- evolução dos votos;
- percentual;
- seções totalizadas;
- posição;
- diferença entre candidatos;
- distribuição geográfica.

---

# 18. Mapa eleitoral

Usar MapLibre.

Funcionalidades:

- mapa por UF;
- mapa por município;
- votação absoluta;
- percentual;
- posição;
- candidato selecionado;
- partido;
- comparação entre candidatos.

O mapa deve ser uma camada de análise, não uma fonte independente do resultado.

---

# 19. Página do candidato

URL:

```text
/candidato/:id
```

Conteúdo:

```text
Nome
Nome de urna
Número
Partido
Federação
Cargo
UF

Votos
Percentual
Posição

Evolução

Distribuição geográfica

Resultados por município

Resultados por seção, quando aplicável

Histórico eleitoral
```

---

# 20. Página de município

URL:

```text
/municipio/:ibge
```

Mostrar:

- eleitorado;
- comparecimento;
- abstenção;
- votos válidos;
- brancos;
- nulos;
- resultados por cargo;
- candidatos mais votados;
- seções totalizadas;
- mapa.

---

# 21. Página de partido

URL:

```text
/partido/:id
```

Mostrar:

- candidatos;
- votação;
- votação de legenda;
- cadeiras;
- distribuição estadual;
- federação;
- comparação histórica.

---

# 22. Histórico

A arquitetura deve permitir:

```text
2026
2024
2022
2020
2018
...
```

Exemplo:

```text
Candidato X

2026 → resultado
2022 → resultado
2018 → resultado
```

A camada histórica deve usar dados oficiais do TSE.

---

# 23. Boletim de Urna

Criar:

```text
CONFIRA A URNA
```

Filtros:

```text
UF
Município
Zona
Seção
```

Mostrar:

- boletim;
- votos por cargo;
- votos por candidato;
- informações da seção;
- fonte;
- arquivo de origem.

O objetivo é permitir conferência do resultado.

---

# 24. Tempo real

Não permitir que cada navegador consulte o TSE.

Arquitetura:

```text
TSE
 ↓
Ingestor
 ↓
Processamento
 ↓
Banco
 ↓
Redis
 ↓
SSE
 ↓
Todos os usuários
```

## SSE

Endpoint:

```http
GET /api/v1/live
```

Exemplo:

```json
{
  "type": "result_update",
  "office": "governor",
  "state": "SP",
  "timestamp": "2026-10-04T18:42:31-03:00",
  "totalized": 74.31
}
```

---

# 25. Estratégia de ingestão

```text
TSE
 ↓
Downloader
 ↓
Checksum
 ↓
Raw Storage
 ↓
Parser
 ↓
Validator
 ↓
Normalizer
 ↓
PostgreSQL
 ↓
Aggregator
 ↓
Redis
 ↓
API
```

Cada arquivo deve possuir:

```text
source
filename
downloaded_at
file_hash
version
status
processed_at
```

---

# 26. Arquivos de acompanhamento

A arquitetura deve considerar os arquivos técnicos de acompanhamento disponibilizados pelo TSE, como:

- EA10;
- EA11;
- EA12;
- EA14;
- EA15;
- EA16;
- EA18;
- EA20.

O código de ingestão deve seguir a documentação técnica oficial de 2026 e não depender de scraping da interface visual do TSE.

---

# 27. Controle de atualizações

O sistema deve detectar alterações de dados sem baixar indiscriminadamente tudo.

Fluxo:

```text
arquivo de acompanhamento
        ↓
identifica mudança
        ↓
baixa conteúdo necessário
        ↓
valida
        ↓
processa
```

O TSE estabelece limites técnicos de consumo. O sistema deve respeitar esses limites.

---

# 28. Cache

Redis:

```text
result:2026:president:BR
result:2026:governor:SP
result:2026:senator:SP
result:2026:federal-deputy:SP
```

Objetivos:

- reduzir carga do banco;
- acelerar respostas;
- suportar picos;
- disponibilizar ranking rapidamente.

---

# 29. CDN e proteção

Arquitetura:

```text
Usuários
 ↓
Cloudflare
 ↓
CDN / Cache
 ↓
API
 ↓
Redis
 ↓
PostgreSQL
```

Recursos:

- HTTPS;
- WAF;
- rate limiting;
- cache;
- proteção contra tráfego abusivo.

---

# 30. Contingência

## Nível 1

TSE funcionando:

```text
TSE → plataforma
```

## Nível 2

TSE instável:

```text
último dado válido
```

Exibir:

> Última atualização oficial recebida às HH:MM:SS.

## Nível 3

TSE indisponível:

Manter a plataforma online, mas deixar claro:

> Dados temporariamente indisponíveis. Última atualização oficial recebida às HH:MM:SS.

Nunca apresentar dado antigo como se fosse atual.

---

# 31. Auditoria

Criar:

```text
ingestion_runs
ingestion_errors
audit_events
source_files
source_versions
```

Exemplo:

```text
18:40:01
EA15 SP
download OK
hash: XXXXX

18:40:03
EA20 SP
download OK
hash: XXXXX

18:40:04
processamento OK

18:40:05
API atualizada
```

Em erro:

```text
18:41:03
TSE timeout

18:41:05
retry 1

18:41:10
retry 2

18:41:16
sucesso
```

---

# 32. API de saúde

```http
GET /api/v1/health
GET /api/v1/status
GET /api/v1/ingestion/status
```

Exemplo:

```json
{
  "status": "operational",
  "tse": "online",
  "lastUpdate": "18:43:12",
  "database": "online",
  "redis": "online",
  "ingestion": "running"
}
```

---

# 33. Transparência

Criar página:

```text
/como-funciona
```

Informar:

- fonte dos dados;
- horário da última atualização;
- método de atualização;
- processamento;
- significado dos indicadores;
- diferença entre dado oficial e análise;
- limitações;
- política de correção.

Texto conceitual:

> Os resultados apresentados são baseados em dados disponibilizados pelo Tribunal Superior Eleitoral. A plataforma processa e organiza esses dados para facilitar sua visualização. Indicadores, gráficos, comparações e outras métricas produzidas pela plataforma são análises derivadas dos dados oficiais e não substituem a divulgação oficial do TSE.

---

# 34. Eleito x líder

O sistema deve diferenciar:

```text
LÍDER
```

de:

```text
ELEITO
```

e:

```text
RESULTADO FINAL
```

Não marcar automaticamente um candidato como eleito apenas porque está em primeiro.

Situações jurídicas e técnicas devem seguir a informação oficial disponibilizada pelo TSE.

---

# 35. Segundo turno

Modelo:

```text
round = 1
round = 2
```

Preparar desde o início para:

- Presidente;
- Governador.

A interface deve mudar automaticamente de acordo com a rodada.

---

# 36. Compartilhamento

Cada página deve possuir URL própria.

Exemplos:

```text
/eleicoes/2026/presidente

/eleicoes/2026/governador/sp

/eleicoes/2026/senador/sp

/eleicoes/2026/deputado-federal/sp

/eleicoes/2026/deputado-estadual/sp

/candidato/123456

/municipio/3549904
```

Isso permite:

- compartilhamento;
- SEO;
- links em redes sociais;
- indexação;
- acesso direto.

---

# 37. SEO

Criar páginas relevantes para buscas como:

- Eleições 2026;
- resultado presidente;
- resultado governador SP;
- resultado senador SP;
- resultado deputado federal SP;
- resultado deputado estadual SP;
- votação por município;
- votação por candidato.

Evitar geração indiscriminada de páginas duplicadas.

---

# 38. Mobile First

O sistema deve ser pensado primeiro para celular.

## Mobile

Prioridade:

1. cargo;
2. ranking;
3. votos;
4. percentual;
5. totalização;
6. atualização;
7. gráfico;
8. filtros.

## Desktop

Pode oferecer:

- múltiplos painéis;
- mapas;
- gráficos;
- tabelas;
- comparação.

---

# 39. PWA

Transformar o site em PWA.

Possibilidades:

- instalar na tela inicial;
- carregamento rápido;
- cache de recursos;
- experiência semelhante a aplicativo.

---

# 40. Segurança

Implementar:

- HTTPS;
- WAF;
- rate limiting;
- validação de entrada;
- proteção contra SQL Injection;
- proteção contra XSS;
- headers de segurança;
- secrets fora do código;
- backups;
- logs;
- monitoramento;
- controle de acesso administrativo.

---

# 41. Regra de integridade dos resultados

O frontend nunca deve poder alterar resultados oficiais.

Fluxo permitido:

```text
TSE
 ↓
Ingestor
 ↓
Validação
 ↓
Banco
 ↓
API
 ↓
Frontend
```

Não:

```text
Frontend
 ↓
Banco
```

para alterar votos.

---

# 42. Dados imutáveis

Arquivos originais recebidos do TSE devem ser preservados.

Guardar:

```text
arquivo original
hash
data/hora
fonte
versão
processamento
```

Isso permite reconstruir o resultado em caso de erro.

---

# 43. Sistema de logs

Registrar:

- downloads;
- erros;
- retries;
- arquivos processados;
- alterações;
- tempo de processamento;
- API;
- indisponibilidade;
- eventos administrativos.

---

# 44. Monitoramento

Indicadores:

```text
API latency
TSE latency
ingestion latency
database status
Redis status
CPU
RAM
erros
requisições
usuários
```

Ferramentas possíveis:

- Sentry;
- Grafana;
- Prometheus;
- UptimeRobot ou equivalente.

---

# 45. Escalabilidade

O dia da eleição terá comportamento diferente de um dia normal.

Esperar:

```text
picos enormes de tráfego
```

Arquitetura:

```text
Cloudflare
    ↓
CDN
    ↓
API escalável
    ↓
Redis
    ↓
PostgreSQL
```

O TSE deve ser consultado apenas pelos workers de ingestão, não pelos usuários.

---

# 46. Métricas analíticas

O motor de análise pode calcular:

- votos;
- percentual;
- posição;
- variação de posição;
- diferença absoluta;
- diferença percentual;
- evolução;
- totalização;
- participação;
- abstenção;
- votos válidos;
- brancos;
- nulos;
- distribuição municipal;
- distribuição estadual;
- distribuição partidária.

---

# 47. Limite editorial

A plataforma deve informar fatos e métricas observáveis.

Exemplos adequados:

> Candidato A está em primeiro lugar na totalização atual.

> 82,4% das seções foram totalizadas.

> Candidato B ganhou duas posições desde a última atualização.

Evitar transformar os dados em:

- previsão eleitoral própria;
- probabilidade de vitória;
- recomendação de voto;
- classificação política;
- avaliação de candidato.

A plataforma deve permanecer informativa e politicamente neutra.

---

# 48. MVP

## Fase 1 — Dados

- TSE 2026;
- candidatos;
- partidos;
- federações;
- estados;
- municípios;
- cargos;
- resultados;
- primeiro turno;
- segundo turno preparado.

## Fase 2 — Dashboard

- Presidente;
- Governador;
- Senador;
- Deputado Federal;
- Deputado Estadual;
- ranking;
- votos;
- percentual;
- seções;
- atualização.

## Fase 3 — Tempo real

- ingestão automática;
- Redis;
- SSE;
- cache;
- snapshots.

## Fase 4 — Inteligência

- gráficos;
- mapas;
- municípios;
- candidatos;
- partidos;
- comparação;
- histórico.

## Fase 5 — Auditoria

- Boletim de Urna;
- origem;
- hash;
- horário;
- logs;
- verificação.

---

# 49. Estrutura de pastas sugerida

```text
eleicoes-2026/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   ├── controllers/
│       │   ├── services/
│       │   ├── repositories/
│       │   └── main.ts
│
├── workers/
│   ├── ingestion/
│   ├── parser/
│   ├── validator/
│   ├── aggregator/
│   └── scheduler/
│
├── packages/
│   ├── types/
│   ├── database/
│   ├── election-rules/
│   └── shared/
│
├── infrastructure/
│   ├── docker/
│   ├── postgres/
│   ├── redis/
│   └── cloudflare/
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── data-model.md
│   └── operations.md
│
├── tests/
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# 50. Testes

Testar:

### Unidade

- parser;
- cálculo de percentual;
- ranking;
- variação;
- agregação.

### Integração

- TSE → ingestão;
- ingestão → banco;
- banco → API;
- API → frontend.

### Carga

Simular:

- 1.000 usuários;
- 10.000;
- 50.000;
- 100.000;
- picos simultâneos.

### Testes eleitorais

Utilizar os cenários dos simulados oficiais do TSE, inclusive situações excepcionais.

---

# 51. Backup

PostgreSQL:

- backup automático;
- retenção;
- restauração testada.

Arquivos TSE:

- armazenamento persistente;
- cópia original;
- hash.

---

# 52. Política de atualização

O sistema deve possuir:

```text
última atualização recebida
última atualização processada
última atualização publicada
```

Isso permite identificar gargalos.

Exemplo:

```text
TSE recebeu:       18:42:00
Sistema baixou:    18:42:02
Processou:         18:42:03
Publicou:          18:42:03
```

---

# 53. Painel administrativo

Criar área protegida:

```text
/admin
```

Mostrar:

- status TSE;
- ingestão;
- arquivos;
- erros;
- banco;
- Redis;
- filas;
- usuários;
- tráfego;
- última atualização;
- alertas.

O administrador não deve editar votos manualmente.

---

# 54. Alertas

Alertar quando:

- TSE estiver indisponível;
- ingestão parar;
- arquivo inesperado;
- parser falhar;
- banco estiver próximo do limite;
- Redis falhar;
- latência subir;
- fila crescer;
- atualização ficar muito tempo sem ocorrer.

---

# 55. Modelo operacional no dia da eleição

```text
TSE publica atualização
        ↓
Worker detecta
        ↓
Download
        ↓
Hash
        ↓
Validação
        ↓
Parser
        ↓
Normalização
        ↓
PostgreSQL
        ↓
Agregação
        ↓
Redis
        ↓
SSE
        ↓
Dashboard
        ↓
Eleitor
```

---

# 56. Estratégia de publicação

Antes da eleição:

- infraestrutura pronta;
- domínio;
- SSL;
- CDN;
- banco;
- Redis;
- workers;
- monitoramento;
- testes de carga;
- testes dos arquivos oficiais;
- backup;
- contingência.

No dia:

- ingestão automática;
- monitoramento contínuo;
- equipe acompanhando erros;
- comunicação clara sobre atrasos;
- nenhuma alteração manual de resultados.

---

# 57. Princípios do projeto

1. **TSE como fonte primária.**
2. **Não fazer scraping quando houver distribuição oficial.**
3. **Nunca alterar manualmente votos.**
4. **Preservar os arquivos originais.**
5. **Guardar histórico de atualizações.**
6. **Separar dado oficial de análise própria.**
7. **Mostrar sempre a hora da última atualização.**
8. **Nunca apresentar dado antigo como atual.**
9. **Preparar o sistema para primeiro e segundo turno.**
10. **Preparar a arquitetura para eleições futuras.**
11. **Tratar cargos majoritários e proporcionais de maneira diferente.**
12. **Projetar para picos extremos de acesso.**
13. **Usar cache para proteger banco e API.**
14. **Manter auditoria completa.**
15. **Ser politicamente neutro e factual.**

---

# 58. Evolução futura

Depois de 2026:

```text
Plataforma Eleitoral
        │
        ├── Eleições 2026
        ├── Histórico
        ├── Eleições 2028
        ├── Eleições 2030
        └── Eleições futuras
```

Possíveis recursos futuros:

- histórico eleitoral;
- comparação entre eleições;
- mapas históricos;
- perfil eleitoral por município;
- votação por seção;
- análise de participação;
- dados de candidatos;
- prestação de contas;
- bens declarados;
- propostas;
- estatísticas eleitorais.

---

# 59. Posicionamento do produto

Em vez de apresentar como:

> “Site que mostra o resultado das eleições.”

Posicionamento recomendado:

> **Plataforma independente de acompanhamento e análise de dados oficiais das eleições brasileiras.**

Proposta de valor:

> **Dados oficiais, atualização em tempo real e informação eleitoral organizada para que o eleitor acompanhe a apuração de forma simples, transparente e verificável.**

---

# 60. Resultado esperado

O produto final deverá permitir que um eleitor entre no site e, em poucos segundos, descubra:

- o que está sendo apurado;
- quanto já foi totalizado;
- quem está em cada posição;
- quantos votos cada candidato possui;
- percentual;
- evolução;
- situação das vagas;
- distribuição geográfica;
- município;
- partido/federação;
- resultado por seção;
- fonte;
- horário da atualização.

A plataforma deve continuar útil depois da apuração, funcionando como base histórica eleitoral.

---

# 61. Roadmap recomendado

## Sprint 1

- repositório;
- monorepo;
- Docker;
- PostgreSQL;
- Redis;
- Next.js;
- NestJS;
- CI/CD.

## Sprint 2

- modelo de dados;
- candidatos;
- partidos;
- estados;
- municípios;
- cargos.

## Sprint 3

- integração TSE;
- downloader;
- armazenamento dos arquivos;
- parser.

## Sprint 4

- validação;
- normalização;
- agregação;
- resultados.

## Sprint 5

- API;
- ranking;
- filtros;
- cache.

## Sprint 6

- dashboard;
- gráficos;
- atualização em tempo real.

## Sprint 7

- mapas;
- candidato;
- município;
- partido.

## Sprint 8

- Boletim de Urna;
- auditoria;
- histórico;
- transparência.

## Sprint 9

- testes de carga;
- contingência;
- monitoramento.

## Sprint 10

- simulação completa da eleição;
- correção de falhas;
- preparação para produção.

---

# 62. Fontes oficiais

- TSE — Divulgação de Resultados:
  https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados

- TSE — Resultados:
  https://resultados.tse.jus.br/

- TSE — Dados Abertos:
  https://dadosabertos.tse.jus.br/

- IBGE:
  https://www.ibge.gov.br/

---

# 63. Próxima etapa técnica

A partir deste documento, a próxima etapa recomendada é transformar a especificação em implementação:

1. criar o repositório;
2. criar o monorepo;
3. configurar PostgreSQL;
4. criar o schema;
5. configurar Redis;
6. implementar o módulo de ingestão TSE;
7. baixar e validar os primeiros arquivos de 2026;
8. implementar o parser;
9. construir a API;
10. construir o dashboard;
11. implementar SSE;
12. criar testes com dados reais/simulados;
13. executar teste de carga;
14. colocar a infraestrutura em produção.

**O objetivo é chegar ao dia da eleição com o sistema já testado, monitorado e capaz de continuar funcionando mesmo quando houver picos muito elevados de acesso.**
