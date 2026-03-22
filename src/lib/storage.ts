import type { ChatRole, StoredMessage } from "@/lib/chat-types";

export type Message = StoredMessage;

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
const CHAT_ROLES = new Set<ChatRole>(["user", "model"]);
const cloudMutationTails = new Map<string, Promise<void>>();

function getRepoStorageKey(owner: string, repo: string): string {
    return `${STORAGE_PREFIX}${owner}_${repo}`;
}

function getProfileStorageKey(username: string): string {
    return `${PROFILE_PREFIX}${username}`;
}

function getRepoCloudKey(owner: string, repo: string): string {
    return `repo:${owner}:${repo}`;
}

function getProfileCloudKey(username: string): string {
    return `profile:${username}`;
}

function enqueueCloudMutation<T>(conversationKey: string, mutation: () => Promise<T>): Promise<T> {
    const previousTail = cloudMutationTails.get(conversationKey) ?? Promise.resolve();
    const next = previousTail.catch(() => undefined).then(mutation);
    const tail = next.then(() => undefined, () => undefined);

    cloudMutationTails.set(conversationKey, tail);
    void tail.finally(() => {
        if (cloudMutationTails.get(conversationKey) === tail) {
            cloudMutationTails.delete(conversationKey);
        }
    });

    return next;
}

function isRole(value: unknown): value is ChatRole {
    return typeof value === "string" && CHAT_ROLES.has(value as ChatRole);
}

function normalizeMessage(raw: unknown): Message | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const candidate = raw as Partial<Message>;
    if (typeof candidate.id !== "string") {
        return null;
    }
    if (!isRole(candidate.role)) {
        return null;
    }
    if (typeof candidate.content !== "string") {
        return null;
    }

    return {
        ...candidate,
        id: candidate.id,
        role: candidate.role,
        content: candidate.content,
        relevantFiles: Array.isArray(candidate.relevantFiles)
            ? candidate.relevantFiles.filter((file): file is string => typeof file === "string")
            : undefined,
    };
}

function normalizeMessages(rawMessages: unknown): Message[] {
    if (!Array.isArray(rawMessages)) {
        return [];
    }

    return rawMessages
        .map(normalizeMessage)
        .filter((message): message is Message => Boolean(message))
        .filter((message) => !isStaleEmptyModelPlaceholder(message));
}

function hasNonEmptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function hasNonEmptyString(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

function hasMeaningfulModelPayload(message: Message): boolean {
    const candidate = message as Record<string, unknown>;

    return (
        hasNonEmptyArray(candidate.reasoningSteps) ||
        hasNonEmptyArray(candidate.relevantFiles) ||
        hasNonEmptyArray(candidate.vulnerabilities) ||
        hasNonEmptyArray(candidate.toolsUsed) ||
        hasNonEmptyArray(candidate.processingSummary) ||
        hasNonEmptyString(candidate.scanStatus) ||
        hasNonEmptyString(candidate.scanId) ||
        hasNonEmptyString(candidate.commitFreshnessLabel) ||
        hasNonEmptyString(candidate.sourceScope) ||
        candidate.isQuickSecurityScan === true
    );
}

function isStaleEmptyModelPlaceholder(message: Message): boolean {
    if (message.role !== "model") {
        return false;
    }

    if (message.content.trim().length > 0) {
        return false;
    }

    return !hasMeaningfulModelPayload(message);
}

/**
 * Save conversation to localStorage with auto-cleanup (and optionally cloud storage)
 */
export async function saveConversation(owner: string, repo: string, messages: Message[], useCloudStorage = false): Promise<void> {
    try {
        if (useCloudStorage) {
            await enqueueCloudMutation(getRepoCloudKey(owner, repo), async () => {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner, repo, messages })
                });

                if (!response.ok) {
                    console.error('Failed to sync to cloud:', response.status, response.statusText);
                }
            }).catch(err => console.error('Failed to sync to cloud:', err));
        }

        // Always save locally as fallback/cache
        const currentSize = getStorageSize();
        if (currentSize > MAX_STORAGE) {
            console.log('Storage limit reached, cleaning up...');
            cleanupOldConversations(TARGET_SIZE);
        }

        const key = getRepoStorageKey(owner, repo);
        const data: StoredConversation = {
            owner,
            repo,
            messages,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(data));
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
            console.warn('localStorage quota exceeded, forcing cleanup...');
            cleanupOldConversations(TARGET_SIZE);
            try {
                const key = getRepoStorageKey(owner, repo);
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
 * Load conversation from localStorage (or cloud if specified)
 */
export async function loadConversation(owner: string, repo: string, useCloudStorage = false): Promise<Message[] | null> {
    try {
        const key = getRepoStorageKey(owner, repo);

        if (useCloudStorage) {
            try {
                const response = await fetch(`/api/chat?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
                if (response.ok) {
                    const data = await response.json();
                    const normalizedCloudMessages = normalizeMessages(data.messages);
                    if (normalizedCloudMessages.length > 0) {
                        // Update local cache
                        void saveConversation(owner, repo, normalizedCloudMessages, false);
                        return normalizedCloudMessages;
                    }

                    // Successful cloud response with no messages is authoritative.
                    localStorage.removeItem(key);
                    return null;
                }
            } catch (err) {
                console.error('Failed to load from cloud, falling back to local:', err);
            }
        }

        const data = localStorage.getItem(key);
        if (!data) return null;

        const parsed = JSON.parse(data) as StoredConversation;
        const normalizedMessages = normalizeMessages(parsed.messages);
        return normalizedMessages.length > 0 ? normalizedMessages : null;
    } catch (e) {
        console.error('Failed to load conversation:', e);
        return null;
    }
}

/**
 * Clear conversation from localStorage
 */
export async function clearConversation(owner: string, repo: string, useCloudStorage = false): Promise<void> {
    try {
        if (useCloudStorage) {
            await enqueueCloudMutation(getRepoCloudKey(owner, repo), async () => {
                const response = await fetch(`/api/chat?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    console.error('Failed to clear from cloud:', response.status, response.statusText);
                }
            }).catch(err => console.error('Failed to clear from cloud:', err));
        }
        const key = getRepoStorageKey(owner, repo);
        localStorage.removeItem(key);
    } catch (e) {
        console.error('Failed to clear conversation:', e);
    }
}

