interface RGBColor {
    r: number;
    g: number;
    b: number;
}

function clampChannel(value: number): number {
    return Math.max(0, Math.min(255, value));
}

function parseHexColor(value: string): RGBColor | null {
    const normalized = value.trim().toLowerCase();
    if (!normalized.startsWith("#")) return null;
    const raw = normalized.slice(1);

    if (/^[0-9a-f]{3}$/.test(raw)) {
        const r = Number.parseInt(`${raw[0]}${raw[0]}`, 16);
        const g = Number.parseInt(`${raw[1]}${raw[1]}`, 16);
        const b = Number.parseInt(`${raw[2]}${raw[2]}`, 16);
        return { r, g, b };
    }

    if (/^[0-9a-f]{6}$/.test(raw)) {
        const r = Number.parseInt(raw.slice(0, 2), 16);
        const g = Number.parseInt(raw.slice(2, 4), 16);
        const b = Number.parseInt(raw.slice(4, 6), 16);
        return { r, g, b };
    }

    return null;
}

function parseRgbColor(value: string): RGBColor | null {
    const match = /^\s*rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)/i.exec(value);
    if (!match) return null;

    const r = Number.parseFloat(match[1] ?? "");
    const g = Number.parseFloat(match[2] ?? "");
    const b = Number.parseFloat(match[3] ?? "");
    if ([r, g, b].some((channel) => !Number.isFinite(channel))) {
        return null;
    }

    return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

export function parseCssColorToRgb(value: string): RGBColor | null {
    return parseHexColor(value) ?? parseRgbColor(value);
}

function toLinear(channel: number): number {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(color: string): number | null {
    const rgb = parseCssColorToRgb(color);
    if (!rgb) return null;
    const r = toLinear(rgb.r);
    const g = toLinear(rgb.g);
    const b = toLinear(rgb.b);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

export function getContrastRatio(colorA: string, colorB: string): number | null {
    const lumA = getRelativeLuminance(colorA);
    const lumB = getRelativeLuminance(colorB);
    if (lumA === null || lumB === null) return null;
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
}

export function pickContrastingTextColor(backgroundColor: string, darkTextColor: string, lightTextColor: string): string {
    const darkContrast = getContrastRatio(backgroundColor, darkTextColor);
    const lightContrast = getContrastRatio(backgroundColor, lightTextColor);

    if (darkContrast === null && lightContrast === null) {
        return lightTextColor;
    }
    if (darkContrast === null) {
        return lightTextColor;
    }
    if (lightContrast === null) {
        return darkTextColor;
    }

    return darkContrast >= lightContrast ? darkTextColor : lightTextColor;
}
