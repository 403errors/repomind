"use client";

import { useState } from "react";

import { Sparkles } from "lucide-react";
import { WhatsNewModal } from "./WhatsNewModal";

export function WhatsNewBadge() {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setIsModalOpen(true)}
                className="fixed top-6 left-6 z-[999] hover:scale-105 transition-transform"
            >
                <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-600/30 rounded-full backdrop-blur-md hover:border-purple-600/50 transition-colors">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                    </span>
                    <span className="text-sm font-medium text-purple-200">What's New</span>
                </div>
            </button>

            <WhatsNewModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </>
    );
}
