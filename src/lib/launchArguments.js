// Mirrors the desktop argument grammar; backslashes in Windows paths stay literal.
export function parseLaunchArguments(raw = "") {
  const tokens = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\0") throw new Error("参数包含无效字符");
    if (quote) {
      if (quote === '"' && ch === "\\" && raw[i + 1] === '"') {
        word += '"'; i++;
      } else if (ch === quote) quote = "";
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; started = true;
    } else if (/\s/u.test(ch)) {
      if (started) { tokens.push(word); word = ""; started = false; }
    } else { word += ch; started = true; }
  }
  if (quote) throw new Error("存在未闭合的引号，启动前请补全");
  if (started) tokens.push(word);
  return tokens;
}

export function argumentError(raw) {
  try { parseLaunchArguments(raw); return ""; }
  catch (error) { return error.message; }
}

export function hasArgumentPreset(raw, snippet) {
  try {
    const tokens = parseLaunchArguments(raw);
    return parseLaunchArguments(snippet).every(token => tokens.includes(token));
  } catch { return false; }
}

export function toggleArgumentPreset(raw, snippet) {
  const tokens = parseLaunchArguments(raw);
  const preset = parseLaunchArguments(snippet);
  if (!preset.every(token => tokens.includes(token))) {
    return [raw.trim(), ...preset.filter(token => !tokens.includes(token))].filter(Boolean).join(" ");
  }
  return tokens.filter(token => !preset.includes(token)).map(token =>
    token ? token.replace(/[\s"']/gu, ch => ch === "'" ? '"\'"' : `'${ch}'`) : "''",
  ).join(" ");
}
