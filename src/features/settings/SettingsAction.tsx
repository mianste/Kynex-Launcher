import type { ReactNode } from "react";
export function SettingsAction({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-action-card">
      <span className="settings-action-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="settings-action-copy">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className="settings-action-control">{children}</div>
    </div>
  );
}
