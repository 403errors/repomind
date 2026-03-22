import {
  getGenAI,
  DEFAULT_MODEL,
  FILE_SELECTOR_MODEL,
  getChatModelForPreference,
  type ModelPreference,
} from "./ai-client";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { buildRepoMindPrompt, formatHistoryText } from "./prompt-builder";
import { cacheQuerySelection, getCachedQuerySelection } from "./cache";
import type { FileCachePolicy } from "./cache";
import type { GitHubProfile } from "./github";
import { stripEmojiCharacters } from "./no-emoji";
import {
  getRecentRepoCommitsSnapshot,
  getUserRepos,
  getUserReposByAge,
  getRepoReleasesSnapshot,
  getRepoPullRequestsSnapshot,
  getRepoIssuesSnapshot,
  getRepoCommitFrequencySnapshot,
  getRepoContributorsSnapshot,
  getRepoFileHistorySnapshot,
  compareRepoRefsSnapshot,
  getRepoWorkflowRunsSnapshot,
  getRepoLanguagesSnapshot,
  getRepoDependencyAlertsSnapshot,
} from "./github";
import type { GenerationConfig } from "@google/generative-ai";

type JsonObject = Record<string, unknown>;
type GeminiTool = Record<string, unknown>;
type ChunkPart = { text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown }; [key: string]: unknown };
type FunctionCallShape = { name?: string; args?: unknown };
type StreamChunkShape = {
  candidates?: Array<{
    content?: {
      parts?: ChunkPart[];
    };
    groundingMetadata?: {
      webSearchQueries?: string[];
    };
  }>;
};

const MAX_REPO_COMMITS = 10;
const MAX_PROFILE_COMMITS = 20;
const SUPPORT_EMAIL = "pieisnot22by7@gmail.com";
const MAX_GITHUB_CALLS_PER_FUNCTION = 2;
const PROFILE_REPO_SAMPLE_SIZE = 1;
let _modernGenAI: GoogleGenAI | null = null;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function getModernGenAI(): GoogleGenAI {
  if (_modernGenAI) return _modernGenAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[RepoMind] GEMINI_API_KEY environment variable is not set. " +
      "Add it to your .env.local file or deployment environment secrets."
    );
  }
  _modernGenAI = new GoogleGenAI({ apiKey });
  return _modernGenAI;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeFunctionName(name: unknown): string {
  return typeof name === "string" && name.trim().length > 0 ? name : "unknown_tool";
}

function resolveRepositoryForTool(
  repositoryArg: unknown,
  repoDetails: { owner: string; repo: string }
): { owner: string; repo: string } | null {
  const repository = typeof repositoryArg === "string" ? repositoryArg.trim() : "";
  if (repository.includes("/")) {
    const [owner, repo] = repository.split("/", 2);
    if (owner && repo) return { owner, repo };
  }
  if (repository) {
    return { owner: repoDetails.owner, repo: repository };
  }
  if (repoDetails.repo && repoDetails.repo !== "profile") {
    return { owner: repoDetails.owner, repo: repoDetails.repo };
  }
  return null;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.min(fallback, max);
  return Math.max(1, Math.min(Math.floor(n), max));
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildGitHubCallPolicy(options: {
  functionName: string;
  callsUsed: number;
  sampledRepositories?: string[];
  totalCandidateRepositories?: number;
}): {
  functionName: string;
  maxConsecutiveCalls: number;
  callsUsed: number;
  limitedByCap: boolean;
  sampledRepositories: string[];
  note?: string;
} {
  const sampledRepositories = (options.sampledRepositories ?? []).filter((repo) => repo.length > 0);
  const callsUsed = clampNumber(options.callsUsed, 0, MAX_GITHUB_CALLS_PER_FUNCTION);
  const totalCandidateRepositories = options.totalCandidateRepositories;
  const limitedByCap = typeof totalCandidateRepositories === "number" && totalCandidateRepositories > sampledRepositories.length;

  const note = limitedByCap
    ? `Transparency: ${options.functionName} was limited to ${MAX_GITHUB_CALLS_PER_FUNCTION} consecutive GitHub API calls, so this answer is based on sampled repository data (${sampledRepositories.join(", ")}).`
    : undefined;

  return {
    functionName: options.functionName,
    maxConsecutiveCalls: MAX_GITHUB_CALLS_PER_FUNCTION,
    callsUsed,
    limitedByCap,
    sampledRepositories,
    note,
  };
}

function withGitHubCallPolicy(
  functionResponseData: Record<string, unknown>,
  policy: ReturnType<typeof buildGitHubCallPolicy>
): Record<string, unknown> {
  return {
    ...functionResponseData,
    githubCallPolicy: policy,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFunctionTurnOrderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /function response turn comes immediately after a function call turn/i.test(message);
}

function isMissingThoughtSignatureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /missing a thought_signature|thought_signature/i.test(message);
}

function extractFunctionCallPartsFromResponse(response: unknown): Array<Record<string, unknown>> {
  const root = asObject(response);
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  if (candidates.length === 0) return [];
  const firstCandidate = asObject(candidates[0]);
  const content = asObject(firstCandidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
    .filter((part) => {
      const maybeFunctionCall = (part as JsonObject).functionCall;
      return !!maybeFunctionCall && typeof maybeFunctionCall === "object";
    });
}

function extractFunctionCallsFromParts(parts: Array<Record<string, unknown>>): FunctionCallShape[] {
  const calls: FunctionCallShape[] = [];
  for (const part of parts) {
    const maybeFunctionCall = asObject((part as JsonObject).functionCall);
    if (typeof maybeFunctionCall.name === "string" && maybeFunctionCall.name.trim().length > 0) {
      calls.push({
        name: maybeFunctionCall.name,
        args: maybeFunctionCall.args,
      });
    }
  }
  return calls;
}

function readFunctionCalls(response: unknown): FunctionCallShape[] {
  const responseObj = asObject(response) as {
    functionCalls?: unknown;
  };
  const direct = responseObj.functionCalls;
  if (Array.isArray(direct)) {
    const calls: FunctionCallShape[] = [];
    for (const item of direct) {
      const normalized = asObject(item);
      if (typeof normalized.name === "string" && normalized.name.trim().length > 0) {
        calls.push({ name: normalized.name, args: normalized.args });
      }
    }
    return calls;
  }

  const maybeFn = (responseObj as { functionCalls?: (() => unknown) }).functionCalls;
  if (typeof maybeFn === "function") {
    const fnValue = maybeFn();
    if (Array.isArray(fnValue)) {
      const calls: FunctionCallShape[] = [];
      for (const item of fnValue) {
        const normalized = asObject(item);
        if (typeof normalized.name === "string" && normalized.name.trim().length > 0) {
          calls.push({ name: normalized.name, args: normalized.args });
        }
      }
      return calls;
    }
  }
  return [];
}

function readResponseText(response: unknown): string {
  const value = (response as { text?: unknown }).text;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "function") {
    const text = value();
    return typeof text === "string" ? text : "";
  }
  return "";
}

function serializeCallKey(call: FunctionCallShape): string {
  const args = asObject(call.args);
  return `${normalizeFunctionName(call.name)}::${JSON.stringify(args)}`;
}

function getThinkingLevel(modelPreference: ModelPreference): ThinkingLevel {
  return modelPreference === "thinking" ? ThinkingLevel.HIGH : ThinkingLevel.LOW;
}

async function recoverWithModernChat(
  prompt: string,
  modelName: string,
  tools: GeminiTool[],
  modelPreference: ModelPreference,
  repoDetails: { owner: string; repo: string },
  baselineCalls: FunctionCallShape[],
  baselineResponses: Array<{ functionResponseData: Record<string, unknown> }>
): Promise<string> {
  const baselineResponseByCall = new Map<string, { functionResponseData: Record<string, unknown> }[]>();
  baselineCalls.forEach((call, index) => {
    const key = serializeCallKey(call);
    const existing = baselineResponseByCall.get(key) ?? [];
    existing.push(baselineResponses[index]);
    baselineResponseByCall.set(key, existing);
  });

  const chat = getModernGenAI().chats.create({
    model: modelName,
    config: {
      tools: tools as unknown as Array<Record<string, unknown>>,
      thinkingConfig: {
        includeThoughts: modelPreference === "thinking",
        thinkingLevel: getThinkingLevel(modelPreference),
      },
    },
  });

  let response = await chat.sendMessage({ message: prompt });
  let pendingCalls = readFunctionCalls(response);
  let guard = 0;

  while (pendingCalls.length > 0 && guard < 4) {
    const resolved = await Promise.all(pendingCalls.map(async (call) => {
      const key = serializeCallKey(call);
      const fromBaseline = baselineResponseByCall.get(key)?.shift();
      if (fromBaseline) {
        return fromBaseline;
      }
      return resolveToolCall(call, repoDetails);
    }));

    const toolResponseParts = buildFunctionResponseParts(pendingCalls, resolved);
    response = await chat.sendMessage({
      message: toolResponseParts as unknown as Array<Record<string, unknown>>,
    });
    pendingCalls = readFunctionCalls(response);
    guard += 1;
  }

  return stripEmojiCharacters(readResponseText(response).trim());
}

function buildFunctionResponseParts(
  calls: FunctionCallShape[],
  responses: Array<{ functionResponseData: Record<string, unknown> }>
) {
  return calls.map((call, index) => {
    const name = normalizeFunctionName(call.name);
    return {
      functionResponse: {
        name,
        response: {
          name,
          content: responses[index].functionResponseData,
        },
      },
    };
  });
}

function countFunctionDeclarations(tools: GeminiTool[]): number {
  return tools.reduce((count, tool) => {
    const declarations = (tool as { functionDeclarations?: unknown }).functionDeclarations;
    return count + (Array.isArray(declarations) ? declarations.length : 0);
  }, 0);
}

function buildGithubFunctionDeclarations(repoDetails: { owner: string; repo: string }) {
  const isProfileContext = repoDetails.repo === "profile";
  const commitLimitDescription = isProfileContext
    ? "Commit limit (MAX 20 for overall, 10 for specific repo)."
    : "Commit limit (MAX 10).";

  return [
    {
      name: "fetch_recent_commits",
      description: "Fetch recent commits. Provide a specific repository name, or leave empty (or use 'overall') for commits across all repositories.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository name for repo-specific commits." },
          limit: { type: "NUMBER", description: commitLimitDescription },
        }
      }
    },
    {
      name: "fetch_repos_by_age",
      description: "Fetch repositories by age mode: oldest, newest, or journey (even spacing).",
      parameters: {
        type: "OBJECT",
        properties: {
          mode: { type: "STRING", description: "oldest | newest | journey" },
        }
      }
    },
    {
      name: "fetch_repo_releases",
      description: "Fetch release history for a repository.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          limit: { type: "NUMBER", description: "Release limit (MAX 20)." },
        }
      }
    },
    {
      name: "fetch_pull_requests",
      description: "Fetch pull requests for repository activity analysis.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          state: { type: "STRING", description: "open | closed | all" },
          since: { type: "STRING", description: "Optional ISO date cutoff." },
          limit: { type: "NUMBER", description: "PR limit (MAX 30)." },
        }
      }
    },
    {
      name: "fetch_issue_activity",
      description: "Fetch issue activity for repository health analysis.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          state: { type: "STRING", description: "open | closed | all" },
          since: { type: "STRING", description: "Optional ISO date cutoff." },
          limit: { type: "NUMBER", description: "Issue limit (MAX 30)." },
        }
      }
    },
    {
      name: "fetch_commit_frequency",
      description: "Fetch weekly commit frequency (timeseries) for charts.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          weeks: { type: "NUMBER", description: "Weeks to return (MAX 52)." },
        }
      }
    },
    {
      name: "fetch_contributors",
      description: "Fetch top contributors for ownership and activity analysis.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          limit: { type: "NUMBER", description: "Contributor limit (MAX 30)." },
        }
      }
    },
    {
      name: "fetch_file_history",
      description: "Fetch commit history for a specific file path.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          path: { type: "STRING", description: "Repository file path (required)." },
          limit: { type: "NUMBER", description: "History limit (MAX 20)." },
        }
      }
    },
    {
      name: "compare_refs",
      description: "Compare two refs (branches/tags/commits) in a repository.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          base: { type: "STRING", description: "Base ref (required)." },
          head: { type: "STRING", description: "Head ref (required)." },
        }
      }
    },
    {
      name: "fetch_workflow_runs",
      description: "Fetch GitHub Actions workflow runs for CI/CD health.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          status: { type: "STRING", description: "Optional run status filter." },
          branch: { type: "STRING", description: "Optional branch name." },
          limit: { type: "NUMBER", description: "Run limit (MAX 30)." },
        }
      }
    },
    {
      name: "fetch_repo_languages",
      description: "Fetch language breakdown for a repository.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
        }
      }
    },
    {
      name: "fetch_dependency_updates",
      description: "Fetch Dependabot/security dependency alerts for a repository.",
      parameters: {
        type: "OBJECT",
        properties: {
          repository: { type: "STRING", description: "Optional repository (name or owner/repo)." },
          limit: { type: "NUMBER", description: "Alert limit (MAX 30)." },
        }
      }
    },
  ];
}

