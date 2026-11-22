import { useEffect, useRef } from "react";
const pending = new Map();
let active = false;
export function setGuideActive(value) {
  active = value;
}
export function isGuideActive() {
  return active;
}
export function requestGuideSection(page, section) {
  pending.set(page, section);
  window.dispatchEvent(
    new CustomEvent("kynex-guide-section", { detail: page }),
  );
}
export function clearGuideSections() {
  pending.clear();
}
export function useGuideSection(page, select) {
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
    const receive = (e) => {
      if (e.detail === page) apply();
    };
    apply();
    window.addEventListener("kynex-guide-section", receive);
    return () => window.removeEventListener("kynex-guide-section", receive);
  }, [page]);
}
