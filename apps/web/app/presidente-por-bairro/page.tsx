import type { Metadata } from "next";
import { PresidentBairroView } from "@/components/president-bairro-view";

export const metadata: Metadata = { title: "Presidente por bairro — São José dos Campos" };

export default function PresidentePorBairroPage() {
  return <PresidentBairroView slug="sao-jose-dos-campos" />;
}
