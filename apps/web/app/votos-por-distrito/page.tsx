import type { Metadata } from "next";
import { AreaVotesView } from "@/components/area-votes-view";

export const metadata: Metadata = { title: "Votos por distrito ou bairro" };

export default function VotosPorDistritoPage() {
  return <AreaVotesView />;
}
