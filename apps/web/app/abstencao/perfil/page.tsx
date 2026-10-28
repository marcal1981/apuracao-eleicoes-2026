import type { Metadata } from "next";
import { AbstentionProfileView } from "@/components/abstention-profile-view";

export const metadata: Metadata = { title: "Abstenção — quem faltou, 1º × 2º turno" };

export default function AbstencaoPerfilPage() {
  return <AbstentionProfileView />;
}
