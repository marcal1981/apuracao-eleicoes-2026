import type { Metadata } from "next";
import { SecondRoundView } from "@/components/second-round-view";

export const metadata: Metadata = { title: "2º turno ao vivo — comparação com o 1º turno" };

export default function SegundoTurnoPage() {
  return <SecondRoundView />;
}
