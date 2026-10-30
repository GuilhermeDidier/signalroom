import { Suspense } from "react";
import { Shell } from "./Shell";

export default function TenantLayout({ children }: LayoutProps<"/app/[slug]">) {
  return (
    <Suspense fallback={<div className="shell-boot" aria-busy="true" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
