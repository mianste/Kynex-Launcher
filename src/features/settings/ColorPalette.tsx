import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { normalizeHexColor } from "../../lib/appearance";
import "./color-palette.css";

function toHsl(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const light = (max + min) / 2;
  if (!delta) return { hue: 0, saturation: 0, lightness: light * 100 };
  const sector =
    max === red
      ? (green - blue) / delta
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: (delta / (1 - Math.abs(2 * light - 1))) * 100,
    lightness: light * 100,
  };
}

function toHex({ hue, saturation, lightness }: ReturnType<typeof toHsl>) {
  const light = lightness / 100;
  const chroma = (saturation / 100) * Math.min(light, 1 - light);
  const channel = (offset: number) => {
    const sector = (offset + hue / 30) % 12;
    const value =
      light - chroma * Math.max(-1, Math.min(sector - 3, 9 - sector, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function ColorPalette({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const applied = normalizeHexColor(value) ?? "#3d7c88";
  const [draft, setDraft] = useState(applied);
  const [hsl, setHsl] = useState(() => toHsl(applied));
  const valid = normalizeHexColor(draft);
  useEffect(() => {
    setDraft(applied);
    setHsl(toHsl(applied));
  }, [applied]);

  return (
    <details className="color-palette">
      <summary aria-label={`调${label}`}>
        <span className="color-sample" style={{ backgroundColor: applied }} />
        <span>{applied.toUpperCase()}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div
        className="color-palette-editor"
        style={{ "--palette-hue": hsl.hue } as CSSProperties}
      >
        {(
          [
            ["hue", "色相", 360],
            ["saturation", "浓淡", 100],
            ["lightness", "明暗", 100],
          ] as const
        ).map(([field, name, max]) => (
          <label key={field}>
            <span>{name}</span>
            <input
              type="range"
              className={`color-range ${field}`}
              min={0}
              max={max}
              value={Math.round(hsl[field])}
              aria-label={`${label}${name}`}
              onChange={(event) => {
                const next = {
                  ...hsl,
                  [field]: Number(event.currentTarget.value),
                };
                setHsl(next);
                setDraft(toHex(next));
              }}
            />
            <span>
              {Math.round(hsl[field])}
              {field === "hue" ? "°" : "%"}
            </span>
          </label>
        ))}
        <div className="color-palette-apply">
          <span
            className="color-sample"
            style={{ backgroundColor: valid ?? applied }}
            aria-label="颜色预览"
          />
          <Input
            aria-label={`${label}色号`}
            aria-invalid={!!draft && !valid}
            value={draft}
            maxLength={7}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setDraft(next);
              const hex = normalizeHexColor(next);
              if (hex) setHsl(toHsl(hex));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid) onChange(valid);
            }}
          />
          <Button
            type="button"
            disabled={!valid || valid === applied}
            onClick={() => valid && onChange(valid)}
          >
            应用颜色
          </Button>
        </div>
      </div>
    </details>
  );
}
