import {
  getGenAI,
  DEFAULT_MODEL,
  FILE_SELECTOR_MODEL,
  getChatModelForPreference,
  type ModelPreference,
} from "./ai-client";
import { buildRepoMindPrompt, formatHistoryText } from "./prompt-builder";
import { cacheQuerySelection, getCachedQuerySelection } from "./cache";
import type { FileCachePolicy } from "./cache";
import type { GitHubProfile } from "./github";
import {
  getRecentProfileCommitsSnapshot,
  getRecentRepoCommitsSnapshot,
  getUserRepos,
  getUserReposByAge,
} from "./github";
import type { GenerationConfig } from "@google/generative-ai";

type JsonObject = Record<string, unknown>;
type GeminiTool = Record<string, unknown>;
type ChunkPart = { text?: string; thought?: boolean };
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

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  modelPreference: ModelPreference
): Promise<{ summary: string; queryHint: string }> {
  const searchModel = getGenAI().getGenerativeModel({
    model: getChatModelForPreference(modelPreference),
    tools: [{ googleSearch: {} }],
    generationConfig: getThinkingGenerationConfig(false, "LOW"),
  });

  const result = await searchModel.generateContent(
    [
      "Search the web for the user's question and produce a concise snapshot.",
      "Return 4-8 bullets with specific facts and source links where possible.",
      "Prefer recent updates and include dates when available.",
      "If nothing useful is found, return exactly: No useful external updates found.",
      `Question: ${question}`,
    ].join("\n")
  );

  const summary = result.response.text().trim();
  const queryHint = question.length > 120 ? `${question.slice(0, 117)}...` : question;
  return { summary, queryHint };
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

    console.log(`✅ Pruned tree from ${fileTree.length} to ${pruned.length} files`);
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
      const snapshot = await fetchWebSearchSnapshot(question, modelPreference);
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
    prompt += `\n\n[PROFILE TOOLS MODE]: You may use profile tools for both Lite and Thinking modes.
    - Use \`fetch_recent_commits\` when the user asks about coding activity, commit quality, or recent work.
    - Use \`fetch_repos_by_age\` when the user asks about oldest/newest repos or long-term journey.
    - Prefer existing context first; call tools only when additional data is needed.`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]: You may use \`fetch_recent_commits\` when commit history is needed for this repository.
    - Use it only when the user asks for recency, evolution, blame-like activity, or commit intent.`;
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
    const call = funcs[0] as FunctionCallShape;
    const { functionResponseData } = await resolveToolCall(call, repoDetails);

    result = await chat.sendMessage([{
      functionResponse: {
        name: typeof call.name === "string" ? call.name : "unknown_tool",
        response: functionResponseData
      }
    }]);
  }

  return result.response.text();
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
      yield "STATUS:Searching Google for external context...";
      const snapshot = await fetchWebSearchSnapshot(question, modelPreference);
      if (snapshot.summary && snapshot.summary !== "No useful external updates found.") {
        enrichedContext += `\n--- WEB SEARCH SNAPSHOT ---\n${snapshot.summary}\n`;
        yield `TOOL:${JSON.stringify({
          name: "googleSearch",
          detail: snapshot.queryHint,
          usageUnits: 1,
        })}`;
        yield "STATUS:External context added. Preparing answer...";
      } else {
        yield "STATUS:No useful external updates found. Preparing answer...";
      }
    } catch (error) {
      console.warn("Web search snapshot failed (non-fatal):", error);
      yield "STATUS:Web search unavailable. Continuing with repository context...";
    }
  }

  let prompt = buildRepoMindPrompt({ question, context: enrichedContext, repoDetails, historyText });
  const isProfileContext = repoDetails.repo === "profile";
  if (isProfileContext) {
    prompt += `\n\n[PROFILE TOOLS MODE]: You may use profile tools for both Lite and Thinking modes.
    - Use \`fetch_recent_commits\` for coding activity/recency questions.
    - Use \`fetch_repos_by_age\` for oldest/newest/journey timeline questions.
    - Only use tools when context is insufficient.`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]: Use \`fetch_recent_commits\` when commit history is needed for this repository.`;
  }

  const tools = buildTools(repoDetails);

  const model = getGenAI().getGenerativeModel({
    model: getChatModelForPreference(modelPreference),
    tools,
    generationConfig: getThinkingGenerationConfig(modelPreference === "thinking", modelPreference === "thinking" ? "HIGH" : "LOW"),
  });

  const chat = model.startChat();

  // --- Phase 1: Send message (non-streaming) to detect if a tool call is needed ---
  const firstResult = await chat.sendMessage(prompt);
  const firstResponse = firstResult.response;
  const functionCalls = firstResponse.functionCalls?.();

  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0] as FunctionCallShape;
    const {
      functionResponseData,
      statusMessage,
      toolEvent,
      commitFreshnessLabel,
    } = await resolveToolCall(call, repoDetails);

    if (statusMessage) {
      yield `STATUS:${statusMessage}`;
    }
    if (toolEvent) {
      yield `TOOL:${JSON.stringify(toolEvent)}`;
    }
    if (commitFreshnessLabel) {
      yield `META:${JSON.stringify({ commitFreshnessLabel })}`;
    }

    yield "STATUS:Preparing answer...";

    // --- Phase 2: Send function response and stream the final answer ---
    const streamResult = await chat.sendMessageStream([{
      functionResponse: {
        name: typeof call.name === "string" ? call.name : "unknown_tool",
        response: functionResponseData
      }
    }]);

    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
    return;
  }

  // No function call — stream the direct answer
  const streamResult = await chat.sendMessageStream(prompt);
  for await (const chunk of streamResult.stream) {
    const parts = ((chunk as StreamChunkShape).candidates?.[0]?.content?.parts ?? []);
    for (const part of parts) {
      if (part.thought && modelPreference === "thinking") {
        yield `THOUGHT:${part.text}`;
      } else if (part.text) {
        yield part.text;
      }
    }
  }
}

