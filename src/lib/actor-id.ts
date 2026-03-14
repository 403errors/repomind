import { createHash } from "node:crypto";

function firstHeaderValue(raw: string | null): string {
    if (!raw) return "unknown";
    const first = raw.split(",")[0]?.trim();
    return first && first.length > 0 ? first : "unknown";
}

export function getAnonymousActorId(headers: Headers): string {
    const ip = firstHeaderValue(
        headers.get("x-forwarded-for") ??
        headers.get("x-real-ip") ??
        headers.get("cf-connecting-ip")
    );
    const userAgent = headers.get("user-agent") ?? "unknown";
    const payload = `${ip}|${userAgent}`;
    const hash = createHash("sha256").update(payload).digest("hex").slice(0, 24);
    return `anon_${hash}`;
}
