import type { Metadata } from "next";
import { TransfersView } from "@/components/transfers-view";

export const metadata: Metadata = { title: "Para onde foram os votos — 1º → 2º turno" };

export default function VotosDosDemaisPage() {
  return <TransfersView />;
}