function getThinkingGenerationConfig(includeThoughts: boolean, thinkingLevel: "HIGH" | "LOW" | "MINIMAL"): GenerationConfig {
  return {
    thinkingConfig: {
      include_thoughts: includeThoughts,
      thinking_level: thinkingLevel,
    },
  } as unknown as GenerationConfig;
}

const WEB_SEARCH_TRIGGER_PATTERN =
  /(latest|most recent|today|news|competitor|competitors|trending|trend|announcement|release|changelog|cve|advisory|linkedin\.com|https?:\/\/)/i;

function shouldUseWebSearch(question: string): boolean {
  return WEB_SEARCH_TRIGGER_PATTERN.test(question);
}

async function fetchWebSearchSnapshot(
  question: string,
  modelPreference: ModelPreference,
  repoDetails?: { owner: string; repo: string }
): Promise<{ summary: string; searchQuery: string }> {
  const trimmedQuestion = question.trim();
  const searchQuery = repoDetails
    ? (repoDetails.repo === "profile"
      ? `${trimmedQuestion} (GitHub profile context: ${repoDetails.owner})`
      : `${trimmedQuestion} (GitHub repository context: ${repoDetails.owner}/${repoDetails.repo})`)
    : trimmedQuestion;

  const searchModel = getGenAI().getGenerativeModel({
    model: getChatModelForPreference(modelPreference),
    tools: [{ googleSearch: {} }] as unknown as GeminiTool[],
    generationConfig: getThinkingGenerationConfig(false, "LOW"),
  });

  const result = await searchModel.generateContent(
    [
      "Search the web for the user's question and produce a concise snapshot.",
      "Return 4-8 bullets with specific facts and source links where possible.",
      "Prefer recent updates and include dates when available.",
      "If nothing useful is found, return exactly: No useful external updates found.",
      `Question: ${searchQuery}`,
    ].join("\n")
  );

  const summary = result.response.text().trim();
  return { summary, searchQuery };
}

// ─── File Selection ────────────────────────────────────────────────────────────

