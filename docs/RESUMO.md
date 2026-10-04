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
- **Histórico de snapshots** de cada atualização: é ele que alimenta o gráfico de evolução e a variação de posição.
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
- **Gráfico** da evolução do percentual dos 5 primeiros colocados.
- **Origem dos dados:** arquivo oficial, hash e horários de recebimento e publicação.

**Regras de neutralidade e correção:**
- **Líder ≠ Eleito.** "Eleito" e "2º turno" só aparecem quando o TSE informa oficialmente.
- **Deputados:** a ordem por votos **não** define os eleitos. Cadeiras por partido/federação e lista de eleitos seguem apenas a situação oficial. A tela tem busca e filtro "somente eleitos".
- O gráfico usa uma paleta neutra, sem cores de partidos.
- **Contingência:** se o TSE ficar instável, a página mantém o último dado oficial e avisa: *"Dados temporariamente sem atualização. Última atualização oficial recebida às HH:MM:SS"*.

### Mapas da apuração
- **Mapa do Brasil** (página inicial, Presidente e escolha de estado): cada UF é pintada pelo percentual de seções totalizadas do cargo escolhido. Clicar num estado abre os resultados dele.
- **Mapa municipal de SP** (páginas de Governador, Senador, Dep. Federal e Dep. Estadual de SP): os 645 municípios coloridos pelo andamento da totalização, com busca por município, zoom e contagem de concluídos, em apuração e aguardando.
  - A urna é totalizada com todos os cargos de uma vez, então o sistema lê o arquivo municipal de Governador (o menor) e o mesmo andamento vale para Senador e Deputados.
  - Lista de municípios do TSE: `…/6259/config/mun-e006259-cm.json`. Arquivo de cada cidade: `…/dados/sp/sp{codigo}-c0003-e006259-u.json`. Atualização a cada 60 s (`MUNICIPAL_POLL_MS`).
  - Desenho das cidades: malha do IBGE (CC0), gerada com `node scripts/build-municipal-map.mjs sp`. Para outra UF, gere o arquivo e inclua a sigla em `MUNICIPAL_UFS` (ex.: `sp,rj`).

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

### API própria (`/api/v1`)
| Rota | Descrição |
|---|---|
| `GET /results?office=senador&state=SP&round=1` | Resultado atual de uma disputa |
| `GET /results/history?office=…&state=…` | Histórico de snapshots |
| `GET /races?office=governador` | Resumo de todas as disputas |
| `GET /offices` | Cargos e UFs |
| `GET /live` | Eventos em tempo real (SSE) |
| `GET /states/sp/municipalities` | Andamento da totalização por município |
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
- **Recharts**: gráfico de evolução.
- **Vitest**: testes.
- **Monorepo npm workspaces**: `apps/web` e `packages/core`.

---

## 3. Estrutura de pastas

```
apuracao-eleicoes-2026/
├── apps/web/                 Site + API + tempo real
│   ├── app/                  Páginas e rotas /api/v1
│   ├── components/           Ranking, deputados, gráfico, indicadores
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
