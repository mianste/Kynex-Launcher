import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  // Match code and filename globs before emphasis: crash-*.txt is a filename,
  // not the beginning of italic text spanning the next sentence.
  const tokens =
    /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)[\w-]*\*(?!\*)[\w*.-]*\.(?:txt|log|jar|json|zip)\b|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|(?<![\p{L}\p{N}_])\*(?![\s*])[^*\n]*?\S\*(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])_(?!\s)[^_\n]*?\S_(?![\p{L}\p{N}_]))/gu;
  const result: ReactNode[] = [];
  let start = 0;
  function plain(value: string) {
    // Tolerate an unclosed model emphasis marker without altering file globs.
    return value
      .replace(/(^|\s)\*{2,}(?=\S)/g, "$1")
      .replace(/(?<=\S)\*{2,}(?=\s|$)/g, "");
  }
  for (const match of text.matchAll(tokens)) {
    const index = match.index!;
    if (index > start)
      result.push(
        <Fragment key={`p${index}`}>
          {plain(text.slice(start, index))}
        </Fragment>,
      );
    const part = match[0];
    const key = `t${index}`;
    if (part.startsWith("`"))
      result.push(<code key={key}>{part.slice(1, -1)}</code>);
    else if (part.startsWith("***"))
      result.push(
        <strong key={key}>
          <em>{part.slice(3, -3)}</em>
        </strong>,
      );
    else if (part.startsWith("**") || part.startsWith("__"))
      result.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    else if (part.startsWith("~~"))
      result.push(<del key={key}>{part.slice(2, -2)}</del>);
    else if (part.startsWith("[")) {
      const link = part.match(/^\[(.+)\]\((.+)\)$/)!;
      result.push(
        <span key={key} className="answer-reference">
          {link[1]}
          <small>（{link[2]}）</small>
        </span>,
      );
    } else if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    )
      result.push(<em key={key}>{part.slice(1, -1)}</em>);
    else
      result.push(
        <code className="answer-filename" key={key}>
          {part}
        </code>,
      );
    start = index + part.length;
  }
  if (start < text.length)
    result.push(<Fragment key="tail">{plain(text.slice(start))}</Fragment>);
  return result;
}
const listMatch = (s: string) =>
  s.match(/^\s*(?:(\d{1,3})(?:[.)]\s+|、\s*)|([-*+])\s+)(.*)$/);
const headingMatch = (s: string) =>
  s.match(/^\s{0,3}#{1,6}(?:\s+|(?=[\u3400-\u9fff]))(.+?)(?:\s+#+)?$/);
const fenceMatch = (s: string) => s.match(/^\s*(`{3,}|~{3,})/);
const divider = (s: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(s);

// Model HTML is always rendered as text, never inserted into the document.
export function FormattedAnswer({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = fenceMatch(line);
    if (fence) {
      const start = i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1]))
        code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={start}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (divider(line)) {
      blocks.push(<hr key={i++} />);
      continue;
    }
    const heading = headingMatch(line);
    if (heading) {
      blocks.push(<h3 key={i}>{inline(heading[1])}</h3>);
      i++;
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1] || "")
    ) {
      const cells = (s: string) =>
        s
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((v) => v.trim());
      const start = i;
      const titles = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|"))
        rows.push(cells(lines[i++]));
      blocks.push(
        <div className="assistant-table" key={start}>
          <table>
            <thead>
              <tr>
                {titles.map((title, n) => (
                  <th key={n}>{inline(title)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {titles.map((_, k) => (
                    <td key={k}>{inline(row[k] || "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const list = listMatch(line);
    if (list) {
      const ordered = !!list[1];
      const first = Number(list[1]);
      const start = i;
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const match = listMatch(lines[i]);
        if (!match || !!match[1] !== ordered) break;
        const itemStart = i++;
        const content = [match[3]];
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !listMatch(lines[i]) &&
          !fenceMatch(lines[i])
        )
          content.push(lines[i++].trim());
        const item = content
          .join(" ")
          .replace(/^\[[xX]\]\s*/, "已完成：")
          .replace(/^\[ \]\s*/, "待处理：");
        items.push(<li key={itemStart}>{inline(item)}</li>);
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        const following = next < lines.length ? listMatch(lines[next]) : null;
        if (following && !!following[1] === ordered) i = next;
        else break;
      }
      blocks.push(
        ordered ? (
          <ol
            key={start}
            start={first === 1 ? undefined : first}
            style={{ counterReset: `answer-step ${first - 1}` }}
          >
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const start = i;
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={start}>{inline(quote.join(" "))}</blockquote>,
      );
      continue;
    }
    const start = i;
    const paragraph = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !headingMatch(lines[i]) &&
      !listMatch(lines[i]) &&
      !fenceMatch(lines[i]) &&
      !divider(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !lines[i].includes("|")
    )
      paragraph.push(lines[i++]);
    blocks.push(<p key={start}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="assistant-answer">{blocks}</div>;
}
