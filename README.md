# Apuração Eleições 2026 em tempo real

Plataforma independente de acompanhamento e análise dos **dados oficiais** da apuração das Eleições 2026: Presidente, Governador, Senador, Deputado Federal e Deputado Estadual/Distrital, com ranking, evolução da apuração e atualização em tempo real.

> Os resultados são baseados nos dados do Tribunal Superior Eleitoral (TSE). Gráficos, variações e comparações são análises derivadas e não substituem a divulgação oficial em [resultados.tse.jus.br](https://resultados.tse.jus.br/).

## O que já funciona (MVP)

- **Ingestão do TSE**: só o servidor consulta o TSE, nunca o navegador. Usa ETag/If-Modified-Since, faz novas tentativas com espera crescente, limita a concorrência e descobre o código da eleição pelo arquivo de configuração oficial.
- **Preservação dos arquivos originais**, com SHA-256 e horário de recebimento. O sistema guarda o histórico de snapshots (nada é sobrescrito) e uma trilha de auditoria.
- **Tempo real via SSE** (`/api/v1/live`). As páginas se atualizam sozinhas e, se a conexão cair, consultam a API periodicamente.
- **Painéis por cargo e UF**, pensados primeiro para o celular:
  - Indicadores: seções totalizadas, comparecimento, abstenção, válidos, brancos e nulos.
  - Ranking com variação de posição e diferença para o candidato anterior.
  - Linha de corte das vagas (2 no Senado).
  - Diferença entre **Líder** e **Eleito**: "eleito" só aparece quando o TSE informa.
  - Deputados: busca, filtro de eleitos e cadeiras por partido/federação, conforme a situação oficial.
- **Contingência**: se o TSE parar de responder, o sistema mantém o último dado oficial e avisa que está desatualizado.
- **Transparência**: páginas `/como-funciona` e `/status`, com o status da ingestão e o log de auditoria.
- **Modo simulação** (`TSE_SOURCE=mock`): candidatos fictícios, para desenvolvimento, testes e ensaio de carga.
- PWA (manifest), cabeçalhos de segurança, Docker e CI.

## Rodando

```bash
npm install
npm run dev:mock     # simulação em http://localhost:3000
npm run dev          # dados oficiais do TSE
npm test             # testes do parser, ranking e simulação
```

Produção com Docker (os dados ficam no volume `/data`):

```bash
cp .env.example .env   # ajuste se necessário
docker compose up -d --build
```

### Configuração para o dia da eleição

Todas as variáveis estão em [`.env.example`](.env.example). As mais importantes:

| Variável | Padrão | Observação |
|---|---|---|
| `TSE_SOURCE` | `tse` | `mock` para simulação |
| `TSE_BASE_URL` / `TSE_CYCLE` | `https://resultados.tse.jus.br/oficial` / `ele2026` | Conferir na documentação técnica oficial de 2026 |
| `TSE_ELECTION_FEDERAL` / `TSE_ELECTION_STATE` | `6257` / `6259` | Presidente / demais cargos (2º turno: `6258` / `6260`) |
| `TSE_ROUND` | `1` | Use `2` no segundo turno |
| `POLL_INTERVAL_MS` | `30000` | Respeite os limites de consumo do TSE |

> ⚠️ **Antes de usar com dados reais:** o leitor aceita o formato de 2026 (`/dados/…-u.json`, candidatos em `carg → agr → par → cand`) e o de 2022. Valide contra a [documentação técnica de 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados) e acompanhe a página `/status` após subir o sistema.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/results?office=senador&state=SP&round=1` | Resultado atual de uma disputa |
| GET | `/api/v1/results/history?office=…&state=…` | Snapshots da apuração |
| GET | `/api/v1/races?office=governador` | Resumo de todas as disputas |
| GET | `/api/v1/offices` | Cargos e UFs |
| GET | `/api/v1/states/sp/candidate-cities?office=…` | Votos por cidade dos candidatos em destaque |
| GET | `/api/v1/live` | SSE com `result_update` e `status` |
| GET | `/api/v1/health`, `/api/v1/status` | Saúde, ingestão e auditoria |

Valores de `office`: `presidente`, `governador`, `senador`, `deputado-federal`, `deputado-estadual` e `deputado-distrital`.

## Estrutura

```
apps/web/          Next.js: páginas, API v1, SSE e ingestor (lib/server)
packages/core/     Domínio: cargos, UFs, parser do TSE, ranking, simulação (+ testes)
docs/              Especificação completa e notas de arquitetura
```

Resumo completo do que foi construído: [docs/RESUMO.md](docs/RESUMO.md). Veja também [docs/arquitetura.md](docs/arquitetura.md) para as decisões do MVP e o caminho até a arquitetura completa descrita em [docs/especificacao.md](docs/especificacao.md).

## Princípios

TSE como fonte primária · nenhum voto é editado manualmente · arquivos originais preservados · histórico completo · dado oficial separado da análise · horário da última atualização sempre visível · dado antigo nunca aparece como atual · neutralidade política.
