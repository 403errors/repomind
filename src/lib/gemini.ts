import { getGenAI, DEFAULT_MODEL, type ModelPreference } from "./ai-client";
import { buildRepoMindPrompt, formatHistoryText } from "./prompt-builder";
import { cacheQuerySelection, getCachedQuerySelection } from "./cache";
import type { GitHubProfile } from "./github";

// ─── File Selection ────────────────────────────────────────────────────────────

export async function analyzeFileSelection(
  question: string,
  fileTree: string[],
  owner?: string,
  repo?: string
): Promise<string[]> {
  // 1. SMART BYPASS: Check if the user explicitly mentioned a file
  const mentionedFiles = fileTree.filter((path) => {
    const filename = path.split("/").pop();
    if (!filename) return false;
    return question.toLowerCase().includes(filename.toLowerCase());
  });

  if (mentionedFiles.length > 0) {
    console.log("⚡ Smart Bypass: Found mentioned files:", mentionedFiles);
    const commonFiles = ["package.json", "README.md", "tsconfig.json"];
    const additionalContext = fileTree.filter(
      (f) => commonFiles.includes(f) && !mentionedFiles.includes(f)
    );
    return [...mentionedFiles, ...additionalContext].slice(0, 10);
  }

  // 2. QUERY CACHING: Check if we've answered this exact query for this repo before
  if (owner && repo) {
    const cachedSelection = await getCachedQuerySelection(owner, repo, question);
    if (cachedSelection) {
      console.log("🧠 Query Cache Hit:", question);
      return cachedSelection;
    }
  }

  // 3. AI SELECTION (Fallback)

  // HIERARCHICAL PRUNING for large repos (> 1,000 files)
  let candidates = fileTree;
  if (fileTree.length > 1000) {
    console.log(`🌳 Repo too large (${fileTree.length} files), performing hierarchical pruning...`);
    candidates = await pruneFileTreeHierarchically(question, fileTree);
  }

  const prompt = `
    Select relevant files for this query from the list below.
    Query: "${question}"
    
    Files:
    ${candidates.slice(0, 500).join("\n")}
    
    Rules:
    - Return JSON: { "files": ["path/to/file"] }
    - Max 50 files.
    - Select the MINIMUM number of files necessary to answer the query.
    - CRITICAL: Prioritize source code files (ts, js, py, etc.) over documentation (md) for technical queries.
    - Only pick README.md if the query is about "what is this repo", "installation", or high-level features.
    - For "how does this work" or "logic" queries, MUST select the actual source code files.
    - NO EXPLANATION. JSON ONLY.
    `;

  try {
    // For large/complex selections, we use the reasoning model with low thinking to keep it fast
    const model = getGenAI().getGenerativeModel({
      model: DEFAULT_MODEL,
      generationConfig: {
        thinkingConfig: {
          thinking_level: "LOW"
        }
      } as any
    });

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const cleanResponse = response.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    const selectedFiles: string[] = parsed.files || [];

    if (owner && repo && selectedFiles.length > 0) {
      await cacheQuerySelection(owner, repo, question, selectedFiles);
    }

    return selectedFiles;
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
      model: DEFAULT_MODEL,
      generationConfig: {
        thinkingConfig: { thinking_level: "MINIMAL" }
      } as any
    });

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const cleanResponse = response.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    const targetDirs: string[] = parsed.directories || [];

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
  profileData?: GitHubProfile,
  history: { role: "user" | "model"; content: string }[] = [],
  modelPreference: ModelPreference = "flash"
): Promise<string> {
  const historyText = formatHistoryText(history);
  const prompt = buildRepoMindPrompt({ question, context, repoDetails, historyText });

  const model = getGenAI().getGenerativeModel({
    model: DEFAULT_MODEL,
    tools: [{ googleSearch: {} } as any],
    generationConfig: {
      thinkingConfig: {
        thinking_level: modelPreference === "thinking" ? "HIGH" : "LOW"
      }
    } as any
  });

  const result = await model.generateContent(prompt);
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
  profileData?: GitHubProfile,
  history: { role: "user" | "model"; content: string }[] = [],
  modelPreference: ModelPreference = "flash"
): AsyncGenerator<string> {
  const historyText = formatHistoryText(history);
  const prompt = buildRepoMindPrompt({ question, context, repoDetails, historyText });

  const model = getGenAI().getGenerativeModel({
    model: DEFAULT_MODEL,
    tools: [{ googleSearch: {} } as any],
    generationConfig: {
      thinkingConfig: {
        thinking_level: modelPreference === "thinking" ? "HIGH" : "LOW"
      }
    } as any
  });

  const result = await model.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield text;
    }
  }
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

Return ONLY the corrected Mermaid code in a markdown code block. Do not explain. Just return:
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
