import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Modal } from "../../components/ui";
export function CopyrightNotice({ kind, onClose }) {
  const [seconds, setSeconds] = useState(5);
  const deadline = useRef(performance.now() + 5000);
  const close = useCallback(() => {
    if (performance.now() >= deadline.current) onClose();
  }, [onClose]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((deadline.current - performance.now()) / 1000),
      );
      setSeconds(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <Modal
      title={`${kind}版权警告`}
      className="catalog-copyright-modal"
      hideCloseButton
      onClose={close}
      footer={
        <Button primary disabled={seconds > 0} onClick={close}>
          {seconds > 0 ? `关闭（${seconds} 秒）` : "关闭"}
        </Button>
      }
    >
      <div className="notice catalog-copyright-warning">
        <TriangleAlert size={24} aria-hidden="true" />
        <div>
          <strong>作品版权归原作者</strong>
          <p>
            下载或使用前，请查看并遵守作者许可及站点规则。未经授权，不得转载、二次分发、商用或删除署名。
          </p>
          <p>如果遇到侵权内容，请停止使用。阅读提示不能代替作者授权。</p>
        </div>
      </div>
    </Modal>
  );
}
