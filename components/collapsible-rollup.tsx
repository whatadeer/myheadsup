"use client";

import type { ReactNode } from "react";

export function CollapsibleRollup({
  children,
  detail,
  title,
}: {
  children: ReactNode;
  detail?: ReactNode;
  title: ReactNode;
}) {
  return (
    <details className="next-runs">
      <summary className="next-runs-summary">
        <span className="section-heading">{title}</span>
        {detail ? <span className="helper-text">{detail}</span> : null}
      </summary>
      <div className="next-runs-body">{children}</div>
    </details>
  );
}
