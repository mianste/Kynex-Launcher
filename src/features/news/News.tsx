import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Newspaper, RefreshCw, Rss } from "lucide-react";
import {
  Button,
  Chip,
  Empty,
  SearchInput,
  Skeleton,
} from "../../components/ui";
import { api, desktop, external } from "../../lib/bridge";
import type { NewsArticle } from "../../lib/types";
import { guarded } from "../../store";

type NewsResponse = {
  articles: NewsArticle[];
  source: string;
  cached?: boolean;
  stale?: boolean;
  warning?: string;
};

const previewArticles: NewsArticle[] = [
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

const categories = ["全部", "Java 版", "基岩版", "更新", "社区"] as const;

function articleGroup(article: NewsArticle) {
  const text =
    `${article.title} ${article.summary} ${article.category}`.toLowerCase();
  if (/bedrock|基岩|preview|minecraft for windows/.test(text)) return "基岩版";
  if (/java|snapshot|快照|release candidate/.test(text)) return "Java 版";
  if (/update|更新|release|版本|patch/.test(text)) return "更新";
  return "社区";
}

function dateLabel(value: string) {
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

function NewsImage({ article }: { article: NewsArticle }) {
  const [failed, setFailed] = useState(false);
  if (!article.image || failed)
    return (
      <div className="news-image-fallback" aria-hidden="true">
        <Newspaper size={28} />
      </div>
    );
  return (
    <img
      src={article.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function News() {
  const [response, setResponse] = useState<NewsResponse>(() => ({
    articles: desktop ? [] : previewArticles,
    source: desktop ? "" : "网页预览",
  }));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [busy, setBusy] = useState(desktop);
  const [error, setError] = useState("");

  async function load(force = false) {
    if (!desktop) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<NewsResponse>("news", { force });
      setResponse(next);
      if (next.warning) setError(next.warning);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
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
  const status = !desktop
    ? "网页预览 · 示例资讯"
    : response.stale
      ? `${response.source} · 离线缓存`
      : response.cached
        ? `${response.source} · 已缓存`
        : response.source;

  const open = (article: NewsArticle) => guarded(() => external(article.url));

  return (
    <section className="page-content news-page">
      <div className="page-head">
        <div>
          <h1>MC 新闻</h1>
          <p>来自 Minecraft.net 的官方动态与版本资讯。</p>
        </div>
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
        <span className="news-feed-status">
          <Rss size={13} />
          {status || "正在获取官方资讯"}
        </span>
      </div>

      {error && response.articles.length > 0 && (
        <p className="news-inline-note">暂时无法更新，正在显示已有内容。</p>
      )}
      {busy && response.articles.length === 0 ? (
        <div
          className="news-grid news-loading"
          aria-label="正在获取 Minecraft 新闻"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} />
          ))}
        </div>
      ) : !featured ? (
        <Empty
          title={error ? "新闻暂时无法获取" : "没有符合条件的新闻"}
          detail={error || "试试其他分类或搜索词。"}
        />
      ) : (
        <>
          <button className="news-feature" onClick={() => open(featured)}>
            <div className="news-feature-media">
              <NewsImage article={featured} />
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
                    <NewsImage article={article} />
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
