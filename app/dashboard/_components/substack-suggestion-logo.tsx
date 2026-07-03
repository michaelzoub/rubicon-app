"use client";

import { useEffect, useState } from "react";

export function SubstackSuggestionLogo({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  const initial = name.trim().charAt(0).toUpperCase() || "S";
  return (
    <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-[#ececef] text-xs font-semibold text-[var(--muted)]" aria-hidden="true">
      {initial}
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- remote Substack logos aren't in next.config image domains
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
