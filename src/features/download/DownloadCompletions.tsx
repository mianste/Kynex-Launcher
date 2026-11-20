import { useEffect, type CSSProperties } from "react";
import { Check } from "lucide-react";
import "./downloadCompletions.css";

export type DownloadCompletion = {
  id: string;
  title: string;
  name?: string;
  detail?: string | null;
};

const visibleFor = 2500;

function CompletionIsland({ item, dismiss }: {
  item: DownloadCompletion;
  dismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), visibleFor);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.id]);

  return (
    <div className="download-completion-island" style={{ "--notice-duration": `${visibleFor}ms` } as CSSProperties}>
      <span className="download-completion-check" aria-hidden="true"><Check size={14} /></span>
      <strong>{item.title}</strong>
      {item.name && <span className="download-completion-name">{item.name}</span>}
      {item.detail && <span className="sr-only">{item.detail}</span>}
    </div>
  );
}

export function DownloadCompletions({ items, dismiss }: {
  items: DownloadCompletion[];
  dismiss: (id: string) => void;
}) {
  const item = items[0];
  return (
    <div className="download-completions" role="status" aria-atomic="true">
      {item && <CompletionIsland key={item.id} item={item} dismiss={dismiss} />}
    </div>
  );
}
