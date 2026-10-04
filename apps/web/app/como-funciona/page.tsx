import type { Metadata } from "next";

export const metadata: Metadata = { title: "Como funciona" };

export default function ComoFunciona() {
  return (
    <article className="prose-sm max-w-2xl space-y-4 leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight">Como funciona</h1>
      <p>
        Os resultados apresentados são baseados em dados disponibilizados pelo Tribunal Superior Eleitoral (TSE). A
        plataforma processa e organiza esses dados para facilitar sua visualização. Indicadores, gráficos, comparações e
        outras métricas produzidas pela plataforma são análises derivadas dos dados oficiais e não substituem a
        divulgação oficial do TSE.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Fonte e atualização</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Somente o servidor da plataforma consulta os arquivos públicos de divulgação do TSE, em intervalos regulares e respeitando os limites técnicos do Tribunal. Seu navegador consulta apenas a plataforma.</li>
        <li>Cada arquivo recebido é guardado na forma original, com data/hora de recebimento e impressão digital (SHA-256), que aparece em “Origem dos dados” em cada página.</li>
        <li>Toda atualização gera um registro histórico; nada é sobrescrito. É isso que permite o gráfico de evolução e a variação de posição.</li>
        <li>Quando há dados novos, as páginas abertas são avisadas em tempo real e se atualizam sozinhas.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Significado dos indicadores</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Seções totalizadas</strong>: percentual de seções eleitorais já contabilizadas pelo TSE.</li>
        <li><strong>Percentual do candidato</strong>: calculado pelo TSE sobre os votos válidos.</li>
        <li><strong>Variação (↑/↓)</strong>: mudança de posição em relação à atualização anterior recebida.</li>
        <li><strong>Líder</strong>: primeiro colocado na totalização atual. Não significa eleito.</li>
        <li><strong>Eleito / 2º turno</strong>: exibido somente quando o TSE informa essa situação oficialmente.</li>
        <li><strong>Deputados</strong>: a ordem por votos não define quem ocupa as cadeiras (há quociente eleitoral e distribuição das sobras). Os eleitos e a distribuição de cadeiras seguem apenas a situação oficial.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Limitações</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Pode haver alguns segundos de diferença em relação ao portal oficial.</li>
        <li>Se o TSE ficar instável, a plataforma mantém o último dado oficial recebido e avisa o horário em que ele chegou. Dado antigo nunca é apresentado como atual.</li>
        <li>A plataforma não faz previsões, não calcula probabilidade de vitória e não recomenda votos.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Política de correção</h2>
      <p>
        Nenhum voto é editado manualmente. Se o TSE republicar um arquivo corrigido, a correção é aplicada
        automaticamente e fica registrada no histórico. Erros de exibição podem ser relatados no repositório público
        do projeto.
      </p>
    </article>
  );
}
