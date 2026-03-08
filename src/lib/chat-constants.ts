import { SECURITY_SCAN_FILE_LIMITS } from "@/lib/security-scan-config";

export const INITIAL_PROMPT_DELAY_MS = 300;
export const COPY_FEEDBACK_MS = 1500;
export const MAX_FINDINGS_PREVIEW = 5;
export const QUICK_SCAN_FILE_LIMIT = SECURITY_SCAN_FILE_LIMITS.quick;
export const DEEP_SCAN_FILE_LIMIT = SECURITY_SCAN_FILE_LIMITS.deep;

export const QUICK_SCAN_PROMPT = "Find security vulnerabilities";
export const DEEP_SCAN_PROMPT = "Run deep security scan";
export const ARCHITECTURE_PROMPT = "Explain the architecture";
