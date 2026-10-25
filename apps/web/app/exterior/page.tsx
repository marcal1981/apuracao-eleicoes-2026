import type { Metadata } from "next";
import { ExteriorView } from "@/components/exterior-view";

export const metadata: Metadata = { title: "Exterior — 1º × 2º turno" };

export default function ExteriorPage() {
  return <ExteriorView />;
}
