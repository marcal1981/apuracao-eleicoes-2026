import type { Metadata } from "next";
import { CitySecondRoundView } from "@/components/city-second-round-view";

export const metadata: Metadata = { title: "2º turno na cidade — comparação com o 1º turno" };

export default function CidadeSegundoTurnoPage() {
  return <CitySecondRoundView />;
}
