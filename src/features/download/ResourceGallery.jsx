import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui";
const warmedImages = new Map();
export function prefetchGalleryImage(image) {
  if (!image) return;
  const src = image.thumbnailUrl || image.url;
  if (warmedImages.has(src)) return;
  const preload = new Image();
  preload.referrerPolicy = "no-referrer";
  preload.fetchPriority = "low";
  preload.onerror = () => {
    if (warmedImages.get(src) === preload) warmedImages.delete(src);
  };
  warmedImages.set(src, preload);
  if (warmedImages.size > 16) {
    const oldest = warmedImages.keys().next().value;
    if (oldest !== undefined) warmedImages.delete(oldest);
  }
  preload.src = src;
}
function Screenshot({ image, number, onReady, onFailure }) {
  const [ready, setReady] = useState(false);
  const [src, setSrc] = useState(image.thumbnailUrl || image.url);
  return (
    <>
      {!ready && (
        <p className="resource-gallery-message" role="status">
          正在加载预览…
        </p>
      )}
      <img
        src={src}
        alt={image.title || `预览 ${number}`}
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ visibility: ready ? "visible" : "hidden" }}
        onLoad={() => {
          setReady(true);
          onReady();
        }}
        onError={() => {
          if (src !== image.url) setSrc(image.url);
          else onFailure();
        }}
      />
    </>
  );
}
export function ResourceGallery({ images, onUnavailable }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState([]);
  const available = images.map((_, i) => i).filter((i) => !failed.includes(i));
  const current = available.includes(index) ? index : available[0];
  const image = images[current];
  if (!image) return null;
  const position = available.indexOf(current);
  const next = available[(position + 1) % available.length];
  return (
    <section className="resource-gallery" aria-label="项目预览">
      <div className="resource-gallery-frame">
        <Screenshot
          key={current}
          image={image}
          number={position + 1}
          onReady={() => {
            if (available.length > 1) prefetchGalleryImage(images[next]);
          }}
          onFailure={() => {
            if (available.length === 1) onUnavailable();
            setFailed([...failed, current]);
          }}
        />
      </div>
      {available.length > 1 && (
        <div className="resource-gallery-controls">
          <Button
            type="button"
            aria-label="上一张"
            onClick={() =>
              setIndex(
                available[(position + available.length - 1) % available.length],
              )
            }
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <span aria-live="polite">
            {position + 1} / {available.length}
          </span>
          <Button
            type="button"
            aria-label="下一张"
            onClick={() => setIndex(next)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
