import { Metadata } from "next";

export const metadata: Metadata = {
    title: "FAQ - Codebase Analysis & Visual Architecture",
    description: "Frequently asked questions about RepoMind's Agentic CAG, GitHub repository analysis, architecture visualization, and security scanning.",
    alternates: {
        canonical: "/faq",
    },
};

const faqs = [
    {
        question: "Is there an AI to understand GitHub codebases?",
        answer: "Yes, RepoMind uses Agentic Context-Augmented Generation (CAG) to analyze entire GitHub repositories. Instead of just searching for keywords, it acts like a senior developer, reading the complete directory structure and fetching the exact full files needed to understand complex logic, dependencies, and architecture."
    },
    {
        question: "How do I visualize a GitHub repository's architecture?",
        answer: "You can visualize any public GitHub repository's architecture without cloning it by pasting the repository URL into RepoMind. The system reads the core files and automatically generates interactive Mermaid flowcharts and sequence diagrams mapping out the repository's logical flow."
    },
    {
        question: "How is RepoMind different from standard 'chat with your code' tools?",
        answer: "Standard RAG (Retrieval-Augmented Generation) tools chop your code into arbitrary chunks, losing critical context like imports and file structure. RepoMind explicitly selects and loads complete files, preserving the exact relational context needed for deep architectural understanding."
    },
    {
        question: "Can I analyze an individual developer's GitHub profile?",
        answer: "Yes, you can input any developer's GitHub username to generate a comprehensive profile analysis. RepoMind will summarize their technical stack, core skills, language preferences, and recent project contributions to help you understand their engineering footprint."
    },
    {
        question: "Does RepoMind scan for code vulnerabilities?",
        answer: "Yes, RepoMind includes built-in security auditing. It performs real-time dependency checks against the OSV (Open Source Vulnerabilities) API, providing a verification-first scanning flow that identifies application and dependency risks quickly."
    },
    {
        question: "Can I use RepoMind to analyze private repositories?",
        answer: "Currently, RepoMind is optimized for public GitHub repositories seamlessly without requiring complex OAuth setups. Support for private repository analysis via secure OAuth tokens is planned for enterprise and authorized developer use."
    },
    {
        question: "Is it free to analyze public repositories?",
        answer: "Yes, an anonymous tier is freely available allowing you to use Lite analysis mode on public repositories and profiles, making it instantly accessible for developers exploring open-source code."
    }
];

export default function FAQPage() {
    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer,
            },
        })),
    };

    return (
        <main className="min-h-screen max-w-4xl mx-auto py-24 px-6">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />
            
            <div className="mb-12">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-white">Frequently Asked Questions</h1>
                <p className="text-lg text-zinc-400">Everything you need to know about analyzing, visualizing, and querying GitHub repositories with RepoMind.</p>
            </div>

            <div className="space-y-8">
                {faqs.map((faq, index) => (
                    <div key={index} className="border-b border-white/10 pb-6 last:border-0">
                        <h2 className="text-xl font-semibold mb-3 text-white">{faq.question}</h2>
                        <p className="text-zinc-400 leading-relaxed">{faq.answer}</p>
                    </div>
                ))}
            </div>
            
            <div className="mt-16 text-center">
                <a href="/" className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-black bg-white hover:bg-zinc-200 transition-colors">
                    Start Analyzing for Free
                </a>
            </div>
        </main>
    );
}
