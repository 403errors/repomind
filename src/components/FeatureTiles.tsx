"use client";

import type { ComponentType } from "react";
import { motion } from "framer-motion";
import {
    Shield,
    GitBranch,
    MessageSquare,
    CheckCircle2,
    Search,
    Sparkles,
    Code2
} from "lucide-react";
import { UserIcon } from "@/components/icons/UserIcon";

interface FeatureProps {
    icon: ComponentType<{ className?: string }>;
    title: string;
    description: string;
    gradient: string;
    delay: number;
}

const Feature = ({ icon: Icon, title, description, gradient, delay }: FeatureProps) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay }}
            whileHover={{ y: -8, scale: 1.02 }}
            className="group relative"
        >
            {/* Glow effect on hover */}
            <div className={`absolute -inset-0.5 ${gradient} rounded-xl blur opacity-0 group-hover:opacity-60 transition duration-500`} />

            {/* Card */}
            <div className="relative h-full bg-zinc-900/90 backdrop-blur-sm border border-white/10 rounded-xl p-6 hover:border-white/20 transition-all duration-300">
                {/* Icon container */}
                <div className={`w-14 h-14 rounded-lg ${gradient} p-0.5 mb-4`}>
                    <div className="w-full h-full bg-zinc-900 rounded-lg flex items-center justify-center">
                        <Icon className="w-6 h-6 text-white" />
                    </div>
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold text-white mb-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-zinc-400 transition-all duration-300">
                    {title}
                </h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                    {description}
                </p>

                {/* Decorative corner element */}
                <div className="absolute top-3 right-3 w-2 h-2 bg-gradient-to-br from-white/20 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
        </motion.div>
    );
};

export default function FeatureTiles() {
    const features = [
        {
            icon: Code2,
            title: "Deep Code Analysis",
            description: "Understand any codebase instantly with AI-powered insights. No cloning required.",
            gradient: "bg-gradient-to-br from-purple-600 to-blue-600",
            delay: 0,
        },
        {
            icon: Shield,
            title: "Vulnerability Scanner",
            description: "Detect security flaws, exposed secrets, and code vulnerabilities in seconds.",
            gradient: "bg-gradient-to-br from-red-600 to-orange-600",
            delay: 0.1,
        },
        {
            icon: GitBranch,
            title: "Architecture Visualizer",
            description: "Generate interactive flowcharts and architecture diagrams from your code.",
            gradient: "bg-gradient-to-br from-cyan-600 to-blue-600",
            delay: 0.2,
        },
        {
            icon: MessageSquare,
            title: "Ask Your Repo",
            description: "Chat with any repository. Get instant answers about implementation details.",
            gradient: "bg-gradient-to-br from-green-600 to-emerald-600",
            delay: 0.3,
        },
        {
            icon: UserIcon,
            title: "GitHub Profile Intel",
            description: "Analyze any developer's coding style, expertise, and open-source contributions.",
            gradient: "bg-gradient-to-br from-pink-600 to-purple-600",
            delay: 0.4,
        },
        {
            icon: CheckCircle2,
            title: "Code Quality Check",
            description: "Evaluate code quality, best practices, and get actionable recommendations.",
            gradient: "bg-gradient-to-br from-yellow-600 to-orange-600",
            delay: 0.5,
        },
        {
            icon: Search,
            title: "Smart Pattern Search",
            description: "Find specific patterns, functions, or logic across entire codebases instantly.",
            gradient: "bg-gradient-to-br from-indigo-600 to-purple-600",
            delay: 0.6,
        },
        {
            icon: Sparkles,
            title: "Tech Stack Analyzer",
            description: "Identify frameworks, libraries, and dependencies with detailed version info.",
            gradient: "bg-gradient-to-br from-teal-600 to-cyan-600",
            delay: 0.7,
        },
    ];

    return (
        <section className="w-full max-w-7xl mx-auto px-4 py-16">
            {/* Section Header */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-16"
            >
                <h2 className="text-4xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                    Supercharge Your Development
                </h2>
                <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
                    Powerful AI-driven features to analyze, understand, and improve any codebase
                </p>
            </motion.div>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {features.map((feature, index) => (
                    <Feature key={index} {...feature} />
                ))}
            </div>
        </section>
    );
}