export async function analyzeFileSelection(
  question: string,
  fileTree: string[],
  owner?: string,
  repo?: string,
  modelPreference: ModelPreference = "flash",
  history: { role: "user" | "model"; content: string }[] = [],
  cachePolicy?: FileCachePolicy
): Promise<string[]> {
  const maxSelectedFiles = modelPreference === "thinking" ? 50 : 25;

  // 1. SMART BYPASS: Triggered only when the user explicitly mentions an exact filename
  // Uses word-boundary matching to avoid false positives (e.g. "contributing" hitting CONTRIBUTING.md)
  const mentionedFiles = fileTree.filter((path) => {
    const filename = path.split("/").pop();
    if (!filename) return false;
    // Escape special regex chars in the filename and require word boundaries
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![\\w.])${escaped}(?![\\w])`, "i");
    return regex.test(question);
  });

  if (mentionedFiles.length > 0) {
    const commonFiles = ["package.json", "README.md", "tsconfig.json", "next.config.js", "next.config.mjs"];
    const additionalContext = fileTree.filter(
      (f) => commonFiles.includes(f) && !mentionedFiles.includes(f)
    );
    const result = [...mentionedFiles, ...additionalContext].slice(0, maxSelectedFiles);
    console.log(`⚡ Smart Bypass: Found ${mentionedFiles.length} mentioned files (+ ${result.length - mentionedFiles.length} contextual).`);
    return result;
  }

  // 2. QUERY CACHING: Check if we've answered this exact query for this repo before
  if (owner && repo) {
    const cachedSelection = await getCachedQuerySelection(owner, repo, question, cachePolicy);
    if (cachedSelection) {
      return cachedSelection
        .filter((path) => fileTree.includes(path))
        .slice(0, maxSelectedFiles);
    }
  }

  // 3. AI SELECTION (Fallback)

  // HIERARCHICAL PRUNING for large repos (> 1,000 files)
  let candidates = fileTree;
  if (fileTree.length > 1000) {
    const cacheKey = `pruned:${owner}/${repo}:${question.toLowerCase().trim()}`;
      const cachedPruned = await getCachedQuerySelection(owner ?? "", repo ?? "", cacheKey, cachePolicy);
    if (cachedPruned) {
      console.log(`🌳 Pruning Cache Hit for ${owner}/${repo}`);
      candidates = cachedPruned;
    } else {
      console.log(`🌳 Repo too large (${fileTree.length} files), performing hierarchical pruning...`);
      candidates = await pruneFileTreeHierarchically(question, fileTree);
      if (owner && repo) {
        await cacheQuerySelection(owner, repo, cacheKey, candidates, cachePolicy);
      }
    }
  }

  const isDeepThinking = modelPreference === "thinking";
  const historyText = history.length > 0 ? formatHistoryText(history.slice(-4)) : "No previous history.";

  const prompt = `
    Select relevant files for this query from the list below.
    Query: "${question}"
    
    Recent Chat History:
    ${historyText}
    
    Files:
    ${candidates.slice(0, 500).join("\n")}
    
    Rules:
    - Return JSON: { "files": ["path/to/file"] }
    - IMPORTANT: If the query is a follow-up that can be answered ENTIRELY based on the Recent Chat History (e.g., "summarize", "explain more about the above"), return an empty array: { "files": [] }.
    - Max ${isDeepThinking ? "50" : "25"} files.
    - Select the MINIMUM number of files necessary to answer the query.
${isDeepThinking ?
      `    - [DEEP THINKING MODE ACTIVE]: You MUST explicitly search for and select the underlying source code files, application logic, and configuration.
    - CRITICAL: Treat documentation (like README.md) as an absolute LAST RESORT. You MUST draw answers from the code.
    - If explaining architecture or systems, prioritize core components, routing, schemas, and main logic files.` :
      `    - CRITICAL: Prioritize source code files (ts, js, py, etc.) over documentation (md) for technical queries.
    - Only pick README.md if the query is about "what is this repo", "installation", or high-level features.
    - For "how does this work" or "logic" queries, MUST select the actual source code files.`}
    - NO EXPLANATION. JSON ONLY.
    `;

  try {
    // For large/complex selections, we use the reasoning model with low thinking to keep it fast
    const model = getGenAI().getGenerativeModel({
      model: FILE_SELECTOR_MODEL,
      generationConfig: getThinkingGenerationConfig(modelPreference === "thinking", modelPreference === "thinking" ? "HIGH" : "LOW"),
    });

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const parsed = asObject(extractJson(response));
    const selectedFiles = getStringArray(parsed.files);
    const normalizedSelection = Array.from(new Set(selectedFiles))
      .filter((path) => fileTree.includes(path))
      .slice(0, maxSelectedFiles);

    if (owner && repo && normalizedSelection.length > 0) {
      await cacheQuerySelection(owner, repo, question, normalizedSelection, cachePolicy);
    }

    return normalizedSelection;
  } catch (e) {
    console.error("Failed to parse file selection", e);
    // Fallback to basic files if the pruning/selection fails
    return fileTree.filter((f) =>
      f.toLowerCase() === "readme.md" ||
      f.toLowerCase() === "package.json" ||
      f.toLowerCase() === "go.mod" ||
      f.toLowerCase() === "cargo.toml"
    );
  }
}

/**
 * Prunes a large file tree by identifying relevant directories first.
 * Uses Gemini 3 Flash in low-thinking mode for rapid classification.
 */
async function pruneFileTreeHierarchically(question: string, fileTree: string[]): Promise<string[]> {
  const topLevelPaths = new Set<string>();
  fileTree.forEach(path => {
    const parts = path.split('/');
    if (parts.length > 1) {
      // Add first two levels for better context
      topLevelPaths.add(parts.slice(0, 2).join('/'));
    } else {
      topLevelPaths.add(parts[0]);
    }
  });

  const prompt = `
    Identify the 5-10 most relevant directories or modules for this query.
    Query: "${question}"
    
    Directories:
    ${Array.from(topLevelPaths).slice(0, 500).join("\n")}
    
    Return JSON: { "directories": ["path/to/dir"] }
    NO EXPLANATION.
  `;

  try {
    const model = getGenAI().getGenerativeModel({
      model: FILE_SELECTOR_MODEL,
      generationConfig: getThinkingGenerationConfig(false, "MINIMAL"),
    });

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const parsed = asObject(extractJson(response));
    const targetDirs = getStringArray(parsed.directories);

    // Filter file tree to only include files in these directories (plus root files)
    const pruned = fileTree.filter(path => {
      // Always include root-level files (configs, READMEs)
      if (!path.includes('/')) return true;
      return targetDirs.some(dir => path.startsWith(dir));
    });

    console.log(`[gemini] Pruned tree from ${fileTree.length} to ${pruned.length} files`);
    return pruned;
  } catch (e) {
    console.warn("Hierarchical pruning failed, using flat list", e);
    return fileTree.slice(0, 1000);
  }
}

// ─── Core Answer Functions ─────────────────────────────────────────────────────

export async function answerWithContext(
  question: string,
  context: string,
  repoDetails: { owner: string; repo: string },
  _profileData?: GitHubProfile,
  history: { role: "user" | "model"; content: string }[] = [],
  modelPreference: ModelPreference = "flash"
): Promise<string> {
  const historyText = formatHistoryText(history);
  let enrichedContext = context;
  if (shouldUseWebSearch(question)) {
    try {
      const snapshot = await fetchWebSearchSnapshot(question, modelPreference, repoDetails);
      if (snapshot.summary && snapshot.summary !== "No useful external updates found.") {
        enrichedContext += `\n--- WEB SEARCH SNAPSHOT ---\n${snapshot.summary}\n`;
      }
    } catch (error) {
      console.warn("Web search snapshot failed (non-fatal):", error);
    }
  }

  let prompt = buildRepoMindPrompt({ question, context: enrichedContext, repoDetails, historyText });
  const isProfileContext = repoDetails.repo === "profile";
  if (isProfileContext) {
    prompt += `\n\n[PROFILE TOOLS MODE]:
    - Use \`fetch_recent_commits\` for coding activity. 
    - Limit: 20 commits for overall profile, 10 for specific repo mentions.
    - Additional tools available: \`fetch_repos_by_age\`, \`fetch_repo_releases\`, \`fetch_pull_requests\`, \`fetch_issue_activity\`, \`fetch_commit_frequency\`, \`fetch_contributors\`, \`fetch_file_history\`, \`compare_refs\`, \`fetch_workflow_runs\`, \`fetch_repo_languages\`, \`fetch_dependency_updates\`.
    - TOOL TRANSPARENCY: If a tool response includes \`githubCallPolicy.limitedByCap=true\`, you MUST include \`githubCallPolicy.note\` verbatim in your answer.
    - **STRICT GROUNDING**: If the user asks for more than these limits, you MUST fetch the maximum (20 or 10) and explicitly state: "Note: Currently, the limit for fetching commits is \${maxAllowed}. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest \${maxAllowed} commits."
    - Do NOT summarize more than the tool returns. If only 10 are returned, you only describe 10.`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]:
    - Use \`fetch_recent_commits\` for history. Limit: 10 commits.
    - Additional tools available: \`fetch_repos_by_age\`, \`fetch_repo_releases\`, \`fetch_pull_requests\`, \`fetch_issue_activity\`, \`fetch_commit_frequency\`, \`fetch_contributors\`, \`fetch_file_history\`, \`compare_refs\`, \`fetch_workflow_runs\`, \`fetch_repo_languages\`, \`fetch_dependency_updates\`.
    - TOOL TRANSPARENCY: If a tool response includes \`githubCallPolicy.limitedByCap=true\`, you MUST include \`githubCallPolicy.note\` verbatim in your answer.
    - **STRICT GROUNDING**: If the user asks for more than 10, you MUST fetch 10 and explicitly state: "Note: Currently, the limit for fetching commits is 10. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest 10 commits."
    - Do NOT hallucinate commits. Only use what the tool provides.`;
  }

  const tools = buildTools(repoDetails);

  const model = getGenAI().getGenerativeModel({
    model: getChatModelForPreference(modelPreference),
    tools,
    generationConfig: getThinkingGenerationConfig(modelPreference === "thinking", modelPreference === "thinking" ? "HIGH" : "LOW"),
  });

  const chat = model.startChat();
  let result = await chat.sendMessage(prompt);

  // Handle function calls if any
  const funcs = result.response.functionCalls?.();
  if (funcs && funcs.length > 0) {
    const calls = funcs as unknown as FunctionCallShape[];
    const responses = await Promise.all(calls.map(c => resolveToolCall(c, repoDetails)));
    const toolResponseParts = buildFunctionResponseParts(calls, responses);
    result = await chat.sendMessage(toolResponseParts);
  }

  return stripEmojiCharacters(result.response.text());
}

