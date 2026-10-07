# Resumo do projeto: Apuração Eleições 2026 em tempo real

**Repositório:** https://github.com/marcal1981/apuracao-eleicoes-2026 (público, branch `main`)

Plataforma independente para acompanhar a apuração das Eleições 2026 a partir dos **dados oficiais do TSE**, com atualização em tempo real. Foi construída a partir da especificação original, que está em [`docs/especificacao.md`](especificacao.md).

---

## 1. O que foi construído

### Busca dos dados do TSE (ingestão)
- **Só o servidor consulta o TSE.** Os navegadores dos eleitores acessam apenas a API própria da plataforma.
- Consulta periódica, a cada 30 s por padrão (configurável). Usa *ETag/If-Modified-Since* para não baixar de novo o que não mudou.
- Em caso de falha, faz até 3 novas tentativas, com espera crescente (1 s, 2 s, 4 s). Limita o número de downloads simultâneos e tem tempo-limite por requisição.
- Descobre automaticamente o **código da eleição** no arquivo de configuração oficial do TSE. Também é possível informar o código manualmente.
- Rejeita arquivos com horário mais antigo do que o já publicado.

### Integridade e auditoria
- Cada arquivo recebido do TSE é **guardado na forma original**, com impressão digital **SHA-256** e horário de recebimento, e nunca é sobrescrito.
- **Histórico de snapshots** de cada atualização: guardado para auditoria.
- **Trilha de auditoria** com downloads, erros, novas tentativas e publicações.
- Ao reiniciar, o sistema recarrega o último resultado e o histórico do disco.
- **Nenhum voto pode ser editado manualmente.**

### Tempo real
- Canal **SSE** (`/api/v1/live`): as páginas abertas são avisadas quando chega dado novo e se atualizam sozinhas.
- Se a conexão em tempo real cair, a página passa a consultar a API a cada 30 s.

### Telas (pensadas primeiro para o celular)
| Página | Conteúdo |
|---|---|
| `/` | Presidente (Brasil) e grade de Governador por estado |
| `/eleicoes/2026/presidente` | Presidente nacional; `/presidente/sp` mostra o resultado por UF |
| `/eleicoes/2026/governador/sp` | Governador por UF |
| `/eleicoes/2026/senador/sp` | Senador, com linha de corte das **2 vagas** |
| `/eleicoes/2026/deputado-federal/sp` | Deputados federais |
| `/eleicoes/2026/deputado-estadual/sp` | Deputados estaduais (o DF vai para `deputado-distrital/df`) |
| `/como-funciona` | Transparência: fonte, método, limitações e política de correção |
| `/status` | Situação da ingestão e log de auditoria ao vivo |

**Em cada disputa:**
- **Indicadores:** seções totalizadas (com barra de progresso), comparecimento, abstenção, votos válidos, brancos, nulos e eleitorado.
- **Ranking:** posição, votos, %, subida/descida de posição (↑ ↓) e diferença para o candidato anterior.
- **Origem dos dados:** arquivo oficial, hash e horários de recebimento e publicação.

**Regras de neutralidade e correção:**
- **Líder ≠ Eleito.** "Eleito" e "2º turno" só aparecem quando o TSE informa oficialmente.
- **Deputados:** a ordem por votos **não** define os eleitos. Cadeiras por partido/federação e lista de eleitos seguem apenas a situação oficial. A tela tem busca e filtro "somente eleitos".
- **Contingência:** se o TSE ficar instável, a página mantém o último dado oficial e avisa: *"Dados temporariamente sem atualização. Última atualização oficial recebida às HH:MM:SS"*.

### Projeção de eleitos (Deputados)
- Com os votos apurados até o momento, a plataforma calcula a distribuição de cadeiras pelas regras do Código Eleitoral:
  1. quociente eleitoral;
  2. quociente partidário, com mínimo de 10% do QE por candidato;
  3. sobras pelas maiores médias, exigindo 80% do QE do partido e 20% do QE do candidato;
  4. vagas restantes pelas maiores médias, sem exigências.
- Federações contam como um único partido. Votos de legenda são somados quando o arquivo do TSE os informa.
- Os eleitos projetados aparecem **em verde abaixo do nome**: "Eleito por QP — projeção" ou "Eleito por média — projeção".
- Quando o TSE divulga a situação oficial, a projeção some e passa a valer "✔ Eleito (oficial TSE)".
- Vagas: Câmara com 513 deputados (SP = 70) e assembleias pelo art. 27 da Constituição (SP = 94). O número de vagas do arquivo do TSE tem prioridade quando é plausível.

### Votos por cidade dos candidatos em destaque
- No cartão de cada candidato em destaque (Deputados de SP), o botão **"Votos por cidade"** abre:
  - um mapa de SP colorido pela votação dele;
  - a lista das 645 cidades, com votos e % dos válidos, e busca;
  - o botão **Planilha**, que baixa um CSV que abre no Excel.
