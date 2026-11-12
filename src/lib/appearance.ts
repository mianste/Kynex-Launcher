export function normalizeUiOpacity(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 100;
}


export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const hex = value.trim().replace(/^#/, "");
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : undefined;
}

export function colorInk(hex: string): "#000000" | "#ffffff" {
  const [red, green, blue] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.179 ? "#000000" : "#ffffff";
}
