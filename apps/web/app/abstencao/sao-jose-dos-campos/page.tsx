import type { Metadata } from "next";
import { ZonesView } from "@/components/zones-view";

export const metadata: Metadata = { title: "Abstenção por zona eleitoral — São José dos Campos" };

export default function AbstencaoSjcPage() {
  return <ZonesView slug="sao-jose-dos-campos" />;
}
