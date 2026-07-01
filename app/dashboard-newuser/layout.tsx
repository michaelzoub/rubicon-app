import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardShell } from "../dashboard/_components/shell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function NewUserDashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
