import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.KXL_BROWSER_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("kynex-onboarding-all-pages-v3", "done");
  });
  await page.goto((process.env.KXL_DEV_ORIGIN || "http://localhost:5173") + "/?nosplash=1#library");
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store/index.js");
    useStore.setState({
      directories: [{ id: "default", name: "默认目录", path: "C:/Games/.minecraft", available: true }],
      directoryId: "default",
    });
    useStore.getState().setPage("library");
  });

  const trigger = page.getByRole("button", { name: "添加目录", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "添加游戏目录" });
  const name = dialog.getByPlaceholder("例如：生存、整合包");
  const path = dialog.getByRole("textbox", { name: "游戏目录路径" });
  const focused = (control) => control.evaluate((node) => node === document.activeElement);

  await name.click();
  await page.keyboard.type("survival");
  assert.equal(await name.inputValue(), "survival");
  assert.ok(await focused(name));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "shengcun", selectionStart: 8, selectionEnd: 8 });
  await cdp.send("Input.insertText", { text: "生存" });
  await cdp.detach();
  assert.ok(await focused(name));
  assert.equal(await name.inputValue(), "survival生存");

  await page.keyboard.press("Tab");
  assert.ok(await focused(path));
  await page.keyboard.type("D:/Games/.minecraft");
  assert.equal(await path.inputValue(), "D:/Games/.minecraft");
  assert.ok(await focused(path));

  await path.evaluate((input) => input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
  ));
  assert.ok(await dialog.isVisible());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await focused(trigger));
} finally {
  await browser.close();
}