/**
 * Streaming variant of answerWithContext.
 * Yields text chunks as they are generated by Gemini.
 */
export async function* answerWithContextStream(
  question: string,
  context: string,
  repoDetails: { owner: string; repo: string },
  _profileData?: GitHubProfile,
  history: { role: "user" | "model"; content: string }[] = [],
  modelPreference: ModelPreference = "flash"
): AsyncGenerator<string> {
  const historyText = formatHistoryText(history);
  let enrichedContext = context;
  if (shouldUseWebSearch(question)) {
    try {
      const snapshot = await fetchWebSearchSnapshot(question, modelPreference, repoDetails);
      yield `STATUS:Searching Google for ${snapshot.searchQuery}`;
      if (snapshot.summary && snapshot.summary !== "No useful external updates found.") {
        enrichedContext += `\n--- WEB SEARCH SNAPSHOT ---\n${snapshot.summary}\n`;
        yield `TOOL:${JSON.stringify({
          name: "googleSearch",
          detail: snapshot.searchQuery,
          usageUnits: 1,
        })}`;
        yield "STATUS:External context added. Preparing answer";
      } else {
        yield "STATUS:No useful external updates found. Preparing answer";
      }
    } catch (error) {
      console.warn("Web search snapshot failed (non-fatal):", error);
      yield "STATUS:Web search unavailable. Continuing with repository context";
    }
  }

  let prompt = buildRepoMindPrompt({ question, context: enrichedContext, repoDetails, historyText });
  const isProfileContext = repoDetails.repo === "profile";
  if (isProfileContext) {
    prompt += `\n\n[PROFILE TOOLS MODE]:
    - Use \`fetch_recent_commits\` for coding activity. Limit: 20 (overall) or 10 (specific repo).
    - Use \`fetch_repos_by_age\` for oldest/newest/journey timeline of repositories.
    - Additional tools available: \`fetch_repo_releases\`, \`fetch_pull_requests\`, \`fetch_issue_activity\`, \`fetch_commit_frequency\`, \`fetch_contributors\`, \`fetch_file_history\`, \`compare_refs\`, \`fetch_workflow_runs\`, \`fetch_repo_languages\`, \`fetch_dependency_updates\`.
    - TOOL TRANSPARENCY: If a tool response includes \`githubCallPolicy.limitedByCap=true\`, you MUST include \`githubCallPolicy.note\` verbatim in your answer.
    - If user asks for more, you MUST fetch the max allowed and say: "Note: Currently, the limit for fetching commits is \${maxAllowed}. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest \${maxAllowed} commits."`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]: 
    - Use \`fetch_recent_commits\` for history. Limit: 10.
    - Use \`fetch_repos_by_age\` for oldest/newest/journey timeline across the owner's repositories.
    - Additional tools available: \`fetch_repo_releases\`, \`fetch_pull_requests\`, \`fetch_issue_activity\`, \`fetch_commit_frequency\`, \`fetch_contributors\`, \`fetch_file_history\`, \`compare_refs\`, \`fetch_workflow_runs\`, \`fetch_repo_languages\`, \`fetch_dependency_updates\`.
    - TOOL TRANSPARENCY: If a tool response includes \`githubCallPolicy.limitedByCap=true\`, you MUST include \`githubCallPolicy.note\` verbatim in your answer.
    - If user asks for more, you MUST fetch 10 and say: "Note: Currently, the limit for fetching commits is 10. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest 10 commits."`;
  }

  const tools = buildTools(repoDetails);
  const modelName = getChatModelForPreference(modelPreference);
  const functionDeclarationCount = countFunctionDeclarations(tools);

  console.log(
    `[answerWithContextStream] Initializing chat with model: ${modelName} ` +
    `(${tools.length} tool object(s), ${functionDeclarationCount} function declaration(s))`
  );

  const model = getGenAI().getGenerativeModel({
    model: modelName,
    tools,
    generationConfig: getThinkingGenerationConfig(modelPreference === "thinking", modelPreference === "thinking" ? "HIGH" : "LOW"),
  });

  const chat = model.startChat();

  // --- Phase 1: Send message and stream to detect tool call or yield direct response ---
  const streamedCalls: FunctionCallShape[] = [];
  let calls: FunctionCallShape[] = [];
  let finalizedFunctionCallParts: Array<Record<string, unknown>> = [];

  try {
    console.log(`[answerWithContextStream] Sending Phase 1 request stream...`);
    yield `STATUS:Analyzing context and reasoning with AI...`;
    const firstResult = await chat.sendMessageStream(prompt);

    for await (const chunk of firstResult.stream) {
      const funcs = chunk.functionCalls?.();
      if (funcs && funcs.length > 0) {
        for (const f of funcs) {
          streamedCalls.push(f as unknown as FunctionCallShape);
          console.log(`[answerWithContextStream] Tool call detected in stream: ${f.name}`);
        }
      }

      // Yield streamed text/thoughts
      const parts = ((chunk as unknown as StreamChunkShape).candidates?.[0]?.content?.parts ?? []);
      for (const part of parts) {
        if (part.thought && modelPreference === "thinking") {
          yield `THOUGHT:${stripEmojiCharacters(part.text ?? "")}`;
        } else if (part.text) {
          yield stripEmojiCharacters(part.text);
        }
      }
    }
    // Finalize history and only trust calls from the finalized response.
    const firstResponse = await firstResult.response;
    finalizedFunctionCallParts = extractFunctionCallPartsFromResponse(firstResponse);
    calls = extractFunctionCallsFromParts(finalizedFunctionCallParts);
    if (calls.length === 0) {
      calls = readFunctionCalls(firstResponse);
    }
    if (streamedCalls.length > 0 && calls.length === 0) {
      console.warn(`[answerWithContextStream] Ignoring ${streamedCalls.length} transient stream tool call(s); finalized response had no tool calls.`);
    }
    console.log(`[answerWithContextStream] Phase 1 stream complete and history finalized.`);
  } catch (error) {
    console.error(`[answerWithContextStream] Phase 1 sendMessageStream failed:`, error);
    if (isMissingThoughtSignatureError(error) || isFunctionTurnOrderError(error)) {
      yield "STATUS:Recovering tool handoff via compatibility path...";
      try {
        const recoveredAnswer = await answerWithContext(
          question,
          enrichedContext,
          repoDetails,
          _profileData,
          history,
          modelPreference
        );
        if (recoveredAnswer) {
          yield recoveredAnswer;
        }
        return;
      } catch (recoveryError) {
        console.error(`[answerWithContextStream] Phase 1 recovery failed:`, recoveryError);
      }
    }
    yield `STATUS:Error during AI reasoning phase. Please try again.`;
    throw error;
  }

  // --- Phase 2: Resolve tool call(s) (if any) and stream the rest ---
  if (calls.length > 0) {
    const stringifyArgValue = (value: unknown): string => {
      if (typeof value === "string") return `"${value}"`;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value)) return `[${value.map(stringifyArgValue).join(", ")}]`;
      if (value && typeof value === "object") return "{...}";
      return "null";
    };

    const formatFunctionCall = (call: FunctionCallShape): string => {
      const name = normalizeFunctionName(call.name);
      const args = asObject(call.args);
      const argPairs = Object.entries(args)
        .filter(([key]) => key.trim().length > 0)
        .map(([key, value]) => `${key}=${stringifyArgValue(value)}`);
      const signature = `${name}(${argPairs.join(", ")})`;
      return signature.length > 200 ? `${signature.slice(0, 197)}...` : signature;
    };

    for (const call of calls) {
      const detail = formatFunctionCall(call);
      yield `TOOL:${JSON.stringify({
        name: normalizeFunctionName(call.name),
        detail,
        usageUnits: 1,
      })}`;
      yield `STATUS:Calling ${detail}`;
    }

    const responses = await Promise.all(calls.map(c => resolveToolCall(c, repoDetails)));

    for (const res of responses) {
      if (res.statusMessage) {
        console.log(`[answerWithContextStream] Tool progress: ${res.statusMessage}`);
        yield `STATUS:${res.statusMessage}`;
      }
      if (res.toolEvent) {
        yield `TOOL:${JSON.stringify(res.toolEvent)}`;
      }
      if (res.commitFreshnessLabel) {
        yield `META:${JSON.stringify({ commitFreshnessLabel: res.commitFreshnessLabel })}`;
      }
    }

    yield "STATUS:Preparing answer...";
    console.log(`[answerWithContextStream] Sending Phase 2 (tool response) stream...`);

    try {
      const toolResponseParts = buildFunctionResponseParts(calls, responses);
      let streamResult: Awaited<ReturnType<typeof chat.sendMessageStream>>;
      try {
        // Primary path: reuse the same chat so function-call metadata such as
        // thought signatures remains intact.
        streamResult = await chat.sendMessageStream(toolResponseParts);
      } catch (primaryError) {
        if (!isFunctionTurnOrderError(primaryError) && !isMissingThoughtSignatureError(primaryError)) {
          throw primaryError;
        }

        // Fallback path: rebuild with a pure function-call model turn. Prefer
        // the finalized function-call parts so metadata (e.g. thought signature)
        // is preserved if present.
        const pureFunctionCallParts = finalizedFunctionCallParts.length > 0
          ? finalizedFunctionCallParts
          : calls.map((call) => ({
            functionCall: {
              name: normalizeFunctionName(call.name),
              args: call.args ?? {},
            },
          }));

        try {
          const phase2Chat = model.startChat({
            history: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
              {
                role: "model",
                parts: pureFunctionCallParts as unknown as Array<Record<string, unknown>>,
              },
            ],
          } as unknown as Parameters<typeof model.startChat>[0]);

          streamResult = await phase2Chat.sendMessageStream(toolResponseParts);
        } catch (rebuildError) {
          if (!isFunctionTurnOrderError(rebuildError) && !isMissingThoughtSignatureError(rebuildError)) {
            throw rebuildError;
          }
          yield "STATUS:Recovering tool handoff via compatibility path...";
          const recoveredText = await recoverWithModernChat(
            prompt,
            modelName,
            tools,
            modelPreference,
            repoDetails,
            calls,
            responses,
          );
          if (recoveredText) {
            yield recoveredText;
          }
          return;
        }
      }

      for await (const chunk of streamResult.stream) {
        const parts = ((chunk as unknown as StreamChunkShape).candidates?.[0]?.content?.parts ?? []);
        for (const part of parts) {
          if (part.thought && modelPreference === "thinking") {
            yield `THOUGHT:${stripEmojiCharacters(part.text ?? "")}`;
          } else if (part.text) {
            yield stripEmojiCharacters(part.text);
          }
        }
      }
      await streamResult.response;
    } catch (error) {
      console.error(`[answerWithContextStream] Phase 2 stream failed:`, error);
      if (isMissingThoughtSignatureError(error) || isFunctionTurnOrderError(error)) {
        yield "STATUS:Recovering tool handoff via compatibility path...";
        const recoveredText = await recoverWithModernChat(
          prompt,
          modelName,
          tools,
          modelPreference,
          repoDetails,
          calls,
          responses,
        );
        if (recoveredText) {
          yield recoveredText;
        }
        return;
      }
      throw error;
    }
    console.log(`[answerWithContextStream] Phase 2 stream complete.`);
  }
}

