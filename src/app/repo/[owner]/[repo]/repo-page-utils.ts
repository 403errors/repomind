export function normalizeReadmeForPreview(readmeContent: string | null | undefined): string {
    return (readmeContent || "").replace(
        /^(#\s+.*?)(?:&middot;|<br>|\s)*(\[!\[|!\[)/m,
        "$1\n\n$2"
    );
}
