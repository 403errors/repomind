"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "repomind_github_pat";

export type TokenMode = "server" | "personal";

export interface GitHubTokenState {
  token: string | null;
  mode: TokenMode;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export function useGitHubToken(): GitHubTokenState {
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setTokenState(stored);
    } catch {}
  }, []);

  const setToken = useCallback((newToken: string) => {
    const trimmed = newToken.trim();
    try {
      if (trimmed) {
        localStorage.setItem(STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
    setTokenState(trimmed || null);
  }, []);

  const clearToken = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setTokenState(null);
  }, []);

  return {
    token,
    mode: token ? "personal" : "server",
    setToken,
    clearToken,
  };
}
