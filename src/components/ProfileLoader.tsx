"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { User, Loader2, CheckCircle2, FileCode } from "lucide-react";
import { ProfileChatInterface } from "./ProfileChatInterface";
import { fetchProfile, fetchProfileReadme, fetchUserRepos } from "@/app/actions";

interface LoadingStep {
    id: string;
    message: string;
    status: "loading" | "complete" | "error";
}

interface ProfileLoaderProps {
    username: string;
}

export function ProfileLoader({ username }: ProfileLoaderProps) {
    const [steps, setSteps] = useState<LoadingStep[]>([]);
    const [profileData, setProfileData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadProfile();
    }, [username]);

    const updateStep = (id: string, status: "loading" | "complete" | "error", message?: string) => {
        setSteps((prev) => {
            const existing = prev.find((s) => s.id === id);
            if (existing) {
                return prev.map((s) =>
                    s.id === id ? { ...s, status, message: message || s.message } : s
                );
            }
            return [...prev, { id, message: message || "", status }];
        });
    };

    const loadProfile = async () => {
        try {
            // Step 1: Fetch profile
            updateStep("profile", "loading", `Fetching @${username}'s profile...`);
            const profile = await fetchProfile(username);
            updateStep("profile", "complete", `Profile loaded`);

            // Step 2: Fetch profile README
            updateStep("readme", "loading", "Reading profile README...");
            let profileReadme = null;
            try {
                profileReadme = await fetchProfileReadme(username);
                updateStep("readme", "complete", "Profile README found");
            } catch (e) {
                updateStep("readme", "complete", "No profile README");
            }

            // Step 3: Fetch repositories
            updateStep("repos", "loading", `Found ${profile.public_repos} repositories`);
            const repoReadmes = await fetchUserRepos(username);
            updateStep("repos", "complete", `Analyzed ${repoReadmes.length} repositories`);

            // Individual repo updates
            repoReadmes.slice(0, 5).forEach((repo: any, index: number) => {
                updateStep(`repo-${index}`, "complete", `✓ ${repo.repo}`);
            });

            if (repoReadmes.length > 5) {
                updateStep("repos-more", "complete", `+ ${repoReadmes.length - 5} more repositories`);
            }

            // All done
            setProfileData({ profile, profileReadme, repoReadmes });
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Failed to load profile");
            updateStep("error", "error", "Failed to load profile");
        }
    };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-4">
                <User className="w-16 h-16 text-red-500" />
                <h1 className="text-2xl font-bold">Error Loading Profile</h1>
                <p className="text-zinc-400">{error}</p>
            </div>
        );
    }

    if (!profileData) {
        return (
            <div className="flex items-center justify-center h-screen bg-black text-white">
                <div className="max-w-md w-full p-8">
                    <div className="mb-8 text-center">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mb-4 inline-block"
                        >
                            <img
                                src={`https://github.com/${username}.png`}
                                alt={username}
                                className="w-24 h-24 rounded-2xl border-4 border-zinc-900 shadow-xl"
                            />
                        </motion.div>
                        <h2 className="text-2xl font-bold mb-2">Loading @{username}</h2>
                        <p className="text-sm text-zinc-500">Analyzing profile and repositories...</p>
                    </div>

                    <div className="space-y-3">
                        {steps.map((step, index) => (
                            <motion.div
                                key={step.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-lg"
                            >
                                {step.status === "loading" && (
                                    <Loader2 className="w-5 h-5 text-purple-400 animate-spin shrink-0" />
                                )}
                                {step.status === "complete" && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                )}
                                {step.status === "error" && (
                                    <FileCode className="w-5 h-5 text-red-500 shrink-0" />
                                )}
                                <span className="text-sm text-zinc-300">{step.message}</span>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <ProfileChatInterface
            profile={profileData.profile}
            profileReadme={profileData.profileReadme}
            repoReadmes={profileData.repoReadmes}
        />
    );
}