/**
 * Save profile conversation
 */
export async function saveProfileConversation(username: string, messages: Message[], useCloudStorage = false): Promise<void> {
    try {
        if (useCloudStorage) {
            await enqueueCloudMutation(getProfileCloudKey(username), async () => {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, messages })
                });

                if (!response.ok) {
                    console.error('Failed to sync profile chat to cloud:', response.status, response.statusText);
                }
            }).catch(err => console.error('Failed to sync profile chat to cloud:', err));
        }

        const currentSize = getStorageSize();
        if (currentSize > MAX_STORAGE) {
            cleanupOldConversations(TARGET_SIZE);
        }

        const key = getProfileStorageKey(username);
        const data = {
            username,
            messages,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(data));
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
            cleanupOldConversations(TARGET_SIZE);
            try {
                const key = getProfileStorageKey(username);
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
export async function loadProfileConversation(username: string, useCloudStorage = false): Promise<Message[] | null> {
    try {
        const key = getProfileStorageKey(username);

        if (useCloudStorage) {
            try {
                const response = await fetch(`/api/chat?username=${encodeURIComponent(username)}`);
                if (response.ok) {
                    const data = await response.json();
                    const normalizedCloudMessages = normalizeMessages(data.messages);
                    if (normalizedCloudMessages.length > 0) {
                        void saveProfileConversation(username, normalizedCloudMessages, false);
                        return normalizedCloudMessages;
                    }

                    // Successful cloud response with no messages is authoritative.
                    localStorage.removeItem(key);
                    return null;
                }
            } catch (err) {
                console.error('Failed to load profile from cloud, falling back to local:', err);
            }
        }

        const data = localStorage.getItem(key);
        if (!data) return null;

        const parsed = JSON.parse(data) as { messages?: unknown };
        const normalizedMessages = normalizeMessages(parsed.messages);
        return normalizedMessages.length > 0 ? normalizedMessages : null;
    } catch (e) {
        console.error('Failed to load profile conversation:', e);
        return null;
    }
}

/**
 * Clear profile conversation from localStorage
 */
export async function clearProfileConversation(username: string, useCloudStorage = false): Promise<void> {
    try {
        if (useCloudStorage) {
            await enqueueCloudMutation(getProfileCloudKey(username), async () => {
                const response = await fetch(`/api/chat?username=${encodeURIComponent(username)}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    console.error('Failed to clear profile chat from cloud:', response.status, response.statusText);
                }
            }).catch(err => console.error('Failed to clear profile chat from cloud:', err));
        }
        const key = getProfileStorageKey(username);
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

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX))) {
            try {
                const value = localStorage.getItem(key) || "";
                total += (value.length + key.length) * 2;
            } catch {
                // Invalid key
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

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX))) {
            try {
                const value = localStorage.getItem(key) || "";
                const data = JSON.parse(value);
                const size = (value.length + key.length) * 2;
                conversations.push({
                    key,
                    timestamp: data.timestamp || 0,
                    size
                });
            } catch {
                localStorage.removeItem(key);
            }
        }
    }

    conversations.sort((a, b) => a.timestamp - b.timestamp);

    let currentSize = getStorageSize();
    let deletedCount = 0;

    for (const conv of conversations) {
        if (currentSize <= targetSize) break;

        localStorage.removeItem(conv.key);
        currentSize -= conv.size;
        deletedCount++;
    }

    if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old conversations`);
    }
}

/**
 * Get all conversation keys
 */
export function getAllConversationKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(PROFILE_PREFIX))) {
            keys.push(key);
        }
    }
    return keys;
}

/**
 * Get storage stats
 */
export function getStorageStats(): { used: number; available: number; conversations: number; percentage: number } {
    const used = getStorageSize();
    const conversations = getAllConversationKeys().length;
    return {
        used,
        available: MAX_STORAGE - used,
        conversations,
        percentage: (used / MAX_STORAGE) * 100
    };
}
