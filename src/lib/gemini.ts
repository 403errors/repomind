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
import type { Content, GenerationConfig } from "@google/generative-ai";

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

const MAX_REPO_COMMITS = 10;
const MAX_PROFILE_COMMITS = 20;
const SUPPORT_EMAIL = "pieisnot22by7@gmail.com";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeFunctionName(name: unknown): string {
  return typeof name === "string" && name.trim().length > 0 ? name : "unknown_tool";
}

function buildModelFunctionCallParts(calls: FunctionCallShape[]) {
  return calls.map((call) => ({
    functionCall: {
      name: normalizeFunctionName(call.name),
      args: asObject(call.args),
    },
  }));
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
    tools: [{ googleSearch: {} }] as unknown as GeminiTool[],
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
    prompt += `\n\n[PROFILE TOOLS MODE]:
    - Use \`fetch_recent_commits\` for coding activity. 
    - Limit: 20 commits for overall profile, 10 for specific repo mentions.
    - **STRICT GROUNDING**: If the user asks for more than these limits, you MUST fetch the maximum (20 or 10) and explicitly state: "Note: Currently, the limit for fetching commits is \${maxAllowed}. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest \${maxAllowed} commits."
    - Do NOT summarize more than the tool returns. If only 10 are returned, you only describe 10.`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]:
    - Use \`fetch_recent_commits\` for history. Limit: 10 commits.
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
    const modelFunctionCallParts = buildModelFunctionCallParts(calls);
    const toolResponseParts = buildFunctionResponseParts(calls, responses);
    const followupHistory: Content[] = [
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: modelFunctionCallParts },
    ];

    // Use a fresh chat with explicit function-call history to keep provider turn-order strictness stable.
    const followupChat = model.startChat({
      history: followupHistory,
    });

    result = await followupChat.sendMessage(toolResponseParts);
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
    prompt += `\n\n[PROFILE TOOLS MODE]:
    - Use \`fetch_recent_commits\` for coding activity. Limit: 20 (overall) or 10 (specific repo).
    - If user asks for more, you MUST fetch the max allowed and say: "Note: Currently, the limit for fetching commits is \${maxAllowed}. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest \${maxAllowed} commits."`;
  } else {
    prompt += `\n\n[REPO TOOLS MODE]: 
    - Use \`fetch_recent_commits\` for history. Limit: 10.
    - If user asks for more, you MUST fetch 10 and say: "Note: Currently, the limit for fetching commits is 10. Please contact **${SUPPORT_EMAIL}** if you need more usage. I will provide the answer on the basis of the latest 10 commits."`;
  }

  const tools = buildTools(repoDetails);
  const modelName = getChatModelForPreference(modelPreference);

  console.log(`[answerWithContextStream] Initializing chat with model: ${modelName} (${tools.length} tools available)`);

  const model = getGenAI().getGenerativeModel({
    model: modelName,
    tools,
    generationConfig: getThinkingGenerationConfig(modelPreference === "thinking", modelPreference === "thinking" ? "HIGH" : "LOW"),
  });

  const chat = model.startChat();

  // --- Phase 1: Send message and stream to detect tool call or yield direct response ---
  const streamedCalls: FunctionCallShape[] = [];
  let calls: FunctionCallShape[] = [];

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
          yield `THOUGHT:${part.text}`;
        } else if (part.text) {
          yield part.text;
        }
      }
    }
    // Finalize history and only trust calls from the finalized response.
    const firstResponse = await firstResult.response;
    calls = (firstResponse.functionCalls?.() as unknown as FunctionCallShape[] | undefined) ?? [];
    if (streamedCalls.length > 0 && calls.length === 0) {
      console.warn(`[answerWithContextStream] Ignoring ${streamedCalls.length} transient stream tool call(s); finalized response had no tool calls.`);
    }
    console.log(`[answerWithContextStream] Phase 1 stream complete and history finalized.`);
  } catch (error) {
    console.error(`[answerWithContextStream] Phase 1 sendMessageStream failed:`, error);
    yield `STATUS:Error during AI reasoning phase. Please try again.`;
    throw error;
  }

  // --- Phase 2: Resolve tool call(s) (if any) and stream the rest ---
  if (calls.length > 0) {
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
      const modelFunctionCallParts = buildModelFunctionCallParts(calls);
      const toolResponseParts = buildFunctionResponseParts(calls, responses);
      const followupHistory: Content[] = [
        { role: "user", parts: [{ text: prompt }] },
        { role: "model", parts: modelFunctionCallParts },
      ];
      const followupChat = model.startChat({
        history: followupHistory,
      });

      const streamResult = await followupChat.sendMessageStream(toolResponseParts);

      for await (const chunk of streamResult.stream) {
        const parts = ((chunk as unknown as StreamChunkShape).candidates?.[0]?.content?.parts ?? []);
        for (const part of parts) {
          if (part.thought && modelPreference === "thinking") {
            yield `THOUGHT:${part.text}`;
          } else if (part.text) {
            yield part.text;
          }
        }
      }
      await streamResult.response;
    } catch (error) {
      console.error(`[answerWithContextStream] Phase 2 stream failed:`, error);
      throw error;
    }
    console.log(`[answerWithContextStream] Phase 2 stream complete.`);
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
            description: "Fetch recent commits. Provide a specific repository name, or leave empty (or use 'overall') for commits across all repositories.",
            parameters: {
              type: "OBJECT",
              properties: {
                repository: { type: "STRING", description: "Optional repository name for repo-specific commits." },
                limit: { type: "NUMBER", description: "Commit limit (MAX 20 for overall, 10 for specific repo)." },
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
              limit: { type: "NUMBER", description: "Commit limit (MAX 10)." },
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
        if (!snapshot.success) {
          return {
            functionResponseData: { error: snapshot.error, commits: [] },
            statusMessage: "Failed to fetch repository commits.",
            toolEvent: { name: "fetch_recent_commits", detail: repository, usageUnits: 1 },
          };
        }
        return {
          functionResponseData: {
            commits: snapshot.data.commits,
            scope: "repository",
            repository,
            limitExceeded,
            maxAllowed
          },
          statusMessage: `Fetching latest ${limit} commits of ${repository}...`,
          toolEvent: { name: "fetch_recent_commits", detail: repository, usageUnits: 1 },
          commitFreshnessLabel: `Commits checked: ${snapshot.data.freshness.label}`,
        };
      }

      const snapshot = await getRecentProfileCommitsSnapshot(repoDetails.owner, limit);
      if (!snapshot.success) {
        return {
          functionResponseData: { error: snapshot.error, commits: [] },
          statusMessage: "Failed to fetch profile commits.",
          toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        };
      }
      return {
        functionResponseData: {
          commits: snapshot.data.commits,
          scope: "overall",
          limitExceeded,
          maxAllowed
        },
        statusMessage: "Fetching latest commits across repositories...",
        toolEvent: { name: "fetch_recent_commits", detail: "overall", usageUnits: 1 },
        commitFreshnessLabel: `Commits checked: ${snapshot.data.freshness.label}`,
      };
    }

    const maxAllowed = MAX_REPO_COMMITS;
    const limit = Math.min(requestedLimit ?? maxAllowed, maxAllowed);
    const limitExceeded = (requestedLimit !== undefined && requestedLimit > maxAllowed);

    const snapshot = await getRecentRepoCommitsSnapshot(repoDetails.owner, repoDetails.repo, limit);
    if (!snapshot.success) {
      return {
        functionResponseData: { error: snapshot.error, commits: [] },
        statusMessage: "Failed to fetch repository commits.",
        toolEvent: { name: "fetch_recent_commits", detail: `${repoDetails.owner}/${repoDetails.repo}`, usageUnits: 1 },
      };
    }
    return {
      functionResponseData: {
        commits: snapshot.data.commits,
        scope: "repository",
        repository: repoDetails.repo,
        limitExceeded,
        maxAllowed
      },
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
