"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Terminal, Code2, BrainCircuit, CheckCircle2, ShieldAlert, GitMerge, ChevronLeft, ChevronRight } from "lucide-react";

function TypewriterText({ text, step }: { text: string; step: number }) {
    const [displayedText, setDisplayedText] = useState("");

    useEffect(() => {
        if (step === 0) {
            setDisplayedText("");
            return;
        }
        if (step >= 2) {
            setDisplayedText(text);
            return;
        }

        let i = 0;
        const speed = 1500 / text.length;
        const interval = setInterval(() => {
            setDisplayedText(text.substring(0, i + 1));
            i++;
            if (i >= text.length) clearInterval(interval);
        }, speed);

        return () => clearInterval(interval);
    }, [text, step]);

    return (
        <span className="whitespace-pre-wrap break-words">
            {displayedText}
            {(step === 0 || step === 1) && (
                <span className="inline-block w-[2px] h-[1em] bg-blue-500 animate-pulse align-middle ml-[2px]" />
            )}
        </span>
    );
}

// Define the different scenarios we want to loop through
const scenarios = [
    {
        id: "chat",
        title: "Chat with facebook/react",
        query: "Where is the authentication logic handled in this repository?",
        loadingText: "Reading repository index...",
        analyzingText: "Analyzing relevant files...",
        tags: [
            { icon: Code2, text: "packages/react/src/ReactContext.js", color: "text-green-400" },
            { icon: Code2, text: "packages/react-reconciler/src/ReactFiberHooks.js", color: "text-green-400" },
        ],
        type: "chat",
    },
    {
        id: "architecture",
        title: "Generate Architecture for vercel/next.js",
        query: "Visualize the routing architecture for App Router.",
        loadingText: "Parsing dependency graph...",
        analyzingText: "Generating Mermaid flowchart...",
        tags: [
            { icon: GitMerge, text: "packages/next/src/client/app-router.tsx", color: "text-blue-400" },
            { icon: GitMerge, text: "packages/next/src/server/app-render.tsx", color: "text-blue-400" },
        ],
        type: "architecture",
    },
    {
        id: "security",
        title: "Security Scan for supabase/supabase",
        query: "Are there any exposed secrets or SQL injection vulnerabilities?",
        loadingText: "Scanning abstract syntax trees...",
        analyzingText: "Cross-referencing CVE database...",
        tags: [
            { icon: ShieldAlert, text: "apps/studio/lib/api.ts", color: "text-red-400" },
        ],
        type: "security",
    }
];

