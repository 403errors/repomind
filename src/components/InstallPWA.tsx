"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface IOSNavigator extends Navigator {
    MSStream?: unknown;
}

export function InstallPWA() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isIOS] = useState(() => {
        if (typeof window === "undefined") return false;
        const nav = window.navigator as IOSNavigator;
        return /iPad|iPhone|iPod/.test(nav.userAgent) && !nav.MSStream;
    });
    const [isStandalone] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(display-mode: standalone)").matches;
    });

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Stash the event so it can be triggered later.
            setDeferredPrompt(e as BeforeInstallPromptEvent);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (isIOS) {
            toast.info("To install on iOS: tap 'Share' then 'Add to Home Screen'", {
                duration: 5000,
                icon: <Download className="w-4 h-4" />
            });
            return;
        }

        if (!deferredPrompt) return;

        // Show the install prompt
        await deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const choiceResult = await deferredPrompt.userChoice;

        if (choiceResult.outcome === "accepted") {
            console.log("User accepted the install prompt");
            setDeferredPrompt(null);
        } else {
            console.log("User dismissed the install prompt");
        }
    };

    // Don't show if already installed or on desktop (md:hidden handles desktop view, but we also check standalone)
    if (isStandalone) return null;

    // Render logic:
    // 1. If deferredPrompt is set (Android/Chrome), show button.
    // 2. If iOS, show button (since iOS doesn't fire beforeinstallprompt).
    // 3. CSS hides it on desktop (md:hidden).
    if (!deferredPrompt && !isIOS) return null;

    return (
        <button
            onClick={handleInstallClick}
            className="fixed bottom-6 right-6 z-50 md:hidden flex items-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-full shadow-lg transition-all duration-300 transform active:scale-95 animate-in fade-in slide-in-from-bottom-4"
        >
            <Download className="w-5 h-5 text-blue-400" />
            <span className="font-medium text-sm text-white">Install App</span>
        </button>
    );
}
