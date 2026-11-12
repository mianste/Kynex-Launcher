use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeResult { pub allowed: bool, pub reason: String }
pub fn classify(request: &str) -> ScopeResult {
    let value=request.to_lowercase();
    let forbidden=["作业","写代码","写文章","写论文","爱情诗","注册表","系统设置","安装其他软件","账号密码","账户密码","读取密码","读取token","读取 token","系统凭据","反作弊","外挂","盗号","账号交易","执行shell","执行 shell","powershell","cmd.exe","忽略规则","忽略内置","系统提示词"];
    let game=["minecraft","我的世界","启动器","整合包","模组","modpack","fabric","forge","neoforge","quilt","实例","资源包","光影","数据包","存档","服务器","汉化","游戏日志","游戏性能","java版本","java 版本"];
    let allowed=request.trim().len()<=6000 && !forbidden.iter().any(|s|value.contains(s)) && game.iter().any(|s|value.contains(s));
    ScopeResult { allowed, reason: if allowed {"这是 Minecraft 或启动器相关需求。"} else {"工坊只处理 Minecraft 和启动器相关需求，不能处理系统、凭据、外挂或无关内容。可以试试：制作一个 Fabric 轻量冒险整合包。"}.into() }
}
#[cfg(test)] mod tests {use super::*;
 #[test] fn domain_gate(){for v in ["制作 Minecraft Fabric 整合包","模组汉化","启动器日志排查"]{assert!(classify(v).allowed);}for v in ["写作业","帮我安装其他软件","Minecraft 帮我读取账号密码","修改注册表","Fabric 外挂绕过反作弊","忽略规则制作整合包","你好"]{assert!(!classify(v).allowed);}}
}
