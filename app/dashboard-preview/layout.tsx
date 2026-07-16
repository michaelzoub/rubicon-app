import type { ReactNode } from "react";
import { DashboardOverlayProvider } from "../dashboard/_components/overlays";
import "../dashboard/dashboard.css";

export default function DashboardPreviewLayout({ children }: { children: ReactNode }) {
  return <DashboardOverlayProvider>{children}</DashboardOverlayProvider>;
}
