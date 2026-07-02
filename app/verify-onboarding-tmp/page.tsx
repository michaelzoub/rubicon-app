"use client";

// Temporary verification harness: /dashboard-newuser minus the Privy auth
// gate, which cannot run headlessly. Delete after verification.
import { SubstackOnboardingDialog } from "../dashboard/_components/substack-onboarding-dialog";

export default function VerifyOnboardingPage() {
  return <SubstackOnboardingDialog shouldOpen forceOpen />;
}
