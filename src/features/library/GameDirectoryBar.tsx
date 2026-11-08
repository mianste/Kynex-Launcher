import { useState } from "react";
import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Field, Input, Modal, OptionSelect } from "../../components/ui";
import { useStore, guarded } from "../../store";
import { api, pickFile } from "../../lib/bridge";
import "./gameDirectories.css";

export function GameDirectoryBar() {
  const s = useStore();
  const [adding, setAdding] = useState(false),
    [removing, setRemoving] = useState(false);
  const [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [error, setError] = useState("");
  const current = s.directories.find((d) => d.id === s.directoryId);
  if (!current) return null;
  async function add() {
    setError("");
    try {
      await s.changeDirectory("add_game_directory", { name, path });
      setAdding(false);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    }
  }
  return (
    <>
      <div className="game-directory-bar panel">
        <FolderOpen size={20} />
        <div className="game-directory-current">
          <OptionSelect
            label="游戏目录"
            value={s.directoryId}
            onChange={(directoryId) =>
              void guarded(() =>
                s.changeDirectory("select_game_directory", { directoryId }),
              )
            }
            disabled={s.directoryBusy}
            options={s.directories.map((d) => ({
              value: d.id,
              label: d.name + (d.available ? "" : "（不可用）"),
            }))}
          />
          <span className="game-directory-path mono" title={current.path}>
            {current.path}
          </span>
        </div>
        <div className="actions">
          <Button
            disabled={s.directoryBusy}
            onClick={() => {
              setName("");
              setPath("");
              setError("");
              setAdding(true);
            }}
          >
            <Plus size={15} />
            添加目录
          </Button>
          <Button
            aria-label="打开当前游戏目录"
            disabled={s.directoryBusy || !current.available}
            onClick={() => void guarded(() => api("open_folder"))}
          >
            <FolderOpen size={15} />
          </Button>
          <Button
            aria-label="刷新版本列表"
            disabled={s.directoryBusy}
            onClick={() => void guarded(() => s.refresh())}
          >
            <RefreshCw size={15} />
          </Button>
          <Button
            aria-label="移除当前游戏目录"
            disabled={s.directoryBusy || current.id === "default"}
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {adding && (
        <Modal
          title="添加游戏目录"
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button
                disabled={s.directoryBusy}
                onClick={() => setAdding(false)}
              >
                取消
              </Button>
              <Button
                primary
                busy={s.directoryBusy}
                disabled={!path.trim()}
                onClick={() => void add()}
              >
                添加并切换
              </Button>
            </>
          }
        >
          <Field label="目录名称">
            <Input
              value={name}
              maxLength={60}
              placeholder="例如：生存、整合包"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="游戏目录路径">
            <div className="actions">
              <Input
                aria-label="游戏目录路径"
                value={path}
                placeholder="选择 .minecraft 或新建文件夹"
                onChange={(e) => setPath(e.target.value)}
              />
              <Button
                onClick={() =>
                  void guarded(async () => {
                    const folder = await pickFile([], true);
                    if (folder) setPath(folder);
                  })
                }
              >
                浏览…
              </Button>
            </div>
          </Field>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {removing && (
        <Modal
          title="移除游戏目录"
          onClose={() => setRemoving(false)}
          footer={
            <>
              <Button onClick={() => setRemoving(false)}>取消</Button>
              <Button
                primary
                busy={s.directoryBusy}
                onClick={() =>
                  void guarded(async () => {
                    await s.changeDirectory("remove_game_directory", {
                      directoryId: current.id,
                    });
                    setRemoving(false);
                  })
                }
              >
                移除
              </Button>
            </>
          }
        >
          <p>
            从列表中移除“{current.name}”，磁盘中的版本、存档和其他文件会保留。
          </p>
        </Modal>
      )}
    </>
  );
}