function buildTools(repoDetails: { owner: string; repo: string }): GeminiTool[] {
  return [
    {
      functionDeclarations: buildGithubFunctionDeclarations(repoDetails),
    },
  ];
}

interface ProfileRepoSampleResult {
  error?: string;
  sampledRepositories: string[];
  totalRepositories: number;
  callsUsed: number;
}

async function sampleProfileRepositories(owner: string): Promise<ProfileRepoSampleResult> {
  try {
    const repos = await getUserRepos(owner);
    const sampledRepositories = repos.slice(0, PROFILE_REPO_SAMPLE_SIZE).map((repo) => repo.name);
    return {
      sampledRepositories,
      totalRepositories: repos.length,
      callsUsed: 1,
    };
  } catch {
    return {
      error: "Failed to list repositories for profile-level analysis.",
      sampledRepositories: [],
      totalRepositories: 0,
      callsUsed: 1,
    };
  }
}

async function resolveToolCall(
  call: FunctionCallShape,
  repoDetails: { owner: string; repo: string }
): Promise<{
  functionResponseData: Record<string, unknown>;
  statusMessage?: string;
  toolEvent?: { name: string; detail?: string; usageUnits?: number };
  commitFreshnessLabel?: string;
}> {
  const callName = typeof call.name === "string" ? call.name : "";
  const args = asObject(call.args);
  const defaultPolicy = buildGitHubCallPolicy({
    functionName: callName || "unknown_tool",
    callsUsed: 0,
  });

  if (callName === "fetch_recent_commits") {
    const rawLimit = args.limit ? Number(args.limit) : undefined;
    const requestedLimit = (typeof rawLimit === "number" && Number.isFinite(rawLimit)) ? Math.max(1, Math.floor(rawLimit)) : undefined;

    if (repoDetails.repo === "profile") {
      const repository = typeof args.repository === "string" ? args.repository.trim() : "";
      const isSpecficRepo = repository && repository.toLowerCase() !== "overall";
      const maxAllowed = isSpecficRepo ? MAX_REPO_COMMITS : MAX_PROFILE_COMMITS;
      const limit = Math.min(requestedLimit ?? maxAllowed, maxAllowed);
      const limitExceeded = (requestedLimit !== undefined && requestedLimit > maxAllowed);

      if (isSpecficRepo) {
        const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, repository, limit);
        const repositoryScope = `${repoDetails.owner}/${repository}`;
        const policy = buildGitHubCallPolicy({
          functionName: callName,
          callsUsed: 1,
          sampledRepositories: [repositoryScope],
        });
        if (!snapshot.success) {
          return {
            functionResponseData: withGitHubCallPolicy({ error: snapshot.error, commits: [] }, policy),
            statusMessage: "Failed to fetch repository commits.",
            toolEvent: { name: "fetch_recent_commits", detail: repository, usageUnits: 1 },
          };
        }
        return {
          functionResponseData: withGitHubCallPolicy({
            commits: snapshot.data.commits,
            scope: "repository",
            repository,
            limitExceeded,
            maxAllowed,
          }, policy),
          statusMessage: `Fetching latest ${limit} commits of ${repository}...`,
          toolEvent: { name: "fetch_recent_commits", detail: repository, usageUnits: 1 },
          commitFreshnessLabel: `Commits checked: ${snapshot.data.freshness.label}`,
        };
      }

      const sample = await sampleProfileRepositories(repoDetails.owner);
      if (sample.error) {
        const policy = buildGitHubCallPolicy({
          functionName: callName,
          callsUsed: sample.callsUsed,
        });
        return {
          functionResponseData: withGitHubCallPolicy({ error: sample.error, commits: [] }, policy),
          statusMessage: "Failed to fetch profile commits.",
          toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        };
      }

      const sampledRepo = sample.sampledRepositories[0];
      if (!sampledRepo) {
        const policy = buildGitHubCallPolicy({
          functionName: callName,
          callsUsed: sample.callsUsed,
          sampledRepositories: [],
          totalCandidateRepositories: sample.totalRepositories,
        });
        return {
          functionResponseData: withGitHubCallPolicy({
            commits: [],
            scope: "overall",
            sampledRepositories: [],
            limitExceeded,
            maxAllowed,
          }, policy),
          statusMessage: "No repositories available for profile commits.",
          toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        };
      }

      const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, sampledRepo, limit);
      const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed + 1,
        sampledRepositories: [sampledScope],
        totalCandidateRepositories: sample.totalRepositories,
      });

      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({
            error: snapshot.error,
            commits: [],
            scope: "overall",
            sampledRepositories: [sampledScope],
            limitExceeded,
            maxAllowed,
          }, policy),
          statusMessage: "Failed to fetch profile commits from sampled repository.",
          toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          commits: snapshot.data.commits,
          scope: "overall",
          sampledRepositories: [sampledScope],
          limitExceeded,
          maxAllowed,
        }, policy),
        statusMessage: `Fetching latest commits from sampled repository ${sampledScope}...`,
        toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        commitFreshnessLabel: `Commits checked: ${snapshot.data.freshness.label}`,
      };
    }

    const maxAllowed = MAX_REPO_COMMITS;
    const limit = Math.min(requestedLimit ?? maxAllowed, maxAllowed);
    const limitExceeded = (requestedLimit !== undefined && requestedLimit > maxAllowed);

    const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, repoDetails.repo, limit);
    const repositoryScope = `${repoDetails.owner}/${repoDetails.repo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: 1,
      sampledRepositories: [repositoryScope],
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({ error: snapshot.error, commits: [] }, policy),
        statusMessage: "Failed to fetch repository commits.",
        toolEvent: { name: "fetch_recent_commits", detail: `${repoDetails.owner}/${repoDetails.repo}`, usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        commits: snapshot.data.commits,
        scope: "repository",
        repository: repoDetails.repo,
        limitExceeded,
        maxAllowed,
      }, policy),
      statusMessage: `Fetching latest ${limit} commits of ${repoDetails.owner}/${repoDetails.repo}...`,
      toolEvent: { name: "fetch_recent_commits", detail: `${repoDetails.owner}/${repoDetails.repo}`, usageUnits: 1 },
      commitFreshnessLabel: `Commits checked: ${snapshot.data.freshness.label}`,
    };
  }

  if (callName === "fetch_repos_by_age") {
    const modeRaw = typeof args.mode === "string" ? args.mode.toLowerCase() : "oldest";
    const mode = modeRaw === "newest" || modeRaw === "journey" ? modeRaw : "oldest";

    if (mode === "journey") {
      const repos = await getUserRepos(repoDetails.owner);
      const byCreated = repos
        .slice()
        .sort((a, b) => new Date(a.created_at ?? a.updated_at).getTime() - new Date(b.created_at ?? b.updated_at).getTime());
      const target = Math.min(20, byCreated.length);
      const picks = new Set<number>();
      if (target > 0) {
        for (let i = 0; i < target; i += 1) {
          const idx = Math.round((i * (byCreated.length - 1)) / Math.max(1, target - 1));
          picks.add(idx);
        }
      }
      const journeyRepos = Array.from(picks).sort((a, b) => a - b).map((idx) => byCreated[idx]).filter(Boolean).map((repo) => ({
        name: repo.name,
        description: repo.description,
        language: repo.language,
        created_at: repo.created_at,
        stargazers_count: repo.stargazers_count,
      }));
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ repos: journeyRepos, mode: "journey" }, policy),
        statusMessage: "Fetching repository journey timeline...",
        toolEvent: { name: "fetch_repos_by_age", detail: "journey", usageUnits: 1 },
      };
    }

    const repos = await getUserReposByAge(repoDetails.owner, mode === "newest" ? "newest" : "oldest", 10);
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: 1,
    });
    return {
      functionResponseData: withGitHubCallPolicy({ repos, mode }, policy),
      statusMessage: mode === "newest" ? "Fetching newest repositories..." : "Fetching oldest repositories...",
      toolEvent: { name: "fetch_repos_by_age", detail: mode, usageUnits: 1 },
    };
  }

  if (callName === "fetch_repo_releases") {
    const limit = parseLimit(args.limit, 10, 20);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);
    if (resolved) {
      const snapshot = await getRepoReleasesSnapshot(resolved.owner, resolved.repo, limit);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, releases: [] }, policy),
          statusMessage: "Failed to fetch releases.",
          toolEvent: { name: "fetch_repo_releases", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          releases: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching latest releases from ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_repo_releases", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, releases: [] }, policy),
        statusMessage: "Failed to fetch profile releases.",
        toolEvent: { name: "fetch_repo_releases", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ releases: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for release timeline.",
        toolEvent: { name: "fetch_repo_releases", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoReleasesSnapshot(repoDetails.owner, sampledRepo, limit);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          releases: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch profile releases.",
        toolEvent: { name: "fetch_repo_releases", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        releases: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching release timeline from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_repo_releases", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_pull_requests") {
    const stateRaw = typeof args.state === "string" ? args.state.toLowerCase() : "all";
    const state = stateRaw === "open" || stateRaw === "closed" ? stateRaw : "all";
    const since = parseOptionalString(args.since);
    const limit = parseLimit(args.limit, 20, 30);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoPullRequestsSnapshot(resolved.owner, resolved.repo, state, limit, since);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, pullRequests: [] }, policy),
          statusMessage: "Failed to fetch pull requests.",
          toolEvent: { name: "fetch_pull_requests", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          pullRequests: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching pull requests from ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_pull_requests", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, pullRequests: [] }, policy),
        statusMessage: "Failed to fetch profile pull requests.",
        toolEvent: { name: "fetch_pull_requests", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ pullRequests: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for pull request activity.",
        toolEvent: { name: "fetch_pull_requests", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoPullRequestsSnapshot(repoDetails.owner, sampledRepo, state, limit, since);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          pullRequests: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch profile pull requests.",
        toolEvent: { name: "fetch_pull_requests", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        pullRequests: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching pull request activity from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_pull_requests", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_issue_activity") {
    const stateRaw = typeof args.state === "string" ? args.state.toLowerCase() : "all";
    const state = stateRaw === "open" || stateRaw === "closed" ? stateRaw : "all";
    const since = parseOptionalString(args.since);
    const limit = parseLimit(args.limit, 20, 30);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoIssuesSnapshot(resolved.owner, resolved.repo, state, limit, since);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, issues: [] }, policy),
          statusMessage: "Failed to fetch issues.",
          toolEvent: { name: "fetch_issue_activity", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          issues: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching issue activity from ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_issue_activity", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, issues: [] }, policy),
        statusMessage: "Failed to fetch profile issues.",
        toolEvent: { name: "fetch_issue_activity", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ issues: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for issue activity.",
        toolEvent: { name: "fetch_issue_activity", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoIssuesSnapshot(repoDetails.owner, sampledRepo, state, limit, since);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          issues: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch profile issues.",
        toolEvent: { name: "fetch_issue_activity", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        issues: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching issue activity from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_issue_activity", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_commit_frequency") {
    const weeks = parseLimit(args.weeks, 8, 52);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoCommitFrequencySnapshot(resolved.owner, resolved.repo, weeks);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, weeklyCommits: [] }, policy),
          statusMessage: "Failed to fetch commit frequency.",
          toolEvent: { name: "fetch_commit_frequency", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          weeklyCommits: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching ${weeks}-week commit frequency for ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_commit_frequency", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, weeklyCommits: [] }, policy),
        statusMessage: "Failed to fetch profile commit frequency.",
        toolEvent: { name: "fetch_commit_frequency", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ weeklyCommits: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for commit frequency.",
        toolEvent: { name: "fetch_commit_frequency", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoCommitFrequencySnapshot(repoDetails.owner, sampledRepo, weeks);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          weeklyCommits: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch profile commit frequency.",
        toolEvent: { name: "fetch_commit_frequency", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        weeklyCommits: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching ${weeks}-week commit frequency from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_commit_frequency", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_contributors") {
    const limit = parseLimit(args.limit, 20, 30);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoContributorsSnapshot(resolved.owner, resolved.repo, limit);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, contributors: [] }, policy),
          statusMessage: "Failed to fetch contributors.",
          toolEvent: { name: "fetch_contributors", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          contributors: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching top contributors for ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_contributors", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, contributors: [] }, policy),
        statusMessage: "Failed to fetch profile contributors.",
        toolEvent: { name: "fetch_contributors", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ contributors: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for contributor insights.",
        toolEvent: { name: "fetch_contributors", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoContributorsSnapshot(repoDetails.owner, sampledRepo, limit);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          contributors: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch profile contributors.",
        toolEvent: { name: "fetch_contributors", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        contributors: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching top contributors from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_contributors", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_file_history") {
    const path = parseOptionalString(args.path);
    if (!path) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 0,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: "Missing required argument: path", fileHistory: [] }, policy),
        statusMessage: "Missing required file path for history lookup.",
        toolEvent: { name: "fetch_file_history", detail: "missing-path", usageUnits: 1 },
      };
    }
    const limit = parseLimit(args.limit, 10, 20);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);
    if (!resolved) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 0,
      });
      return {
        functionResponseData: withGitHubCallPolicy({
          error: "Repository is required for file history in profile mode.",
          fileHistory: [],
        }, policy),
        statusMessage: "Specify a repository to fetch file history in profile mode.",
        toolEvent: { name: "fetch_file_history", detail: "missing-repository", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoFileHistorySnapshot(resolved.owner, resolved.repo, path, limit);
    const repositoryScope = `${resolved.owner}/${resolved.repo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: 1,
      sampledRepositories: [repositoryScope],
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({ error: snapshot.error, fileHistory: [] }, policy),
        statusMessage: "Failed to fetch file history.",
        toolEvent: { name: "fetch_file_history", detail: `${resolved.owner}/${resolved.repo}:${path}`, usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        fileHistory: snapshot.data,
        repository: repositoryScope,
      }, policy),
      statusMessage: `Fetching file history for ${path}...`,
      toolEvent: { name: "fetch_file_history", detail: `${resolved.owner}/${resolved.repo}:${path}`, usageUnits: 1 },
    };
  }

  if (callName === "compare_refs") {
    const base = parseOptionalString(args.base);
    const head = parseOptionalString(args.head);
    if (!base || !head) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 0,
      });
      return {
        functionResponseData: withGitHubCallPolicy({
          error: "Missing required arguments: base and/or head",
          comparison: null,
        }, policy),
        statusMessage: "Missing base/head refs for compare.",
        toolEvent: { name: "compare_refs", detail: "missing-refs", usageUnits: 1 },
      };
    }
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);
    if (!resolved) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 0,
      });
      return {
        functionResponseData: withGitHubCallPolicy({
          error: "Repository is required for compare_refs in profile mode.",
          comparison: null,
        }, policy),
        statusMessage: "Specify a repository to compare refs in profile mode.",
        toolEvent: { name: "compare_refs", detail: "missing-repository", usageUnits: 1 },
      };
    }
    const snapshot = await compareRepoRefsSnapshot(resolved.owner, resolved.repo, base, head);
    const repositoryScope = `${resolved.owner}/${resolved.repo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: 1,
      sampledRepositories: [repositoryScope],
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({ error: snapshot.error, comparison: null }, policy),
        statusMessage: "Failed to compare refs.",
        toolEvent: { name: "compare_refs", detail: `${resolved.owner}/${resolved.repo}:${base}...${head}`, usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        comparison: snapshot.data,
        repository: repositoryScope,
      }, policy),
      statusMessage: `Comparing ${base}...${head}...`,
      toolEvent: { name: "compare_refs", detail: `${resolved.owner}/${resolved.repo}:${base}...${head}`, usageUnits: 1 },
    };
  }

  if (callName === "fetch_workflow_runs") {
    const limit = parseLimit(args.limit, 20, 30);
    const status = parseOptionalString(args.status);
    const branch = parseOptionalString(args.branch);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoWorkflowRunsSnapshot(resolved.owner, resolved.repo, limit, status, branch);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, workflowRuns: [] }, policy),
          statusMessage: "Failed to fetch workflow runs.",
          toolEvent: { name: "fetch_workflow_runs", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          workflowRuns: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching workflow runs from ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_workflow_runs", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, workflowRuns: [] }, policy),
        statusMessage: "Failed to fetch workflow runs across repositories.",
        toolEvent: { name: "fetch_workflow_runs", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ workflowRuns: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for workflow insights.",
        toolEvent: { name: "fetch_workflow_runs", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoWorkflowRunsSnapshot(repoDetails.owner, sampledRepo, limit, status, branch);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          workflowRuns: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch workflow runs across repositories.",
        toolEvent: { name: "fetch_workflow_runs", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        workflowRuns: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching workflow runs from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_workflow_runs", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_repo_languages") {
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);
    if (resolved) {
      const snapshot = await getRepoLanguagesSnapshot(resolved.owner, resolved.repo);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, languages: [] }, policy),
          statusMessage: "Failed to fetch repository languages.",
          toolEvent: { name: "fetch_repo_languages", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          languages: snapshot.data.languages,
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching language distribution for ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_repo_languages", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, languages: [] }, policy),
        statusMessage: "Failed to fetch language distribution across repositories.",
        toolEvent: { name: "fetch_repo_languages", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ languages: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for language distribution.",
        toolEvent: { name: "fetch_repo_languages", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoLanguagesSnapshot(repoDetails.owner, sampledRepo);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          languages: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch language distribution across repositories.",
        toolEvent: { name: "fetch_repo_languages", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        languages: snapshot.data.languages,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching language distribution from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_repo_languages", detail: "overall", usageUnits: 1 },
    };
  }

  if (callName === "fetch_dependency_updates") {
    const limit = parseLimit(args.limit, 20, 30);
    const resolved = resolveRepositoryForTool(args.repository, repoDetails);

    if (resolved) {
      const snapshot = await getRepoDependencyAlertsSnapshot(resolved.owner, resolved.repo, limit);
      const repositoryScope = `${resolved.owner}/${resolved.repo}`;
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: 1,
        sampledRepositories: [repositoryScope],
      });
      if (!snapshot.success) {
        return {
          functionResponseData: withGitHubCallPolicy({ error: snapshot.error, dependencyAlerts: [] }, policy),
          statusMessage: "Failed to fetch dependency alerts.",
          toolEvent: { name: "fetch_dependency_updates", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
        };
      }
      return {
        functionResponseData: withGitHubCallPolicy({
          dependencyAlerts: snapshot.data,
          scope: "repository",
          repository: repositoryScope,
        }, policy),
        statusMessage: `Fetching dependency alerts from ${resolved.owner}/${resolved.repo}...`,
        toolEvent: { name: "fetch_dependency_updates", detail: `${resolved.owner}/${resolved.repo}`, usageUnits: 1 },
      };
    }

    const sample = await sampleProfileRepositories(repoDetails.owner);
    if (sample.error) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ error: sample.error, dependencyAlerts: [] }, policy),
        statusMessage: "Failed to fetch dependency alerts across repositories.",
        toolEvent: { name: "fetch_dependency_updates", detail: "overall", usageUnits: 1 },
      };
    }
    const sampledRepo = sample.sampledRepositories[0];
    if (!sampledRepo) {
      const policy = buildGitHubCallPolicy({
        functionName: callName,
        callsUsed: sample.callsUsed,
        totalCandidateRepositories: sample.totalRepositories,
      });
      return {
        functionResponseData: withGitHubCallPolicy({ dependencyAlerts: [], scope: "overall", sampledRepositories: [] }, policy),
        statusMessage: "No repositories available for dependency alerts.",
        toolEvent: { name: "fetch_dependency_updates", detail: "overall", usageUnits: 1 },
      };
    }
    const snapshot = await getRepoDependencyAlertsSnapshot(repoDetails.owner, sampledRepo, limit);
    const sampledScope = `${repoDetails.owner}/${sampledRepo}`;
    const policy = buildGitHubCallPolicy({
      functionName: callName,
      callsUsed: sample.callsUsed + 1,
      sampledRepositories: [sampledScope],
      totalCandidateRepositories: sample.totalRepositories,
    });
    if (!snapshot.success) {
      return {
        functionResponseData: withGitHubCallPolicy({
          error: snapshot.error,
          dependencyAlerts: [],
          scope: "overall",
          sampledRepositories: [sampledScope],
        }, policy),
        statusMessage: "Failed to fetch dependency alerts across repositories.",
        toolEvent: { name: "fetch_dependency_updates", detail: "overall", usageUnits: 1 },
      };
    }
    return {
      functionResponseData: withGitHubCallPolicy({
        dependencyAlerts: snapshot.data,
        scope: "overall",
        sampledRepositories: [sampledScope],
      }, policy),
      statusMessage: `Fetching dependency alerts from sampled repository ${sampledScope}...`,
      toolEvent: { name: "fetch_dependency_updates", detail: "overall", usageUnits: 1 },
    };
  }

  return {
    functionResponseData: withGitHubCallPolicy({ error: "Unsupported tool call." }, defaultPolicy),
  };
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Fix Mermaid diagram syntax using AI.
 * Takes potentially invalid Mermaid code and returns a corrected version.
 */
type MermaidFixDiagramType =
  | "flowchart"
  | "sequenceDiagram"
  | "stateDiagram-v2"
  | "classDiagram"
  | "erDiagram"
  | "mindmap"
  | "gantt"
  | "xychart"
  | "unknown";

function detectMermaidFixDiagramType(code: string): MermaidFixDiagramType {
  const firstContentLine = (code || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));

  if (!firstContentLine) return "unknown";

  const token = firstContentLine.split(/\s+/)[0] ?? "";
  const normalized = token.toLowerCase();

  if (normalized === "graph" || normalized === "flowchart") return "flowchart";
  if (normalized === "sequencediagram" || normalized === "sequence") return "sequenceDiagram";
  if (normalized === "statediagram-v2" || normalized === "statediagram" || normalized === "state") return "stateDiagram-v2";
  if (normalized === "classdiagram") return "classDiagram";
  if (normalized === "erdiagram") return "erDiagram";
  if (normalized === "mindmap") return "mindmap";
  if (normalized === "gantt") return "gantt";
  if (normalized === "xychart" || normalized === "xychart-beta") return "xychart";

  return "unknown";
}

function buildMermaidFixPrompt(code: string, diagramType: MermaidFixDiagramType): string {
  const commonRules = `GLOBAL RULES:
