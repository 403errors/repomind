"use server";

import { getProfile, getRepo, getRepoFileTree, getFileContent, getProfileReadme, getAllRepoReadmes } from "@/lib/github";
import { analyzeFileSelection, answerWithContext } from "@/lib/gemini";

export async function fetchGitHubData(input: string) {
    // Input format: "username" or "owner/repo"
    const parts = input.split("/");

    if (parts.length === 1) {
        // Profile Mode
        const username = parts[0];
        try {
            // We just return basic profile info here for the initial load
            // The rest will be loaded by the client component
            const profile = await getProfile(username);
            return { type: "profile", data: profile };
        } catch (e) {
            return { error: "User not found" };
        }
    } else if (parts.length === 2) {
        // Repo Mode
        const [owner, repo] = parts;
        try {
            const repoData = await getRepo(owner, repo);
            const fileTree = await getRepoFileTree(owner, repo);
            return { type: "repo", data: repoData, fileTree };
        } catch (e) {
            return { error: "Repository not found" };
        }
    }

    return { error: "Invalid input format" };
}

export async function fetchProfile(username: string) {
    return await getProfile(username);
}

export async function fetchProfileReadme(username: string) {
    return await getProfileReadme(username);
}

export async function fetchUserRepos(username: string) {
    return await getAllRepoReadmes(username);
}

export async function processChatQuery(
    query: string,
    repoContext: { owner: string; repo: string; filePaths: string[] }
) {
    // 1. Agentic Selection: Which files do we need?
    const filePaths = repoContext.filePaths;
    const relevantFiles = await analyzeFileSelection(query, filePaths);

    console.log("Selected files:", relevantFiles);

    // 2. Retrieval: Fetch content of relevant files
    let context = "";
    for (const file of relevantFiles) {
        try {
            const content = await getFileContent(repoContext.owner, repoContext.repo, file);
            context += `\n--- FILE: ${file} ---\n${content}\n`;
        } catch (e) {
            console.warn(`Failed to fetch ${file}`, e);
        }
    }

    // 3. Synthesis: Answer the question
    if (!context) {
        // If no files selected, try to answer generally or say we need more info
        context = "No specific files were selected. Answer based on general knowledge or explain that you need to check specific files.";
    }

    const answer = await answerWithContext(query, context, { owner: repoContext.owner, repo: repoContext.repo });
    return { answer, relevantFiles };
}

export async function processProfileQuery(
    query: string,
    profileContext: { username: string; profileReadme: string | null; repoReadmes: { repo: string; content: string }[] }
) {
    // Build context from profile README and repo READMEs
    let context = "";

    if (profileContext.profileReadme) {
        context += `\n--- ${profileContext.username}'S PROFILE README ---\n${profileContext.profileReadme}\n\n`;
    }

    // Add repo READMEs
    for (const readme of profileContext.repoReadmes) {
        context += `\n--- README from ${readme.repo} ---\n${readme.content}\n\n`;
    }

    if (!context) {
        context = `No profile README or repository READMEs found for ${profileContext.username}.`;
    }

    // Answer using profile context
    const prompt = `
    You are analyzing the GitHub profile of: ${profileContext.username}
    
    CONTEXT:
    ${context}
    
    USER QUESTION:
    ${query}
    
    Answer the question based on the profile README and repository READMEs provided. Be insightful about their projects, skills, and contributions.
    `;

    const answer = await answerWithContext(query, context, { owner: profileContext.username, repo: "profile" });
    return { answer };
}
