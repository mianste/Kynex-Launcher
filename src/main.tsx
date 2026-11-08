import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./tokens.css";
import "./styles.css";
import "./motion.css";
import "./features/skin/wardrobe.css";
import "./acrylic.css";
import "./appearance.css";
import "./interaction-motion.css";
import "./window-corners.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>KXL 暂时无法显示界面</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>重新载入</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
// 生产版关闭 WebView2 默认右键菜单（返回/刷新/另存为/打印），开发版保留方便调试。
if (!import.meta.env.DEV) {
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
