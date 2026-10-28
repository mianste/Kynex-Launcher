import {
  Plus,
  ShieldCheck,
  UserRound,
  KeyRound,
  Check,
  Trash2,
  Shirt,
} from "lucide-react";
import { Button, Badge, Card } from "../../components/ui";
import { useStore, guarded } from "../../store";
import { api } from "../../lib/bridge";
export function Accounts() {
  const s = useStore();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>账号</h1>
          <p>每一种身份，都能找到自己的世界。</p>
        </div>
        <Button primary onClick={() => s.show("login")}>
          <Plus size={16} />
          添加账号
        </Button>
      </div>
      <div className="account-grid">
        {s.accounts.map((a) => (
          <Card
            key={a.id}
            className={a.id === s.accountId ? "selected-account" : ""}
          >
            <div className="account-header">
              <div className={`avatar ${a.kind}`}>
                {a.skin || (a.id === s.accountId && s.skin) ? (
                  <i
                    className="avatar-head"
                    style={{ backgroundImage: `url(${a.skin || s.skin})` }}
                  />
                ) : (
                  a.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div>
                <h3>{a.name}</h3>
                <small>
                  {
                    {
                      microsoft: "Microsoft 正版",
                      offline: "离线登录",
                      external: "外置认证",
                    }[a.kind]
                  }
                </small>
              </div>
              {a.kind === "microsoft" ? (
                <ShieldCheck className="ok-text" size={20} />
              ) : a.kind === "external" ? (
                <KeyRound size={20} />
              ) : (
                <UserRound size={20} />
              )}
            </div>
            <p>
              {a.kind === "microsoft"
                ? "正版多人游戏、服务器验证与官方档案。"
                : a.kind === "external"
                  ? "连接支持相同外置认证服务的服务器。"
                  : "本地单人游戏与允许离线身份的服务器。"}
            </p>
            <div className="spread">
              <Badge tone={a.id === s.accountId ? "ok" : ""}>
                {a.id === s.accountId ? "默认账号" : "可用"}
              </Badge>
              <div className="actions">
                <Button
                  aria-label={`为 ${a.name} 更换皮肤`}
                  title="更换皮肤"
                  onClick={() => {
                    useStore.setState({
                      accountId: a.id,
                      skin: a.skin ?? "",
                      skinModel: a.skinModel ?? "Classic",
                      skinAccountId: a.id,
                    });
                    s.setPage("skin");
                  }}
                >
                  <Shirt size={14} />
                  皮肤
                </Button>
                <Button
                  aria-label={`移除 ${a.name}`}
                  onClick={() => s.show("remove-account", a.id)}
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  disabled={a.id === s.accountId}
                  onClick={() => useStore.setState({ accountId: a.id })}
                >
                  {a.id === s.accountId ? <Check size={14} /> : null}设为默认
                </Button>
              </div>
            </div>
          </Card>
        ))}
        <button className="add-account" onClick={() => s.show("login")}>
          <Plus size={28} />
          <b>添加一个账号</b>
          <small>Microsoft / 离线 / 外置认证</small>
        </button>
      </div>
      <div className="account-explainer">
        <Card>
          <ShieldCheck size={20} />
          <h3>正版登录</h3>
          <p>
            点击登录后自动复制设备码，并打开微软官方授权网页。完成授权后启动器会自动登录。
          </p>
        </Card>
        <Card>
          <UserRound size={20} />
          <h3>离线登录</h3>
          <p>
            创建本地身份，适用于单人世界及允许离线账号的服务器。正版服务器需要正版账号。
          </p>
        </Card>
        <Card>
          <KeyRound size={20} />
          <h3>外置认证</h3>
          <p>
            通过 Yggdrasil
            服务验证身份，密码只发送到你填写的认证地址，凭据保存在系统凭据库。
          </p>
        </Card>
      </div>
    </>
  );
}
