import type { ReactNode } from "react";
import { DashboardShell } from "./_components/shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
