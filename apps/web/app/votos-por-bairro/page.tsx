import type { Metadata } from "next";
import { BairroVotesView } from "@/components/bairro-votes-view";

export const metadata: Metadata = { title: "Votos por bairro — São José dos Campos" };

export default function VotosPorBairroPage() {
  return <BairroVotesView slug="sao-jose-dos-campos" />;
}