1. Preserve the same Mermaid diagram type; do not convert to a different diagram family.
2. Return only a valid Mermaid code block and no explanation text.
3. Remove broken markdown/HTML artifacts and invalid characters that break parsing.
4. Keep node/class/entity names concise and parse-safe.
5. Do not add theme/color/style directives such as style, classDef, linkStyle, or %%{init...}%% unless they are strictly required for syntax correctness.`;

  const typeRules = (() => {
    switch (diagramType) {
      case "classDiagram":
        return `TYPE RULES (classDiagram):
- First line must be exactly: classDiagram
- Do NOT convert this into flowchart node syntax (no A["Label"] rewriting).
- Class declarations must use Mermaid class-diagram syntax (e.g., "class Repository").
- Class members must follow "ClassName : member" format.
- Relationship connectors must be valid class-diagram connectors: <|--, *--, o--, ..>, --, ..|>.
- Relationship labels (if present) must follow: "A <|-- B : label".`;
      case "sequenceDiagram":
        return `TYPE RULES (sequenceDiagram):
- First line must be exactly: sequenceDiagram
- Participants and messages must follow Mermaid sequence syntax.
- Use valid arrows such as ->>, -->>, -x.`;
      case "stateDiagram-v2":
        return `TYPE RULES (stateDiagram-v2):
