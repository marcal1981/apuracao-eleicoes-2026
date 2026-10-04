import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Apuração Eleições 2026",
    short_name: "Apuração 2026",
    description: "Acompanhe a apuração das Eleições 2026 com dados oficiais do TSE.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1116",
    theme_color: "#0e1116",
    lang: "pt-BR",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
