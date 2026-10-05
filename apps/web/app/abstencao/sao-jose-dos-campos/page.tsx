import type { Metadata } from "next";
import { SectionsView } from "@/components/sections-view";

export const metadata: Metadata = { title: "Abstenção por seção — São José dos Campos" };

export default function AbstencaoSjcPage() {
  return <SectionsView slug="sao-jose-dos-campos" />;
}
