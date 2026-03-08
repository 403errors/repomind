"use client";

import { useState, useEffect } from "react";
import { RepoSidebar } from "./RepoSidebar";
import { ChatInterface } from "./ChatInterface";
import { FilePreview } from "./FilePreview";
import type { FileNode, GitHubRepo } from "@/lib/github";

interface RepoLayoutProps {
    fileTree: FileNode[];
    repoName: string;
    owner: string;
    repo: string;
    hiddenFiles?: { path: string; reason: string }[];
    repoData: GitHubRepo;
    initialPrompt?: string;
}

export function RepoLayout({ fileTree, repoName, owner, repo, hiddenFiles = [], repoData, initialPrompt }: RepoLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [previewFile, setPreviewFile] = useState<string | null>(null);

    const handleFileDoubleClick = (filePath: string) => {
        setPreviewFile(filePath);
        // Close sidebar on mobile after selecting a file
        if (window.innerWidth < 768) {
            setSidebarOpen(false);
        }
    };

    // Listen for custom event to open file preview from chat
    useEffect(() => {
        const handleOpenPreview = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            setPreviewFile(customEvent.detail);
        };

        window.addEventListener("open-file-preview", handleOpenPreview as EventListener);
        return () => {
            window.removeEventListener("open-file-preview", handleOpenPreview as EventListener);
        };
    }, []);

    return (
        <>
            <div className="flex h-[100dvh] w-full bg-black overflow-hidden">
                <RepoSidebar
                    fileTree={fileTree}
                    repoName={repoName}
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                    onFileDoubleClick={handleFileDoubleClick}
                    hiddenFiles={hiddenFiles}
                    repoData={repoData}
                />
                <div className="flex-1 h-full flex flex-col min-w-0">
                    {/* Hamburger button for mobile */}
                    <ChatInterface
                        repoContext={{
                            owner,
                            repo,
                            fileTree
                        }}
                        onToggleSidebar={() => setSidebarOpen(true)}
                        initialPrompt={initialPrompt}
                    />
                </div>
            </div>

            <FilePreview
                isOpen={previewFile !== null}
                filePath={previewFile}
                repoOwner={owner}
                repoName={repo}
                onClose={() => setPreviewFile(null)}
            />
        </>
    );
}