export default function InteractiveDemo() {
    const [step, setStep] = useState(0);
    const [scenarioIndex, setScenarioIndex] = useState(0);
    const [playbackKey, setPlaybackKey] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const isInView = useInView(containerRef, { once: false, margin: "-100px" });

    const handleManualSwitch = (dir: 'next' | 'prev') => {
        if (dir === 'next') {
            setScenarioIndex((prev) => (prev + 1) % scenarios.length);
        } else {
            setScenarioIndex((prev) => (prev === 0 ? scenarios.length - 1 : prev - 1));
        }
        setStep(0);
        setPlaybackKey(k => k + 1);
    };

    useEffect(() => {
        // A simple state machine to drive the animation
        const sequence = [
            { step: 1, delay: 1000 }, // Wait, start typing
            { step: 2, delay: 2500 }, // Finished typing, hit enter, show loading
            { step: 3, delay: 1500 }, // AI starts analyzing context
            { step: 4, delay: 2000 }, // AI starts streaming answer
            { step: 5, delay: 6000 }, // Answer complete, wait before restart
            { step: 0, delay: 1000 }, // Reset and next scenario
        ];

        if (!isInView) {
            setStep(0);
            return;
        }

        let timer: NodeJS.Timeout;
        const runSequence = (index: number) => {
            // Loop back to the start when reaching the end of the sequence
            const nextIndex = index >= sequence.length ? 0 : index;

            setStep(sequence[nextIndex].step);

            // If we are resetting to step 0, increment the scenario index
            if (nextIndex === 0 && index !== 0) {
                setScenarioIndex((prev) => (prev + 1) % scenarios.length);
            }

            timer = setTimeout(() => runSequence(nextIndex + 1), sequence[nextIndex].delay);
        };

        timer = setTimeout(() => runSequence(0), 1000); // Initial start
        return () => clearTimeout(timer);
    }, [isInView, playbackKey]);

    const currentScenario = scenarios[scenarioIndex];

    const renderResponse = () => {
        if (currentScenario.type === "chat") {
            return (
                <div className="space-y-3 font-sans text-sm leading-relaxed">
                    <p>
                        In <span className="text-white font-medium">React</span>, there isn't traditional "authentication logic" built into the core library, as React is simply a UI library.
                    </p>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.8 }}
                    >
                        However, state management for authentication is typically handled using <span className="text-blue-400 font-mono text-xs bg-blue-900/20 px-1 rounded">React Context</span> and Hooks.
                    </motion.p>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1.5 }}
                        className="mt-4 bg-black/40 p-3 rounded-lg border border-zinc-800 border-l-4 border-l-purple-500"
                    >
                        <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold mb-2">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Recommended Pattern</span>
                        </div>
                        <code className="text-xs text-zinc-400 block overflow-hidden break-words whitespace-pre-wrap bg-black/50 p-2 rounded mt-2">
                            <span className="text-pink-400">const</span> AuthContext = createContext(<span className="text-orange-400">null</span>);<br />
                            <span className="text-pink-400">export function</span> <span className="text-blue-300">useAuth</span>() {'{'} <br />
                            &nbsp;&nbsp;<span className="text-pink-400">return</span> useContext(AuthContext);<br />
                            {'}'}
                        </code>
                    </motion.div>
                </div>
            );
        }

        if (currentScenario.type === "architecture") {
            return (
                <div className="space-y-3 font-sans text-sm leading-relaxed">
                    <p>
                        The Next.js App Router separates Client and Server components. Here is the requested logic flow:
                    </p>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-4 bg-zinc-900 overflow-hidden rounded-lg border border-zinc-700"
                    >
                        {/* Mock Flowchart UI */}
                        <div className="p-4 flex flex-col items-center gap-2 text-xs font-mono text-blue-300">
                            <div className="border border-blue-500/50 bg-blue-900/20 px-4 py-2 rounded">Client Request</div>
                            <div className="h-4 border-l border-blue-500/50"></div>
                            <div className="border border-purple-500/50 bg-purple-900/20 px-4 py-2 rounded text-purple-300">app-router.tsx (Layouts)</div>
                            <div className="h-4 border-l border-purple-500/50"></div>
                            <div className="border border-green-500/50 bg-green-900/20 px-4 py-2 rounded text-green-300">app-render.tsx (RSC Payload)</div>
                        </div>
                    </motion.div>
                </div>
            );
        }

        if (currentScenario.type === "security") {
            return (
                <div className="space-y-3 font-sans text-sm leading-relaxed">
                    <p>
                        I analyzed the codebase for standard vulnerabilities and hardcoded secrets.
                    </p>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-4 bg-red-950/20 p-3 rounded-lg border border-red-900/50 border-l-4 border-l-red-500"
                    >
                        <div className="flex items-center gap-2 text-red-500 text-xs font-semibold mb-2">
                            <ShieldAlert className="w-3 h-3" />
                            <span>1 High Severity Issue Found</span>
                        </div>
                        <p className="text-zinc-300 mb-2 text-xs">A potentially unparameterized raw SQL query was detected in the studio API.</p>
                        <code className="text-xs text-zinc-400 block p-2 bg-black/50 rounded overflow-hidden break-words whitespace-pre-wrap">
                            <span className="line-through text-red-400 px-1 bg-red-500/10 inline-block">{"const res = await db.query(`SELECT * FROM users WHERE id = ${id}`);"}</span><br />
                            <span className="text-green-400 px-1 bg-green-500/10 inline-block mt-1">{"+ const res = await db.query(\"SELECT * FROM users WHERE id = $1\", [id]);"}</span>
                        </code>
                    </motion.div>
                </div>
            )
        }
    };

    return (
        <section ref={containerRef} className="py-20 px-4 relative z-10 w-full max-w-5xl mx-auto flex flex-col items-center">
            <div className="text-center mb-10">
                <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                    See it in Action
                </h2>
                <div className="flex items-center justify-center gap-6 mb-6">
                    <button
                        onClick={() => handleManualSwitch('prev')}
                        className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
                        aria-label="Previous scenario"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex gap-2">
                        {scenarios.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => {
                                    setScenarioIndex(idx);
                                    setStep(0);
                                    setPlaybackKey(k => k + 1);
                                }}
                                className={`h-1.5 rounded-full transition-all duration-500 ${idx === scenarioIndex ? "w-8 bg-blue-500" : "w-3 bg-zinc-800 hover:bg-zinc-700"}`}
                                aria-label={`Go to scenario ${idx + 1}`}
                            />
                        ))}
                    </div>
                    <button
                        onClick={() => handleManualSwitch('next')}
                        className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
                        aria-label="Next scenario"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-zinc-400 text-lg md:text-xl">
                    Whether chatting, visualizing, or auditing, RepoMind handles it all.
                </p>
            </div>

            <div className="w-full relative rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl shadow-blue-900/10">
                {/* macOS window top bar */}
                <div className="flex items-center px-4 py-3 bg-zinc-900/50 border-b border-zinc-800 transition-colors duration-500">
                    <div className="flex space-x-2">
                        <div className="w-3 h-3 rounded-full bg-red-400/80" />
                        <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                        <div className="w-3 h-3 rounded-full bg-green-400/80" />
                    </div>
                    <div className="mx-auto flex items-center space-x-2 text-xs text-zinc-400 font-medium">
                        <Terminal className="w-3 h-3" />
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={currentScenario.id}
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                            >
                                {currentScenario.title}
                            </motion.span>
                        </AnimatePresence>
                    </div>
                </div>

                {/* Content Area */}
                <div className="p-6 md:p-8 space-y-6 min-h-[450px] overflow-hidden flex flex-col">
                    {/* User Query Bubble */}
                    <div className="flex gap-4 items-start w-full">
                        <div className="p-2 bg-blue-500/10 rounded-lg shrink-0 border border-blue-500/20 overflow-hidden">
                            <img src="/user-avatar.png" alt="User" className="w-6 h-6 rounded-sm object-cover" />
                        </div>
                        <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-xl rounded-tl-none w-full text-zinc-300 font-mono text-sm shadow-sm relative">
                            <div className="relative w-full">
                                <TypewriterText text={currentScenario.query} step={step} />
                            </div>
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {/* AI Status / Thinking state */}
                        {step >= 2 && step <= 3 && (
                            <motion.div
                                key={`status-${currentScenario.id}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, height: 0 }}
                                className="flex items-center gap-3 text-sm text-zinc-500 italic pl-14"
                            >
                                <motion.div>
                                    <BrainCircuit className="w-4 h-4 text-purple-400" />
                                </motion.div>
                                <span>{step === 2 ? currentScenario.loadingText : currentScenario.analyzingText}</span>
                            </motion.div>
                        )}

                        {/* AI Response Box */}
                        {step >= 4 && (
                            <motion.div
                                key={`response-${currentScenario.id}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="flex gap-4 items-start w-full"
                            >
                                <div className="p-1 bg-zinc-900 rounded-lg shrink-0 border border-zinc-700 shadow-[0_0_15px_rgba(255,255,255,0.05)] overflow-hidden flex items-center justify-center w-10 h-10">
                                    <img src="/1080x1080.png" alt="RepoMind" className="w-8 h-8 rounded-md object-cover" />
                                </div>

                                <div className="flex-1 space-y-4">
                                    {/* Referenced Files tags */}
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2 }}
                                        className="flex flex-wrap gap-2 mb-2"
                                    >
                                        {currentScenario.tags.map((tag, i) => {
                                            const TagIcon = tag.icon;
                                            return (
                                                <span key={i} className="flex items-center gap-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 px-2 py-1 rounded-md">
                                                    <TagIcon className={`w-3 h-3 ${tag.color}`} />
                                                    {tag.text}
                                                </span>
                                            )
                                        })}
                                    </motion.div>

                                    <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-5 rounded-2xl rounded-tl-none w-full text-zinc-300 shadow-sm relative overflow-hidden">
                                        {/* Dynamic accent line */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${currentScenario.type === "chat" ? "bg-purple-500/20" :
                                            currentScenario.type === "architecture" ? "bg-blue-500/20" :
                                                "bg-red-500/20"
                                            }`} />

                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ duration: 0.8 }}
                                        >
                                            {renderResponse()}
                                        </motion.div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Glow Effects */}
                <div className={`absolute top-1/2 left-1/4 w-32 h-32 blur-[60px] rounded-full pointer-events-none transition-colors duration-1000 ${currentScenario.type === "chat" ? "bg-blue-500/10" :
                    currentScenario.type === "architecture" ? "bg-purple-500/10" :
                        "bg-red-500/10"
                    }`} />
                <div className={`absolute bottom-1/4 right-1/4 w-32 h-32 blur-[60px] rounded-full pointer-events-none transition-colors duration-1000 ${currentScenario.type === "chat" ? "bg-purple-500/10" :
                    currentScenario.type === "architecture" ? "bg-blue-500/10" :
                        "bg-orange-500/10"
                    }`} />
            </div>
        </section>
    );
}
