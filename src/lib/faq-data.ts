export type FaqItem = {
    question: string;
    answer: string;
};

export const FAQ_PAGE_ITEMS: FaqItem[] = [
    {
        question: "Is there an AI to understand GitHub codebases?",
        answer:
            "Yes. RepoMind uses Agentic Context-Augmented Generation (CAG) to analyze entire GitHub repositories, loading the full files needed to understand logic, dependencies, and architecture.",
    },
    {
        question: "How do I visualize a GitHub repository's architecture?",
        answer:
            "Paste a public GitHub repository URL into RepoMind and it generates architecture views, Mermaid flowcharts, and repository-level context without requiring a clone.",
    },
    {
        question: "How is RepoMind different from standard 'chat with your code' tools?",
        answer:
            "Standard RAG tools often work from disconnected chunks. RepoMind selects and loads complete files so the model keeps structural, dependency, and control-flow context.",
    },
    {
        question: "Does RepoMind scan for code vulnerabilities?",
        answer:
            "Yes. RepoMind includes built-in security auditing and dependency checks so you can identify application and dependency risks with repository context.",
    },
    {
        question: "Can I use RepoMind to analyze private repositories?",
        answer:
            "RepoMind is optimized for public GitHub repositories. Support for private repositories can be handled through authenticated workflows where enabled.",
    },
    {
        question: "Is it free to analyze public repositories?",
        answer:
            "Yes. Public repository analysis is available so you can explore architecture, code review, and security workflows without a heavy setup.",
    },
];

export const HOME_FAQ_ITEMS = FAQ_PAGE_ITEMS.slice(0, 3);