- First line must be exactly: stateDiagram-v2
- Use valid state transitions and [*] start/end markers only where appropriate.`;
      case "erDiagram":
        return `TYPE RULES (erDiagram):
- First line must be exactly: erDiagram
- Entities must use block syntax and relations must use valid ER cardinality connectors.`;
      case "mindmap":
        return `TYPE RULES (mindmap):
- First line must be exactly: mindmap
- Maintain valid indentation hierarchy.`;
      case "gantt":
        return `TYPE RULES (gantt):
- First line must be exactly: gantt
- Keep valid date/task syntax and section blocks.`;
      case "xychart":
        return `TYPE RULES (xychart):
- First line must be exactly: xychart (or xychart with orientation suffix).
- Keep valid x-axis/y-axis and series syntax.`;
      case "flowchart":
        return `TYPE RULES (flowchart):
- First line must be flowchart <direction>.
- Use valid edge connectors and ensure referenced nodes are declared or parse-safe.`;
      default:
        return `TYPE RULES (unknown):
- Infer the intended Mermaid type from the code and keep that type consistent.
- Fix only syntax; do not redesign the diagram.`;
    }
  })();

  return `You are a Mermaid diagram syntax expert. Fix the following Mermaid code so it parses successfully.

Target diagram type: ${diagramType}

