import path from 'path';

// File extension categories
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.heic'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv', '.m4v', '.mpg', '.mpeg'];
const BINARY_EXTENSIONS = ['.exe', '.dll', '.so', '.dylib', '.bin', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.wasm'];
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];
const LARGE_DATA_EXTENSIONS = ['.csv', '.json', '.xml', '.sql', '.db', '.sqlite'];

// FileNode is the canonical domain type for git tree nodes — defined once in github.ts
import type { FileNode } from "@/lib/github";
export type { FileNode };


/**
 * Check if a file is an image
 */
export function isImageFile(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Check if a file is a video
 */
export function isVideoFile(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Check if a file is a binary file
 */
export function isBinaryFile(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase();
    return BINARY_EXTENSIONS.includes(ext) || FONT_EXTENSIONS.includes(ext);
}

/**
 * Get file category for analytics
 */
export function getFileCategory(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase();

    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (BINARY_EXTENSIONS.includes(ext)) return 'binary';
    if (FONT_EXTENSIONS.includes(ext)) return 'font';
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'javascript';
    if (['.py'].includes(ext)) return 'python';
    if (['.java'].includes(ext)) return 'java';
    if (['.css', '.scss', '.sass', '.less'].includes(ext)) return 'stylesheet';
    if (['.html', '.htm'].includes(ext)) return 'html';
    if (['.md', '.mdx'].includes(ext)) return 'markdown';
    if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) return 'config';

    return 'other';
}

/**
 * Main filtering logic - decides if a file should be skipped
 */
export function shouldSkipFile(node: FileNode): boolean {
    const filepath = node.path;
    const ext = path.extname(filepath).toLowerCase();
    const size = node.size || 0;

    // Skip files larger than 1MB
    if (size > 1_000_000) {
        return true;
    }

    // Skip all video files regardless of size
    if (isVideoFile(filepath)) {
        return true;
    }

    // Skip images larger than 500KB
    if (isImageFile(filepath) && size > 500_000) {
        return true;
    }

    // Skip binary files
    if (isBinaryFile(filepath)) {
        return true;
    }

    // Skip lock files
    if (ext === '.lock' || filepath.endsWith('package-lock.json') || filepath.endsWith('yarn.lock')) {
        return true;
    }

    // Skip minified files
    if (filepath.endsWith('.min.js') || filepath.endsWith('.min.css')) {
        return true;
    }

    return false;
}

/**
 * Get file tree statistics
 */
export function getFileTreeStats(nodes: FileNode[]): {
    total: number;
    byCategory: Record<string, number>;
    totalSize: number;
    skipped: number;
} {
    const stats = {
        total: nodes.length,
        byCategory: {} as Record<string, number>,
        totalSize: 0,
        skipped: 0,
    };

    nodes.forEach(node => {
        if (node.type === 'blob') {
            const category = getFileCategory(node.path);
            stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
            stats.totalSize += node.size || 0;

            if (shouldSkipFile(node)) {
                stats.skipped++;
            }
        }
    });

    return stats;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
