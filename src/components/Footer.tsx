"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
    MessageSquarePlus, 
    X, 
    Copy, 
    Check, 
    Github, 
    Twitter, 
    Linkedin, 
    Mail, 
    ArrowUpRight,
    Globe,
    Zap
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const socialLinks = [
    { name: "GitHub", icon: Github, href: "https://github.com/403errors/repomind" },
    { name: "Twitter", icon: Twitter },
    { name: "LinkedIn", icon: Linkedin },
];

const footerLinks = {
    explore: [
        { name: "Solutions", href: "/solutions" },
        { name: "Compare", href: "/compare" },
        { name: "Insights", href: "/blog" },
        { name: "SEO Topics", href: "/explore" },
        { name: "FAQ", href: "/faq" },
    ],
    company: [
        { name: "About", href: "/about" },
        { name: "Privacy", href: "/privacy" },
        { name: "Terms", href: "/terms" },
    ],
    product: [
        { name: "Repository Analysis", href: "/coming-soon?feature=repository-analysis" },
        { name: "AI Code Review Tool", href: "/coming-soon?feature=ai-code-review-tool" },
        { name: "Security Scanner", href: "/coming-soon?feature=security-scanner" },
    ]
};

export default function Footer() {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const email = "pieisnot22by7@gmail.com";

    const handleCopy = () => {
        navigator.clipboard.writeText(email);
        setCopied(true);
        toast.success("Email copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <footer className="relative z-10 border-t border-white/5 bg-[#09090b] pt-16 pb-8 overflow-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
            <div className="absolute top-0 left-1/4 w-64 h-64 bg-blue-600/5 rounded-full blur-[120px] -translate-y-1/2" />
            <div className="absolute top-0 right-1/4 w-64 h-64 bg-cyan-600/5 rounded-full blur-[120px] -translate-y-1/2" />

            <div className="max-w-7xl mx-auto px-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 pb-16">
                    {/* Brand Section */}
                    <div className="lg:col-span-4 space-y-6">
                        <Link href="/" className="flex items-center gap-3 group">
                            <div>
                                <h2 className="text-xl font-bold text-white tracking-tight group-hover:text-cyan-400 transition-colors">RepoMind</h2>
                                <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Repository Intelligence</p>
                            </div>
                        </Link>
                        
                        <p className="text-zinc-400 text-sm leading-relaxed max-w-sm">
                            Next-generation AI agents for deep repository analysis, automated code reviews, and proactive security scanning.
                        </p>

                        <div className="flex items-center gap-4">
                            {socialLinks.map((social) => (
                                social.href ? (
                                    <Link 
                                        key={social.name} 
                                        href={social.href}
                                        className="p-2.5 rounded-lg bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:border-white/20 hover:bg-zinc-800 transition-all"
                                        aria-label={social.name}
                                    >
                                        <social.icon className="w-4.5 h-4.5" />
                                    </Link>
                                ) : (
                                    <span 
                                        key={social.name} 
                                        className="p-2.5 rounded-lg bg-zinc-900/50 border border-white/5 text-zinc-600 cursor-not-allowed transition-all"
                                        aria-label={social.name}
                                    >
                                        <social.icon className="w-4.5 h-4.5" />
                                    </span>
                                )
                            ))}
                        </div>
                    </div>

                    {/* Links Sections */}
                    <div className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-3 gap-8">
                        {/* Explore */}
                        <div className="space-y-4">
                            <h3 className="text-white text-sm font-semibold tracking-wide uppercase">Explore</h3>
                            <ul className="space-y-3">
                                {footerLinks.explore.map((link) => (
                                    <li key={link.name}>
                                        <Link href={link.href} className="text-zinc-400 hover:text-cyan-400 text-sm transition-colors flex items-center justify-between group">
                                            {link.name}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Company */}
                        <div className="space-y-4">
                            <h3 className="text-white text-sm font-semibold tracking-wide uppercase">Company</h3>
                            <ul className="space-y-3">
                                {footerLinks.company.map((link) => (
                                    <li key={link.name}>
                                        <Link href={link.href} className="text-zinc-400 hover:text-cyan-400 text-sm transition-colors">
                                            {link.name}
                                        </Link>
                                    </li>
                                ))}
                                <li>
                                    <button 
                                        onClick={() => setIsOpen(true)}
                                        className="text-zinc-400 hover:text-cyan-400 text-sm transition-colors"
                                    >
                                        Contact
                                    </button>
                                </li>
                            </ul>
                        </div>

                        {/* Product */}
                        <div className="space-y-4 col-span-2 sm:col-span-1">
                            <h3 className="text-white text-sm font-semibold tracking-wide uppercase">Product</h3>
                            <ul className="space-y-3">
                                {footerLinks.product.map((link) => (
                                    <li key={link.name}>
                                        <Link href={link.href} className="text-zinc-400 hover:text-cyan-400 text-sm transition-colors flex items-center justify-between group">
                                            {link.name}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* CTA Section */}
                    <div className="lg:col-span-3 space-y-6">
                        <div className="relative group">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
                            <div className="relative rounded-2xl bg-zinc-950 border border-white/10 p-5 space-y-4">
                                <div className="space-y-1">
                                    <h4 className="text-white font-medium flex items-center gap-2">
                                        <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
                                        Have an idea?
                                    </h4>
                                    <p className="text-zinc-500 text-xs">Help us build the ultimate repository tool.</p>
                                </div>
                                <button
                                    onClick={() => setIsOpen(true)}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 transition-all font-semibold text-sm shadow-[0_2px_10px_rgba(255,255,255,0.1)] active:scale-[0.98]"
                                >
                                    <MessageSquarePlus className="w-4 h-4" />
                                    Request a feature
                                </button>
                            </div>
                        </div>

                        {/* Status Widget */}
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-white/5 w-fit">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="text-zinc-400 text-[10px] font-medium uppercase tracking-widest">All systems operational</span>
                        </div>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
                        <p className="text-zinc-600 text-[11px] font-medium tracking-tight">
                            © {new Date().getFullYear()} REPOMIND. BUILT BY DEVELOPERS FOR DEVELOPERS.
                        </p>
                        <div className="flex items-center gap-4 text-zinc-500 text-[11px] font-medium">
                            <span className="flex items-center gap-1.5 cursor-default hover:text-zinc-300 transition-colors">
                                <Globe className="w-3 h-3" />
                                GLOBAL CACHE REDUNDANCY
                            </span>
                            <span className="hidden sm:inline w-1 h-1 rounded-full bg-zinc-800" />
                            <span className="flex items-center gap-1.5 cursor-default hover:text-zinc-300 transition-colors">
                                <Zap className="w-3 h-3" />
                                99.9% UPTIME SLA
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer group">
                        <span className="text-[11px] font-medium group-hover:text-white transition-colors">Made with precision in mind</span>
                        <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-cyan-400" />
                    </div>
                </div>
            </div>

            {/* Contact Popup */}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsOpen(false)}
                                className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
                            />
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="fixed inset-x-4 top-[15%] md:left-1/2 md:-ml-[224px] md:top-1/2 md:-mt-[200px] w-auto max-w-md bg-zinc-950 border border-white/10 rounded-3xl p-8 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] z-[101] overflow-hidden"
                            >
                                {/* Popup Glow */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-1/2 bg-blue-500/10 rounded-full blur-[80px] -z-10" />

                                <div className="flex items-center justify-between mb-8">
                                    <div className="space-y-1">
                                        <h3 className="text-2xl font-bold text-white tracking-tight leading-none">Get in touch</h3>
                                        <p className="text-zinc-500 text-xs">We typically respond within 24 hours.</p>
                                    </div>
                                    <button
                                        onClick={() => setIsOpen(false)}
                                        className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="space-y-6">
                                    <p className="text-zinc-400 text-sm leading-relaxed">
                                        Found a bug, have a feature request, or just want to say hi? We&apos;d love to hear from you.
                                    </p>

                                    <div className="relative group">
                                        <div className="absolute -inset-px bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" />
                                        <div className="relative flex items-center gap-3 p-4 bg-black rounded-2xl border border-white/5">
                                            <div className="p-2 rounded-lg bg-zinc-900 text-cyan-400">
                                                <Mail className="w-4 h-4" />
                                            </div>
                                            <code className="flex-1 text-zinc-300 font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                                                {email}
                                            </code>
                                            <button
                                                onClick={handleCopy}
                                                className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                                title="Copy email"
                                            >
                                                {copied ? (
                                                    <Check className="w-4 h-4 text-emerald-400" />
                                                ) : (
                                                    <Copy className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={() => window.location.href = `mailto:${email}`}
                                            className="flex-1 px-6 py-3 bg-white text-black rounded-2xl font-bold hover:bg-zinc-100 transition-all text-sm shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)] active:scale-[0.98]"
                                        >
                                            Send Direct Email
                                        </button>
                                        <button
                                            onClick={() => setIsOpen(false)}
                                            className="px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all text-sm border border-white/5"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </footer>
    );
}
