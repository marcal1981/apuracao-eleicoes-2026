# Arquitetura: MVP e evolução

A [especificação](especificacao.md) descreve a plataforma completa: NestJS, PostgreSQL, Redis, workers separados, mapas e Boletim de Urna. O MVP entrega o núcleo dessa arquitetura em um único serviço Node, para poder ser colocado no ar rapidamente sem abrir mão dos princípios: TSE como fonte única, arquivos originais preservados, histórico e auditoria.

## Fluxo atual

```
TSE (dados simplificados JSON)
  │  somente o servidor consulta; ETag/If-Modified-Since, novas tentativas, concorrência limitada
  ▼
Ingestor (apps/web/lib/server/ingestor.ts)
  ├─ SHA-256 → arquivo original salvo em data/raw/ (nunca sobrescrito)
  ├─ parser + validação (packages/core/src/tse.ts)
  ├─ normalização + ranking com a posição anterior
  ├─ snapshot → data/snapshots/*.ndjson  |  último resultado → data/latest/
  └─ auditoria → data/audit.ndjson
  ▼
Memória do processo ──► API /api/v1 (cache curto para CDN) ──► Next.js (SSR)
                    └─► SSE /api/v1/live ──► navegadores
```

Na reinicialização, o último resultado e o histórico são recarregados do disco. Até chegar dado novo, esse resultado é marcado como `stale`.

## Decisões do MVP

| Especificação | MVP | Motivo |
|---|---|---|
| NestJS + workers separados | Ingestor dentro do processo Next.js (`instrumentation.ts`) | Um único deploy; a separação vem na Fase 3 |
| PostgreSQL | Arquivos NDJSON/JSON em `DATA_DIR` | Sem dependências externas; a interface `Archive` isola a troca |
| Redis | Memória do processo + cache de CDN (`s-maxage`) | Basta para uma instância |
| Eleitos por regra própria | Somente a situação oficial do TSE | Evita marcar eleito por engano (quociente, sobras, sub judice) |

**Limite importante:** com o ingestor no mesmo processo, rode **uma única instância** (Docker/VM/Railway/Fly). Não use plataformas serverless, que encerram o processo entre requisições. Para escalar a leitura, coloque um CDN (por exemplo, Cloudflare) na frente. As respostas da API já trazem `s-maxage` e `stale-while-revalidate`.

## Próximos passos (ordem sugerida)

1. **Validar contra os arquivos oficiais de 2026**: URLs, código da eleição e campos. Usar os simulados do TSE.
2. Separar o ingestor em um worker e publicar via Redis pub/sub. A API e o SSE passam a escalar horizontalmente.
3. PostgreSQL com o modelo de dados da especificação (Prisma) e Object Storage para os arquivos brutos.
4. Resultados por município (arquivos de abrangência municipal) e mapas com MapLibre.
5. Páginas de candidato e partido, e histórico de eleições anteriores (Dados Abertos do TSE).
6. Boletim de Urna ("Confira a urna"), painel `/admin` protegido e alertas.
7. Testes de carga (1k a 100k usuários simultâneos no SSE) e monitoramento (Sentry e uptime).
