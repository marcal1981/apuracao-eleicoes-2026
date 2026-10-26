import type { Metadata } from "next";
import { BairroSecondRoundView } from "@/components/bairro-second-round-view";

export const metadata: Metadata = { title: "Presidente por bairro — 2º turno × 1º turno — São José dos Campos" };

export default function SegundoTurnoBairrosPage() {
  return <BairroSecondRoundView slug="sao-jose-dos-campos" />;
}
