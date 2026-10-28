import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./tokens.css";
import "./styles.css";
import "./motion.css";
import "./features/skin/wardrobe.css";
import "./acrylic.css";
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
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