function buildTools(repoDetails: { owner: string; repo: string }): GeminiTool[] {
  const isProfileContext = repoDetails.repo === "profile";
  if (isProfileContext) {
    return [
      {
        functionDeclarations: [
          {
            name: "fetch_recent_commits",
            description: "Fetch recent commits either overall or for a specific repository.",
            parameters: {
              type: "OBJECT",
              properties: {
                repository: { type: "STRING", description: "Optional repository name for repo-specific commits." },
                limit: { type: "NUMBER", description: "Optional commit limit." },
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
          }
        ]
      },
    ];
  }

  return [
    {
      functionDeclarations: [
        {
          name: "fetch_recent_commits",
          description: "Fetch the latest commits for the current repository.",
          parameters: {
            type: "OBJECT",
            properties: {
              limit: { type: "NUMBER", description: "Optional commit limit." },
            }
          }
        },
      ]
    },
  ];
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

  if (callName === "fetch_recent_commits") {
    const rawLimit = Number(args.limit);
    const requestedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : undefined;
    const limit = Math.min(requestedLimit ?? (repoDetails.repo === "profile" ? 20 : 10), repoDetails.repo === "profile" ? 20 : 10);

    if (repoDetails.repo === "profile") {
      const repository = typeof args.repository === "string" ? args.repository.trim() : "";
      if (repository) {
        const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, repository, Math.min(limit, 10));
        return {
          functionResponseData: { commits: snapshot.commits, scope: "repository", repository },
          statusMessage: `Fetching latest 10 commits of ${repository}...`,
          toolEvent: { name: "fetch_recent_commits", detail: repository, usageUnits: 1 },
          commitFreshnessLabel: `Commits checked: ${snapshot.freshness.label}`,
        };
      }

      const snapshot = await getRecentProfileCommitsSnapshot(repoDetails.owner, Math.min(limit, 20));
      return {
        functionResponseData: { commits: snapshot.commits, scope: "overall" },
        statusMessage: "Fetching latest commits across repositories...",
        toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        commitFreshnessLabel: `Commits checked: ${snapshot.freshness.label}`,
      };
    }

    const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, repoDetails.repo, Math.min(limit, 10));
    return {
      functionResponseData: { commits: snapshot.commits, scope: "repository", repository: repoDetails.repo },
      statusMessage: `Fetching latest 10 commits of ${repoDetails.owner}/${repoDetails.repo}...`,
      toolEvent: { name: "fetch_recent_commits", detail: `${repoDetails.owner}/${repoDetails.repo}`, usageUnits: 1 },
      commitFreshnessLabel: `Commits checked: ${snapshot.freshness.label}`,
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
      return {
        functionResponseData: { repos: journeyRepos, mode: "journey" },
        statusMessage: "Fetching repository journey timeline...",
        toolEvent: { name: "fetch_repos_by_age", detail: "journey", usageUnits: 1 },
      };
    }

    const repos = await getUserReposByAge(repoDetails.owner, mode === "newest" ? "newest" : "oldest", 10);
    return {
      functionResponseData: { repos, mode },
      statusMessage: mode === "newest" ? "Fetching newest repositories..." : "Fetching oldest repositories...",
      toolEvent: { name: "fetch_repos_by_age", detail: mode, usageUnits: 1 },
    };
  }

  return {
    functionResponseData: { error: "Unsupported tool call." },
  };
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Fix Mermaid diagram syntax using AI.
 * Takes potentially invalid Mermaid code and returns a corrected version.
 */
export async function fixMermaidSyntax(code: string): Promise<string | null> {
  try {
    const prompt = `You are a Mermaid diagram syntax expert. Fix the following Mermaid diagram code to make it valid.

CRITICAL RULES:
1. **Node Labels**: MUST be in double quotes inside brackets: A["Label Text"]
2. **No Special Characters**: Remove quotes, backticks, HTML tags, and special Unicode from inside node labels
3. **Edge Labels**: Text on arrows should NOT be quoted: A -- label text --> B
4. **Complete Nodes**: Every node after an arrow must have an ID and shape: A --> B["Label"]
5. **Clean Text**: Only use alphanumeric characters, spaces, and basic punctuation (.,;:!?()-_) in labels
6. **Valid Syntax**: Ensure proper Mermaid syntax for all elements

INVALID MERMAID CODE:
\`\`\`mermaid
${code}
\`\`\`

Return ONLY the corrected Mermaid code in a markdown code block. Do NOT use HTML tags. Do NOT use special characters in labels. Just return:
\`\`\`mermaid
[corrected code here]
\`\`\``;

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
  try {
    // 1. Try cleaning basic markdown first
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // 2. Extract first matching block
      const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw e;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("JSON extraction failed:", message, "Original text snippet:", text.slice(0, 100));
    throw new Error(`Failed to parse file selection: ${message}`);
  }
}
