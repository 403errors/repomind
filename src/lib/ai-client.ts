/**
 * Unified Gemini AI client factory.
 *
 * Single source of truth for API key validation and model configuration.
 * All AI calls in the codebase must go through this module — never
 * instantiate GoogleGenerativeAI directly in feature code.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

let _genAI: GoogleGenerativeAI | null = null;

/**
 * Returns a lazy-initialized GoogleGenerativeAI singleton.
 * Throws a clear, actionable error at call time if the API key is missing,
 * rather than passing an empty string and getting a silent 401.
 */
export function getGenAI(): GoogleGenerativeAI {
    if (_genAI) return _genAI;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error(
            "[RepoMind] GEMINI_API_KEY environment variable is not set. " +
            "Add it to your .env.local file or deployment environment secrets."
        );
    }

    _genAI = new GoogleGenerativeAI(apiKey);
    return _genAI;
}

/** Default model for all general-purpose AI tasks (chat, analysis, generation) */
export const DEFAULT_MODEL = "gemini-3-flash-preview";

/** Lightweight model — cheaper & faster, used for quick classification tasks */
export const FAST_MODEL = "gemini-2.5-flash-lite";