${commonRules}

${typeRules}

INVALID MERMAID CODE:
\`\`\`mermaid
${code}
\`\`\`

Return ONLY:
\`\`\`mermaid
[corrected code]
\`\`\``;
}

export async function fixMermaidSyntax(code: string): Promise<string | null> {
  try {
    const diagramType = detectMermaidFixDiagramType(code);
    const prompt = buildMermaidFixPrompt(code, diagramType);

    const result = await getGenAI()
      .getGenerativeModel({ model: DEFAULT_MODEL })
      .generateContent(prompt);
    const response = result.response.text();

    const match = response.match(/```mermaid\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return match[1].trim();
    }

    return null;
  } catch (error) {
    console.error("AI Mermaid fix failed:", error);
    return null;
  }
}

/**
 * Robust JSON extraction from LLM responses.
 * Handles markdown blocks, leading/trailing reasoning text, and thinking tokens.
 */
function extractJson(text: string): unknown {
  const tryParse = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  const parseFirstEmbeddedJson = (source: string): unknown | undefined => {
    for (let start = 0; start < source.length; start += 1) {
      const opening = source[start];
      if (opening !== "{" && opening !== "[") continue;

      const stack: string[] = [opening];
      let inString = false;
      let escaped = false;

      for (let end = start + 1; end < source.length; end += 1) {
        const char = source[end];

        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === "\\") {
            escaped = true;
            continue;
          }
          if (char === "\"") {
            inString = false;
          }
          continue;
        }

        if (char === "\"") {
          inString = true;
          continue;
        }

        if (char === "{" || char === "[") {
          stack.push(char);
          continue;
        }

        if (char === "}" || char === "]") {
          const expected = char === "}" ? "{" : "[";
          const actual = stack.pop();
          if (actual !== expected) {
            break;
          }
          if (stack.length === 0) {
            const parsed = tryParse(source.slice(start, end + 1));
            if (parsed !== undefined) return parsed;
            break;
          }
        }
      }
    }
    return undefined;
  };

  try {
    const trimmed = text.trim();

    // 1) Attempt direct JSON parse.
    const directParsed = tryParse(trimmed);
    if (directParsed !== undefined) return directParsed;

    // 2) Try fenced code blocks.
    const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
    for (const match of fencedMatches) {
      const block = match[1]?.trim();
      if (!block) continue;
      const parsedBlock = tryParse(block);
      if (parsedBlock !== undefined) return parsedBlock;
      const embeddedFromBlock = parseFirstEmbeddedJson(block);
      if (embeddedFromBlock !== undefined) return embeddedFromBlock;
    }

    // 3) Parse first embedded balanced JSON object/array in mixed prose.
    const embedded = parseFirstEmbeddedJson(trimmed);
    if (embedded !== undefined) return embedded;

    // 4) Last-resort cleanup for raw markdown fences.
    const cleaned = trimmed.replace(/```json/gi, "").replace(/```/g, "").trim();
    const cleanedParsed = tryParse(cleaned);
    if (cleanedParsed !== undefined) return cleanedParsed;

    const embeddedFromCleaned = parseFirstEmbeddedJson(cleaned);
    if (embeddedFromCleaned !== undefined) return embeddedFromCleaned;

    throw new Error("No valid JSON object or array found in model output.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("JSON extraction failed:", message, "Original text snippet:", text.slice(0, 100));
    throw new Error(`Failed to parse file selection: ${message}`);
  }
}
