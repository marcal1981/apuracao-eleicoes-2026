import type { Metadata } from "next";
import { CalibrationView } from "@/components/calibration-view";

export const metadata: Metadata = { title: "Calibração da projeção — 2º turno" };

export default function CalibracaoPage() {
  return <CalibrationView />;
}
