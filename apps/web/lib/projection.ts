// Projeção do resultado final do 2º turno (Presidente) a partir das UFs, usada ao vivo e na calibração.

/** Uma UF num momento da apuração: 1º turno (final e no mesmo % apurado) e 2º turno até ali. */
export interface UfState {
  uf: string;
  r1: { a: number; b: number; pct: number; valid: number };
  /** 1º turno da UF no mesmo % apurado que o 2º turno tem agora; null sem a evolução guardada. */
  r1SamePoint: { a: number; b: number } | null;
  r2: { a: number; b: number; pct: number };
}

export interface ProjectionParams {
  /** Incerteza de cada UF (pontos de % de A), independente entre UFs. */
  sdUf: number;
  /** Incerteza comum a todas as UFs (pontos de % de A). */
  sdCommon: number;
}

/** Valores usados na aba ao vivo (ajustáveis pela calibração). */
export const DEFAULT_PARAMS: ProjectionParams = { sdUf: 4, sdCommon: 2 };

export interface Projection {
  /** % de A (entre os dois) projetado ao fim da apuração. */
  shareA: number;
  /** desvio estimado da projeção, em pontos de % de A. */
  sd: number;
  /** chance de A terminar à frente (0–1). */
  chanceA: number;
  /** fração dos votos que ainda falta apurar (estimada). */
  remaining: number;
  byUf: Map<string, { shareA: number }>;
}

const shareA = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);

/** Função de distribuição da normal padrão (aproximação de Abramowitz-Stegun). */
export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Projeção do resultado final do Presidente a partir das UFs (inclui o exterior):
 * - votos que faltam em cada UF: estimados pelo ritmo atual (ou pelo 1º turno, no começo da apuração);
 * - como esses votos devem se dividir: o que faltava apurar na própria UF no 1º turno (a partir do mesmo % apurado),
 *   corrigido pelo terreno que cada finalista já ganhou ali; sem essa evolução, o % atual da UF;
 *   UF que ainda não começou: o 1º turno dela mais o terreno médio já observado no país.
 * A chance vem de uma margem de erro que encolhe conforme a apuração avança. É estimativa, não pesquisa.
 */
export function projectFinal(byUf: UfState[], params: ProjectionParams = DEFAULT_PARAMS): Projection | null {
  const started = byUf.filter((u) => u.r2.a + u.r2.b > 0);
  if (started.length === 0) return null;
  // Terreno médio (pontos de % de A) nas UFs já com votos, ponderado pelos votos.
  let sw = 0;
  let sv = 0;
  for (const u of started) {
    const ref = u.r1SamePoint ?? (u.r1.a + u.r1.b > 0 ? u.r1 : null);
    if (!ref) continue;
    const v = u.r2.a + u.r2.b;
    sw += (shareA(u.r2.a, u.r2.b) - shareA(ref.a, ref.b)) * v;
    sv += v;
  }
  const swing = sv > 0 ? sw / sv : 0;

  let totalA = 0;
  let total = 0;
  let remainingVotes = 0;
  let varIndep = 0;
  const parts: { rem: number }[] = [];
  const out = new Map<string, { shareA: number }>();
  for (const u of byUf) {
    const now = u.r2.a + u.r2.b;
    // Votos válidos dos dois esperados ao fim: pelo ritmo atual (com 10% ou mais apurado) ou pelo 1º turno.
    const fromPace = u.r2.pct >= 10 ? now / (u.r2.pct / 100) : 0;
    const fromR1 = u.r1.valid > 0 ? u.r1.valid * 0.97 : u.r1.a + u.r1.b;
    const expected = Math.max(now, fromPace || fromR1);
    if (expected <= 0) continue;
    const rem = u.r2.pct >= 100 ? 0 : Math.max(0, expected - now);
    let restA: number;
    if (now > 0 && u.r1SamePoint && u.r1.a + u.r1.b > u.r1SamePoint.a + u.r1SamePoint.b) {
      const ra = u.r1.a - u.r1SamePoint.a;
      const rb = u.r1.b - u.r1SamePoint.b;
      restA = shareA(ra, rb) + (shareA(u.r2.a, u.r2.b) - shareA(u.r1SamePoint.a, u.r1SamePoint.b));
    } else if (now > 0) {
      restA = shareA(u.r2.a, u.r2.b);
    } else {
      restA = shareA(u.r1.a, u.r1.b) + swing;
    }
    restA = Math.min(100, Math.max(0, restA));
    const finalA = u.r2.a + (rem * restA) / 100;
    out.set(u.uf, { shareA: (finalA / (now + rem)) * 100 });
    totalA += finalA;
    total += now + rem;
    remainingVotes += rem;
    parts.push({ rem });
  }
  if (total <= 0) return null;
  // Incerteza: pontos por UF (independente) + pontos comuns a todas, sobre a fração ainda não apurada.
  for (const p of parts) varIndep += ((p.rem / total) * params.sdUf) ** 2;
  const remaining = remainingVotes / total;
  const sd = Math.sqrt(varIndep + (remaining * params.sdCommon) ** 2);
  const shareAFinal = (totalA / total) * 100;
  const chanceA = sd < 1e-6 ? (shareAFinal >= 50 ? 1 : 0) : normCdf((shareAFinal - 50) / sd);
  return { shareA: shareAFinal, sd, chanceA, remaining, byUf: out };
}