- O servidor baixa o arquivo municipal do cargo de cada cidade (`…/dados/sp/sp{codigo}-c0007-e006259-u.json` para Estadual) só para disputas com candidatos em destaque, a cada 3 minutos (`CANDIDATE_CITIES_POLL_MS`), com ETag para não repetir downloads.
- API: `GET /api/v1/states/sp/candidate-cities?office=deputado-estadual`.

### Página "Arquivos" (menu do topo)
- Planilhas (CSV para Excel):
  - resultado de qualquer cargo e UF (também pelo botão **"Baixar planilha"** em cada disputa);
  - votos por cidade dos candidatos em destaque;
  - andamento da apuração por município de SP;
  - registro de auditoria.
- **Arquivos originais do TSE** guardados pela plataforma: abrir no navegador, baixar e ver cada versão recebida, com horário e SHA-256.

### API própria (`/api/v1`)
| Rota | Descrição |
|---|---|
| `GET /results?office=senador&state=SP&round=1` | Resultado atual de uma disputa |
| `GET /results/history?office=…&state=…` | Histórico de snapshots |
| `GET /races?office=governador` | Resumo de todas as disputas |
| `GET /offices` | Cargos e UFs |
| `GET /live` | Eventos em tempo real (SSE) |
| `GET /health` e `GET /status` | Saúde do sistema, ingestão e auditoria |

As respostas têm cache curto para CDN (`s-maxage`), o que protege o servidor nos picos de acesso.

### Modo simulação
- `npm run dev:mock` gera uma apuração **fictícia** (Candidato A, B, C…), que avança de 0% a 100% em 30 min (configurável).
- Uma faixa amarela no topo avisa que é simulação.
- Serve para testar telas, tempo real e carga sem depender do TSE.

### Outros
- PWA (pode ser instalado na tela inicial do celular).
- Cabeçalhos de segurança (nosniff, frame-deny, referrer-policy, permissions-policy).
- Dockerfile e `docker-compose.yml`, com os dados em volume persistente.
- CI no GitHub Actions: testes, checagem de tipos e build a cada push.
- 13 testes automatizados cobrindo parser do TSE, números e datas, ranking, variação, descoberta da eleição, cargos por UF e simulação.

---

## 2. Tecnologias

- **Next.js 16 + React 19 + TypeScript**: páginas, API e SSE num único serviço.
- **Tailwind CSS 4**: visual com tema claro e escuro automático.
- **Vitest**: testes.
- **Monorepo npm workspaces**: `apps/web` e `packages/core`.

---

## 3. Estrutura de pastas

```
apuracao-eleicoes-2026/
├── apps/web/                 Site + API + tempo real
│   ├── app/                  Páginas e rotas /api/v1
│   ├── components/           Ranking, deputados, destaques, votos por cidade
│   ├── lib/server/           Ingestor do TSE, configuração, arquivamento
│   └── instrumentation.ts    Liga a ingestão quando o servidor sobe
├── packages/core/            Regras de domínio (sem dependência do site)
│   ├── src/domain.ts         Cargos, códigos do TSE, UFs
│   ├── src/tse.ts            URLs, parser e validação dos arquivos do TSE
│   ├── src/simulation.ts     Gerador da apuração simulada
│   └── test/                 Testes
├── docs/
│   ├── especificacao.md      Sua especificação original
│   ├── arquitetura.md        Decisões do MVP e próximos passos
│   └── RESUMO.md             Este arquivo
├── .env.example              Todas as configurações explicadas
├── Dockerfile / docker-compose.yml
└── .github/workflows/ci.yml
```

---

## 4. Como rodar no Windows (cmd)

