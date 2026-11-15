import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "../../components/ui";
import type { Project } from "../../lib/types";

type GalleryImage = NonNullable<Project["gallery"]>[number];

function Screenshot({ image, number }: { image: GalleryImage; number: number }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  if (state === "failed") {
    return <GalleryMessage>暂时无法加载预览</GalleryMessage>;
  }
  return (
    <>
      {state === "loading" && (
        <p className="resource-gallery-message" role="status">正在加载预览…</p>
      )}
      <img
        src={image.url}
        alt={image.title || `预览 ${number}`}
        referrerPolicy="no-referrer"
        style={{ visibility: state === "ready" ? "visible" : "hidden" }}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
    </>
  );
}

function GalleryMessage({ children }: { children: string }) {
  return (
    <p className="resource-gallery-message" role="status">
      <ImageOff size={24} aria-hidden="true" />
      {children}
    </p>
  );
}

export function ResourceGallery({ images }: { images: GalleryImage[] }) {
  const [index, setIndex] = useState(0);
  const image = images[index];

  return (
    <section className="resource-gallery" aria-label="项目预览">
      <div className="resource-gallery-frame">
        {image ? (
          <Screenshot
            key={`${index}:${image.url}`}
            image={image}
            number={index + 1}
          />
        ) : (
          <GalleryMessage>暂无预览</GalleryMessage>
        )}
      </div>
      {images.length > 1 && (
        <div className="resource-gallery-controls">
          <Button
            type="button"
            aria-label="上一张"
            onClick={() =>
              setIndex((current) => (current + images.length - 1) % images.length)
            }
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <span aria-live="polite">{index + 1} / {images.length}</span>
          <Button
            type="button"
            aria-label="下一张"
            onClick={() => setIndex((current) => (current + 1) % images.length)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
