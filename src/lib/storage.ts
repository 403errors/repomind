/**
 * Smart localStorage management for conversation persistence
 * Implements 10MB limit with automatic cleanup of oldest conversations
 */

export interface Message {
    id: string;
    role: 'user' | 'model';
    content: string;
    relevantFiles?: string[];
}

interface StoredConversation {
    owner: string;
    repo: string;
    messages: Message[];
    timestamp: number;
}

const MB = 1024 * 1024;
const MAX_STORAGE = 10 * MB; // 10MB limit
const TARGET_SIZE = 8 * MB; // Clean up to 8MB (leave buffer)
const STORAGE_PREFIX = 'repomind_chat_';
const PROFILE_PREFIX = 'repomind_profile_';

/**
 * Save conversation to localStorage with auto-cleanup
 */
export function saveConversation(owner: string, repo: string, messages: Message[]): void {
    try {
        // Check storage size before saving
        const currentSize = getStorageSize();
        if (currentSize > MAX_STORAGE) {
            console.log('Storage limit reached, cleaning up...');
            cleanupOldConversations(TARGET_SIZE);
        }

        const key = `${STORAGE_PREFIX}${owner}_${repo}`;
        const data: StoredConversation = {
            owner,
            repo,
            messages,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(data));
    } catch (e: any) {
        if (e.name === 'QuotaExceededError') {
            console.warn('localStorage quota exceeded, forcing cleanup...');
            // Force cleanup and retry
            cleanupOldConversations(TARGET_SIZE);
            try {
                const key = `${STORAGE_PREFIX}${owner}_${repo}`;
                const data: StoredConversation = {
                    owner,
                    repo,
                    messages,
                    timestamp: Date.now()
                };
                localStorage.setItem(key, JSON.stringify(data));
            } catch {
                console.error('localStorage full, cannot save conversation after cleanup');
            }
        } else {
            console.error('Failed to save conversation:', e);
        }
    }
}

/**
 * Load conversation from localStorage
 */
export function loadConversation(owner: string, repo: string): Message[] | null {
    try {
        const key = `${STORAGE_PREFIX}${owner}_${repo}`;
        const data = localStorage.getItem(key);
        if (!data) return null;

        const parsed: StoredConversation = JSON.parse(data);
        return parsed.messages;
    } catch (e) {
        console.error('Failed to load conversation:', e);
        return null;
    }
}

/**
 * Clear conversation from localStorage
 */
export function clearConversation(owner: string, repo: string): void {
    try {
        const key = `${STORAGE_PREFIX}${owner}_${repo}`;
        localStorage.removeItem(key);
    } catch (e) {
        console.error('Failed to clear conversation:', e);
    }
}

/**
 * Save profile conversation
 */
export function saveProfileConversation(username: string, messages: Message[]): void {
    try {
        const currentSize = getStorageSize();
        if (currentSize > MAX_STORAGE) {
            cleanupOldConversations(TARGET_SIZE);
        }

        const key = `${PROFILE_PREFIX}${username}`;
        const data = {
            username,
            messages,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(data));
    } catch (e: any) {
        if (e.name === 'QuotaExceededError') {
            cleanupOldConversations(TARGET_SIZE);
            try {
                const key = `${PROFILE_PREFIX}${username}`;
                localStorage.setItem(key, JSON.stringify({ username, messages, timestamp: Date.now() }));
            } catch {
                console.error('localStorage full after cleanup');
            }
        }
    }
}

/**
 * Load profile conversation
 */
export function loadProfileConversation(username: string): Message[] | null {
    try {
        const key = `${PROFILE_PREFIX}${username}`;
        const data = localStorage.getItem(key);
        if (!data) return null;

        const parsed = JSON.parse(data);
        return parsed.messages;
    } catch (e) {
        console.error('Failed to load profile conversation:', e);
        return null;
    }
}

/**
 * Clear profile conversation from localStorage
 */
export function clearProfileConversation(username: string): void {
    try {
        const key = `${PROFILE_PREFIX}${username}`;
        localStorage.removeItem(key);
    } catch (e) {
        console.error('Failed to clear profile conversation:', e);
    }
}

/**
 * Calculate total storage size used by RepoMind
 */
export function getStorageSize(): number {
    let total = 0;

    for (let key in localStorage) {
        if (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX)) {
            try {
                const value = localStorage[key];
                // UTF-16 uses 2 bytes per character
                total += (value.length + key.length) * 2;
            } catch (e) {
                // Invalid key, skip it
            }
        }
    }

    return total;
}

/**
 * Format storage size for display
 */
export function formatStorageSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * Clean up old conversations to reach target size
 */
function cleanupOldConversations(targetSize: number): void {
    const conversations: Array<{ key: string; timestamp: number; size: number }> = [];

    // Collect all conversations
    for (let key in localStorage) {
        if (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX)) {
            try {
                const data = JSON.parse(localStorage[key]);
                const size = (localStorage[key].length + key.length) * 2;
                conversations.push({
                    key,
                    timestamp: data.timestamp || 0,
                    size
                });
            } catch (e) {
                // Invalid data, delete it
                localStorage.removeItem(key);
            }
        }
    }

    // Sort by timestamp (oldest first)
    conversations.sort((a, b) => a.timestamp - b.timestamp);

    // Delete oldest conversations until we're under target size
    let currentSize = getStorageSize();
    let deletedCount = 0;

    for (const conv of conversations) {
        if (currentSize <= targetSize) break;

        localStorage.removeItem(conv.key);
        currentSize -= conv.size;
        deletedCount++;
    }

    if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old conversations, freed ${formatStorageSize(getStorageSize() - currentSize)}`);
    }
}

/**
 * Get all conversation keys
 */
export function getAllConversationKeys(): string[] {
    const keys: string[] = [];
    for (let key in localStorage) {
        if (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX)) {
            keys.push(key);
        }
    }
    return keys;
}

/**
 * Get storage statistics
 */
export function getStorageStats(): {
    used: number;
    available: number;
    conversations: number;
    percentage: number;
} {
    const used = getStorageSize();
    const conversations = getAllConversationKeys().length;

    return {
        used,
        available: MAX_STORAGE - used,
        conversations,
        percentage: (used / MAX_STORAGE) * 100
    };
}