**Pré-requisitos** (instalar uma vez): [Git](https://git-scm.com/download/win) e [Node.js 22 LTS](https://nodejs.org).

**Primeira vez:**
```cmd
mkdir C:\Users\Windows\projetos
cd C:\Users\Windows\projetos
git clone https://github.com/marcal1981/apuracao-eleicoes-2026.git
cd apuracao-eleicoes-2026
npm install
npm run dev:mock
```
Depois abra **http://localhost:3000** no navegador.

**Nas próximas vezes:**
```cmd
cd C:\Users\Windows\projetos\apuracao-eleicoes-2026
git pull
npm run dev:mock
```

| Comando | Para quê |
|---|---|
| `npm run dev:mock` | Rodar com dados simulados |
| `npm run dev` | Rodar com dados reais do TSE |
| `npm test` | Rodar os testes |
| `npm run build` e depois `npm start` | Versão de produção |

> Os comandos `npm` precisam ser executados **dentro da pasta do projeto**, onde fica o `package.json`.

---

## 5. Configuração (arquivo `.env`)

Copie `.env.example` para `.env` e ajuste. As principais variáveis:

| Variável | Padrão | Para quê |
|---|---|---|
| `TSE_SOURCE` | `tse` | `mock` liga a simulação |
| `TSE_BASE_URL` | `https://resultados.tse.jus.br/oficial` | Endereço dos arquivos do TSE |
| `TSE_CYCLE` | `ele2026` | Ciclo eleitoral |
| `TSE_ELECTION_FEDERAL` | `6257` (2º turno: `6258`) | Eleição federal: Presidente |
| `TSE_ELECTION_STATE` | `6259` (2º turno: `6260`) | Eleição estadual: Governador, Senador, Deputados |
| `TSE_ROUND` | `1` | Turno acompanhado (`2` no segundo turno) |
| `POLL_INTERVAL_MS` | `30000` | Intervalo entre consultas ao TSE |
| `TRACK_OFFICES` | todos | Limitar cargos (ex.: `presidente,governador`) |
| `DATA_DIR` | `data` | Onde ficam arquivos originais, histórico e auditoria |

---

## 6. Diferenças em relação à especificação original

Para colocar no ar rapidamente, o MVP simplificou a infraestrutura **sem abrir mão dos princípios**: TSE como fonte única, arquivos preservados, histórico e auditoria.

| Especificação | MVP atual |
|---|---|
| NestJS + workers separados | Um único serviço Next.js com o ingestor embutido |
| PostgreSQL | Arquivos JSON/NDJSON em disco |
| Redis | Memória do processo + cache de CDN |
| Cálculo próprio de eleitos | Apenas a situação oficial do TSE |

**Atenção:** rode **uma única instância** em Docker, VPS, Railway ou Fly. A Vercel e outras plataformas serverless não servem, porque o ingestor precisa ficar rodando o tempo todo.

---

## 7. Pendências importantes

1. **Validar com os arquivos reais do TSE de 2026.** O leitor segue o formato de 2026 (eleições 6257 federal e 6259 estadual, arquivos `/dados/…-u.json`), levantado a partir de projetos públicos que já consomem esses dados, mas o acesso ao site do TSE estava bloqueado no ambiente de desenvolvimento. Confira na [documentação técnica oficial](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados) e acompanhe a página `/status` ao subir com `TSE_SOURCE=tse`.
2. Se os arquivos não forem encontrados (veja "Arquivos ainda não publicados" em `/status`), ajuste os códigos/caminho no `.env`.

---

## 8. Próximos passos sugeridos

1. Validar com os arquivos oficiais/simulados do TSE de 2026.
2. Separar o ingestor em um worker e usar Redis pub/sub, para escalar o tempo real.
3. PostgreSQL (Prisma), com o modelo de dados da especificação.
4. Resultados por município e mapas (MapLibre).
5. Páginas de candidato e de partido, e histórico de eleições anteriores.
6. "Confira a urna" (Boletim de Urna), painel `/admin` e alertas.
7. Testes de carga e monitoramento (Sentry, uptime).

---

## Atualização: simplificação (05/10)
- Removidos os mapas de apuração (Brasil por estado e SP por município) e os gráficos de evolução.
- O sistema deixou de baixar 645 arquivos de cidade por minuto só para os mapas. A lista de municípios do TSE agora é lida uma única vez.
- A biblioteca de gráficos (Recharts) foi retirada, e as páginas não buscam mais o histórico a cada atualização.
- Continuam: resultados por cargo/UF, destaques, projeção de eleitos, votos por cidade dos destaques (com o mapa de votos do candidato), planilhas e arquivos.

## Aba "Abstenção SP"
- Menu do topo → **Abstenção SP** (`/abstencao`): eleitorado, comparecimento, abstenções e % de abstenção de cada um dos 645 municípios, com totais do estado, busca, ordenação e planilha.
- Fonte: arquivo municipal de Governador de cada cidade (o comparecimento é o mesmo para todos os cargos). Consulta a cada 3 minutos (`ABSTENTION_POLL_MS`), com ETag e memória em disco.
- API: `GET /api/v1/states/sp/abstention`. Planilha: `/api/v1/export/abstention?uf=sp` (também na página Arquivos).

## Aba "Abstenção Vale"

Página `/abstencao/vale-do-paraiba`: abstenção nas **39 cidades da Região Metropolitana do Vale do Paraíba e Litoral Norte**, agrupadas nas 5 sub-regiões (São José dos Campos, Taubaté, Guaratinguetá, Cruzeiro e Litoral Norte).

- Totais da região (eleitorado, comparecimento, abstenção e %).
- Tabela por sub-região — clique numa linha para filtrar as cidades dela.
- Lista das cidades com a sub-região de cada uma, ordenável e com busca.
- Planilha da região: `/api/v1/export/abstention?uf=sp&regiao=vale-do-paraiba` (também na página **Arquivos**).
- A lista de cidades da região fica em `apps/web/lib/regions.ts` (fácil de incluir outras regiões).

## Aba "Abstenção SJC" (mapa por zona eleitoral)

Página `/abstencao/sao-jose-dos-campos`: **mapa de São José dos Campos com a abstenção de cada zona eleitoral**.

- **Números:** soma dos **boletins de urna** de todas as seções de cada zona (`arquivo-urna` do TSE: arquivo auxiliar + imagem do boletim `.imgbu`, com eleitores aptos, comparecimento e faltosos). A leitura começa quando a página é aberta pela primeira vez (cerca de 1.400 seções, alguns minutos) e fica guardada em `data/cities/secoes-sao-jose-dos-campos.json`.
- **Mapa:** ruas do OpenStreetMap (biblioteca Leaflet) e contorno do município (IBGE, `public/maps/sao-jose-dos-campos.json`). A Justiça Eleitoral não publica o desenho das zonas: a área de cada zona é traçada ligando os **locais de votação** dela, com as coordenadas do cadastro oficial do TSE (`eleitorado_local_votacao_<ano>.zip`, Portal de Dados Abertos). O arquivo é nacional e grande: é baixado **uma vez**, filtrado para a cidade (`data/cities/locais-sao-jose-dos-campos.json`) e apagado. Se não houver o de 2026, usa o de 2024. Sem acesso ao TSE, coloque o .zip em `data/locais/`.
- Cor da zona: da menor abstenção (amarelo) à maior (vermelho escuro). Clique numa zona (no mapa ou na tabela) para ver os números dela e os locais de votação com mais abstenção.
- Planilhas: por zona `/api/v1/export/sections?cidade=sao-jose-dos-campos&agrupar=zona` e por seção `/api/v1/export/sections?cidade=sao-jose-dos-campos` (também na página **Arquivos**).
- No fim da página, "Detalhes dos arquivos do TSE (diagnóstico)" mostra o que veio do TSE, caso o formato mude.

## PDF da votação por município

No painel "Votos por cidade" de cada candidato em destaque há o botão **PDF**: gera um documento A4 com os municípios onde o candidato teve votos (ordem decrescente; `&todas=1` inclui os sem votos), votos, % dos válidos no município e % do total do candidato, com resumo na primeira página, total no fim e numeração de páginas. Endereço direto: `/api/v1/export/candidate-cities-pdf?uf=sp&office=deputado-federal&numero=<número>` (ou `&nome=ROBERTINHO`).

## Aba "Votos por distrito"

Página `/votos-por-distrito`: votos de um candidato em destaque numa área da cidade.

- **São Paulo:** escolha um dos 96 distritos oficiais (contorno da Prefeitura — GeoSampa, em `public/maps/sao-paulo-distritos.json`). Entram as seções dos locais de votação cuja localização (cadastro de locais do TSE) fica dentro do distrito.
- **Outras cidades:** busca pelo nome do bairro (ou parte dele) no cadastro de locais.
- Os votos vêm do **boletim de urna** de cada seção (número do candidato no boletim). Mostra total, % de quem votou na área, e a lista de locais de votação com seções e votos.
- Resultado guardado em `data/cities/area-votos-*.json`; o cadastro nacional de locais fica em `data/downloads` para servir a qualquer cidade sem baixar de novo.
- API: `/api/v1/votos-por-area?uf=sp&cidade=São Paulo&distrito=CIDADE TIRADENTES&numero=2533` (ou `&bairro=` para outras cidades).

## Aba "Votos por bairro SJC"

Página `/votos-por-bairro`: votos dos **candidatos em destaque** em São José dos Campos, somados **por bairro**.

- Ao ler o boletim de urna de cada seção (o mesmo usado na Abstenção SJC), o sistema guarda também os votos de cada candidato em destaque. O bairro vem do local de votação no cadastro oficial do TSE.
- Escolha um candidato (ou "Comparar todos"): resumo (votos na cidade, bairros com votos, bairro com mais votos), **mapa** com um círculo por local de votação (maior = mais votos) e **tabela por bairro** com votos, % de quem votou no bairro e % do total do candidato. Clique num bairro para ver as escolas e destacá-las no mapa.
- "Baixar planilha": bairros × candidatos em destaque.
- Se a lista de destaques mudar, as seções são relidas automaticamente.
- Botão **PDF** na aba: com um candidato selecionado, relatório com o ranking dos bairros (votos, % no bairro, % do total) e, na segunda parte, os locais de votação de cada bairro; em "Comparar todos", tabela de bairros × candidatos em página deitada. Endereço: `/api/v1/export/bairros-pdf?cidade=sao-jose-dos-campos&numero=2533` (ou `numero=todos`).
