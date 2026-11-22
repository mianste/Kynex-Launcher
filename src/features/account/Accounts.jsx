import {
  Plus,
  ShieldCheck,
  UserRound,
  KeyRound,
  Check,
  Trash2,
  Shirt,
} from "lucide-react";
import { Button, Card, Empty } from "../../components/ui";
import { useStore } from "../../store";
import { AccountAvatar } from "./AccountAvatar";
export function Accounts() {
  const s = useStore();
  return (
    <>
      <div className="page-head">
        <h1>账号</h1>
        <Button
          data-guide="account-add"
          primary
          onClick={() => s.show("login")}
        >
          <Plus size={16} />
          添加账号
        </Button>
      </div>
      <div className="account-grid">
        {s.accounts.map((a) => (
          <Card
            key={a.id}
            className={`account-card${a.id === s.accountId ? " selected-account" : ""}`}
          >
            <div className="account-header">
              <AccountAvatar account={a} />
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
                onClick={() => s.selectAccount(a.id)}
              >
                {a.id === s.accountId ? (
                  <>
                    <Check size={14} />
                    当前账号
                  </>
                ) : (
                  "设为默认"
                )}
              </Button>
            </div>
          </Card>
        ))}
        {!s.accounts.length && <Empty title="还没有账号" />}
      </div>
    </>
  );
}
