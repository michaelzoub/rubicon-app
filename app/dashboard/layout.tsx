import type { ReactNode } from "react";
import { DashboardShell } from "./_components/shell";
import { DashboardOverlayProvider } from "./_components/overlays";
import "./dashboard.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardOverlayProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardOverlayProvider>
  );
}
