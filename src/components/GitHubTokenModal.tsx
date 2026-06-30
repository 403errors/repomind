"use client";

import { useState, useRef, useEffect } from "react";
import { X, Key, Eye, EyeOff, CheckCircle, AlertCircle, Trash2, ExternalLink } from "lucide-react";

interface GitHubTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentToken: string | null;
  onSave: (token: string) => void;
  onClear: () => void;
}

type ValidationState = "idle" | "validating" | "valid" | "invalid";

export function GitHubTokenModal({
  isOpen,
  onClose,
  currentToken,
  onSave,
  onClear,
}: GitHubTokenModalProps) {
  const [value, setValue] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validation, setValidation] = useState<ValidationState>("idle");
  const [validatedUser, setValidatedUser] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue("");
      setValidation("idle");
      setValidatedUser(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleValidate = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValidation("validating");
    setValidatedUser(null);
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.ok) {
        const data = await res.json();
        setValidatedUser(data.login ?? "unknown");
        setValidation("valid");
      } else {
        setValidation("invalid");
      }
    } catch {
      setValidation("invalid");
    }
  };

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed || validation !== "valid") return;
    onSave(trimmed);
    setValue("");
    onClose();
  };

  const handleClear = () => {
    onClear();
    setValue("");
    setValidation("idle");
    setValidatedUser(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && validation === "idle") handleValidate();
    if (e.key === "Enter" && validation === "valid") handleSave();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden flex flex-col relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="p-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20">
            <Key className="w-6 h-6 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Use your GitHub token</h2>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            Paste a <a href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=RepoMind" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">Personal Access Token <ExternalLink className="w-3 h-3 ml-0.5" /></a>{" "}
            to remove rate limits and access private repositories. Your token is stored only in this browser — never logged or sent to our servers.
          </p>
          {currentToken && (
            <div className="mb-4 flex items-center justify-between px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <span className="text-sm text-emerald-400 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Token active
              </span>
              <button
                onClick={handleClear}
                className="text-xs text-zinc-400 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            </div>
          )}
          <div className="relative mb-3">
            <input
              ref={inputRef}
              type={showToken ? "text" : "password"}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setValidation("idle");
                setValidatedUser(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={currentToken ? "Paste new token to replace…" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
              className="w-full px-4 py-3 pr-12 bg-zinc-800 border border-white/10 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {validation === "validating" && (
            <p className="text-xs text-zinc-400 mb-3 flex items-center gap-1.5">
              <span className="w-3 h-3 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
              Verifying token…
            </p>
          )}
          {validation === "valid" && validatedUser && (
            <p className="text-xs text-emerald-400 mb-3 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              Authenticated as <strong>{validatedUser}</strong>
            </p>
          )}
          {validation === "invalid" && (
            <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Token invalid or missing required scopes
            </p>
          )}
          <div className="flex gap-2">
            {validation !== "valid" ? (
              <button
                onClick={handleValidate}
                disabled={!value.trim() || validation === "validating"}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-white text-sm font-medium hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Verify token
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all shadow-lg shadow-emerald-900/30"
              >
                Save and use this token
              </button>
            )}
          </div>
          <p className="mt-4 text-xs text-zinc-600 leading-relaxed">
            Minimum required scope:{" "}
            <code className="text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded">public_repo</code>
            {" "}for public repos.{" "}
            <code className="text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded">repo</code>
            {" "}for private access.
          </p>
        </div>
      </div>
    </div>
  );
}
