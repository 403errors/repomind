import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RepoCard } from "./RepoCard";
import { DeveloperCard } from "./DeveloperCard";

interface ParsedContent {
    type: "markdown" | "repo-card" | "developer-card";
    content: string | Record<string, string>;
}

/**
 * Parse a string that may contain custom card blocks (repo-card / developer-card)
 * and split it into an ordered list of markdown fragments and card data.
 */
export function parseCardContent(text: string): ParsedContent[] {
    const parts: ParsedContent[] = [];
    let currentIndex = 0;
    const cardRegex = /:::(repo-card|developer-card)\n([\s\S]*?):::/g;
    let match: RegExpExecArray | null;

    while ((match = cardRegex.exec(text)) !== null) {
        // Push any preceding markdown
        if (match.index > currentIndex) {
            const markdown = text.slice(currentIndex, match.index).trim();
            if (markdown) {
                parts.push({ type: "markdown", content: markdown });
            }
        }
        const cardType = match[1] as "repo-card" | "developer-card";
        const cardBody = match[2];
        const cardData: Record<string, string> = {};
        cardBody.split("\n").forEach((line) => {
            const [key, ...rest] = line.split(":");
            if (key && rest.length) {
                cardData[key.trim()] = rest.join(":").trim();
            }
        });
        parts.push({ type: cardType, content: cardData });
        currentIndex = match.index + match[0].length;
    }

    // Remaining markdown after last card
    if (currentIndex < text.length) {
        const markdown = text.slice(currentIndex).trim();
        if (markdown) {
            parts.push({ type: "markdown", content: markdown });
        }
    }

    return parts;
}

interface EnhancedMarkdownProps {
    content: string;
    components?: any;
}

export function EnhancedMarkdown({ content, components }: EnhancedMarkdownProps) {
    const parts = parseCardContent(content);
    return (
        <>
            {parts.map((part, index) => {
                if (part.type === "markdown") {
                    return (
                        <ReactMarkdown
                            key={index}
                            components={components}
                            remarkPlugins={[remarkGfm]}
                        >
                            {part.content as string}
                        </ReactMarkdown>
                    );
                }
                if (part.type === "repo-card") {
                    const data = part.content as Record<string, string>;
                    return (
                        <RepoCard
                            key={index}
                            owner={data.owner || ""}
                            name={data.name || ""}
                            description={data.description}
                            stars={data.stars ? parseInt(data.stars) : undefined}
                            forks={data.forks ? parseInt(data.forks) : undefined}
                            language={data.language}
                        />
                    );
                }
                if (part.type === "developer-card") {
                    const data = part.content as Record<string, string>;
                    return (
                        <DeveloperCard
                            key={index}
                            username={data.username || ""}
                            name={data.name}
                            avatar={data.avatar}
                            bio={data.bio}
                            location={data.location}
                            blog={data.blog}
                        />
                    );
                }
                return null;
            })}
        </>
    );
}
