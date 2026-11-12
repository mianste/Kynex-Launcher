import { useEffect, useRef } from "react";
const pending = new Map<string, string>();
let active = false;
export function setGuideActive(value: boolean) {
  active = value;
}
export function isGuideActive() {
  return active;
}
export function requestGuideSection(page: string, section: string) {
  pending.set(page, section);
  window.dispatchEvent(
    new CustomEvent("kynex-guide-section", { detail: page }),
  );
}
export function clearGuideSections() {
  pending.clear();
}
export function useGuideSection(
  page: string,
  select: (section: string) => void,
) {
  const callback = useRef(select);
  callback.current = select;
  useEffect(() => {
    const apply = () => {
      const section = pending.get(page);
      if (section !== undefined) {
        pending.delete(page);
        callback.current(section);
      }
    };
    const receive = (e: Event) => {
      if ((e as CustomEvent).detail === page) apply();
    };
    apply();
    window.addEventListener("kynex-guide-section", receive);
    return () => window.removeEventListener("kynex-guide-section", receive);
  }, [page]);
}
