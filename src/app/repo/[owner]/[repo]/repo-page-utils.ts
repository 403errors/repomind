const README_PREVIEW_MAX_CHARS = 20_000;

export function normalizeReadmeForPreview(readmeContent: string | null | undefined): string {
    const normalized = (readmeContent || "").replace(
        /^(#\s+.*?)(?:&middot;|<br>|\s)*(\[!\[|!\[)/m,
        "$1\n\n$2"
    );

    if (normalized.length <= README_PREVIEW_MAX_CHARS) {
        return normalized;
    }

    return `${normalized.slice(0, README_PREVIEW_MAX_CHARS)}\n\n_...truncated for preview_`;
}
