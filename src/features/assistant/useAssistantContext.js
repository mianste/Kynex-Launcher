import { useEffect, useState } from "react";
import { api, desktop } from "../../lib/bridge";
export function useAssistantContext(open, directoryId, id) {
  const [value, Value] = useState(null);
  const [enabled, Enabled] = useState({
    instance: true,
    mods: true,
    latest: true,
    crash: true,
  });
  const [notice, Notice] = useState("");
  useEffect(() => {
    Value(null);
    Notice("");
    Enabled({ instance: true, mods: true, latest: true, crash: true });
    if (!open || !desktop || !id) return;
    let live = true;
    void api("assistant_context", { directoryId, id })
      .then((data) => {
        if (live)
          Value({
            mods: data.mods,
            attachments: data.attachments.map(
              ({ kind, name, text, truncated }) => ({
                kind,
                name,
                text,
                truncated,
              }),
            ),
          });
      })
      .catch(() => {
        if (live)
          Notice("暂时读不到游戏记录。你可以直接问，也可以自己添加日志。");
      });
    return () => {
      live = false;
    };
  }, [open, directoryId, id]);
  const toggle = (key) => Enabled((old) => ({ ...old, [key]: !old[key] }));
  const attachments = () => [
    ...(value?.attachments || [])
      .filter((log) => enabled[log.kind])
      .map((log) => ({ name: log.name, text: log.text })),
    ...(value && enabled.mods
      ? [
          {
            name: "已安装模组",
            text: `共 ${value.mods.count} 个模组\n${value.mods.files.join("\n")}`,
          },
        ]
      : []),
  ];
  return { value, enabled, toggle, attachments, notice };
}
