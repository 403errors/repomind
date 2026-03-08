export const SECURITY_SCAN_FILE_LIMITS = {
    quick: 20,
    deep: 60,
} as const;

export const SECURITY_ENGINE_VERSION = "scan-engine-v2";
export const SECURITY_CACHE_KEY_VERSION = "v2";

export const DEFAULT_CONFIDENCE_THRESHOLD = {
    quick: 0.78,
    deep: 0.68,
} as const;
