import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Newspaper, RefreshCw } from "lucide-react";
import { Button, Chip, Empty, SearchInput } from "../../components/ui";
import { api, desktop, external } from "../../lib/bridge";
import { guarded } from "../../store";
import "./newsLoading.css";
const previewArticles = [
  {
    id: "preview-1",
    title: "Minecraft 官方新闻将在这里出现",
    summary: "桌面版会连接 Minecraft.net，展示最新更新、快照和社区动态。",
    published: "",
    category: "网页预览",
    image: "",
    url: "https://www.minecraft.net/zh-hans/articles",
    source: "示例资讯",
  },
  {
    id: "preview-2",
    title: "集中查看 Java 版与基岩版动态",
    summary: "可按类型筛选，也可以搜索标题、摘要和分类。",
    published: "",
    category: "网页预览",
    image: "",
    url: "https://www.minecraft.net/zh-hans/articles",
    source: "示例资讯",
  },
];
const categories = ["全部", "Java 版", "基岩版", "更新", "社区"];
function articleGroup(article) {
  const text =
    `${article.title} ${article.summary} ${article.category}`.toLowerCase();
  if (/bedrock|基岩|preview|minecraft for windows/.test(text)) return "基岩版";
  if (/java|snapshot|快照|release candidate/.test(text)) return "Java 版";
  if (/update|更新|release|版本|patch/.test(text)) return "更新";
  return "社区";
}
function dateLabel(value) {
  if (!value) return "预览内容";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}
function preloadCover(url, signal) {
  if (!url || signal.aborted) return Promise.resolve("");
  return new Promise((resolve) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const abort = () => finish("");
    const timer = setTimeout(abort, 8000);
    function finish(ready) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (!ready) image.removeAttribute("src");
      resolve(ready);
    }
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
    void image.decode().then(() => finish(url), abort);
  });
}

function NewsImage({ article }) {
  const [failed, setFailed] = useState(false);
  if (!article.image || failed)
    return (
      <div className="news-image-fallback" aria-hidden="true">
        <Newspaper size={28} />
      </div>
    );
  return (
    <div className="news-image">
      <img
        src={article.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
function NewsLoading() {
  const copy = (
    <div className="news-skeleton-copy">
      <i />
      <b />
      <b />
      <p />
      <p />
      <small />
    </div>
  );
  return (
    <div className="news-loading" role="status" aria-label="正在加载新闻">
      <div className="news-loading-label">
        <RefreshCw size={16} className="spin" />
        <span>正在加载新闻</span>
      </div>
      <div className="news-feature news-skeleton" aria-hidden="true">
        <div className="news-skeleton-media">
          <Newspaper size={40} />
        </div>
        {copy}
      </div>
      <div className="news-grid" aria-hidden="true">
        {[0, 1].map((index) => (
          <div className="news-card news-skeleton" key={index}>
            <div className="news-skeleton-media">
              <Newspaper size={28} />
            </div>
            {copy}
          </div>
        ))}
      </div>
    </div>
  );
}
export function News() {
  const [response, setResponse] = useState(() => ({
    articles: desktop ? [] : previewArticles,
    source: desktop ? "" : "网页预览",
  }));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [busy, setBusy] = useState(desktop);
  const [error, setError] = useState("");
  const activeRequest = useRef(null);
  async function load(force = false) {
    if (!desktop) return;
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setBusy(true);
    setError("");
    try {
      const next = await api("news", { force });
      if (request.signal.aborted) return;
      const covers = new Map();
      const articles = await Promise.all(
        next.articles.map(async (article) => {
          if (!article.image) return article;
          if (!covers.has(article.image))
            covers.set(article.image, preloadCover(article.image, request.signal));
          return { ...article, image: await covers.get(article.image) };
        }),
      );
      if (request.signal.aborted) return;
      setResponse({ ...next, articles });
      if (next.warning) setError(next.warning);
    } catch (reason) {
      if (!request.signal.aborted)
        setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, []);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return response.articles.filter((article) => {
      const matchesCategory =
        category === "全部" || articleGroup(article) === category;
      const haystack =
        `${article.title} ${article.summary} ${article.category}`.toLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
  }, [category, query, response.articles]);
  const [featured, ...rest] = visible;
  const open = (article) => guarded(() => external(article.url));
  return (
    <section className="news-page" aria-busy={busy}>
      <div className="page-head">
        <h1>MC 新闻</h1>
        <div className="actions news-toolbar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="搜索新闻"
          />
          <Button
            busy={busy}
            onClick={() => void load(true)}
            disabled={!desktop}
          >
            <RefreshCw size={14} /> 刷新
          </Button>
        </div>
      </div>

      <div className="news-filter-row" aria-label="新闻分类">
        {categories.map((item) => (
          <Chip
            key={item}
            active={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </Chip>
        ))}
      </div>

      {busy ? (
        <NewsLoading />
      ) : !featured ? (
        <Empty
          title={error ? "新闻暂时无法获取" : "没有符合条件的新闻"}
          detail={error || "试试其他分类或搜索词。"}
        />
      ) : (
        <>
          <button className="news-feature" onClick={() => open(featured)}>
            <div className="news-feature-media">
              <NewsImage key={featured.image} article={featured} />
            </div>
            <div className="news-feature-copy">
              <span className="news-kicker">
                {featured.category || "Minecraft 新闻"}
              </span>
              <h2>{featured.title}</h2>
              <p>{featured.summary}</p>
              <div className="news-meta">
                <span>{dateLabel(featured.published)}</span>
                <span>{featured.source}</span>
                <span className="news-open">
                  阅读原文 <ArrowUpRight size={14} />
                </span>
              </div>
            </div>
          </button>
          {rest.length > 0 && (
            <div className="news-grid">
              {rest.map((article) => (
                <button
                  className="news-card"
                  key={article.id}
                  onClick={() => open(article)}
                >
                  <div className="news-card-media">
                    <NewsImage key={article.image} article={article} />
                  </div>
                  <div className="news-card-copy">
                    <span className="news-kicker">
                      {article.category || "Minecraft 新闻"}
                    </span>
                    <h3>{article.title}</h3>
                    <p>{article.summary}</p>
                    <div className="news-meta">
                      <span>{dateLabel(article.published)}</span>
                      <ArrowUpRight size={14} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
