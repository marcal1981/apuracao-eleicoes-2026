import type { Metadata } from "next";
import { AbstentionView } from "@/components/abstention-view";

export const metadata: Metadata = { title: "Abstenção — Vale do Paraíba e Litoral Norte" };

export default function AbstencaoValePage() {
  return <AbstentionView region="vale-do-paraiba" />;
}
