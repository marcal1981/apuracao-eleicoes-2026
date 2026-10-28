import type { Metadata } from "next";
import { PasswordsView } from "@/components/passwords-view";

export const metadata: Metadata = { title: "Senhas de acesso" };

export default function SenhasPage() {
  return <PasswordsView />;
}
