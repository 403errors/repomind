"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Link as LinkIcon, Github, Loader2 } from "lucide-react";
import { UserIcon } from "@/components/icons/UserIcon";
import { fetchProfile } from "@/app/actions";

interface DeveloperCardProps {
    username: string;
    name?: string;
    avatar?: string;
    bio?: string;
    location?: string;
    blog?: string;
}

export function DeveloperCard({ username, name: initialName, avatar: initialAvatar, bio: initialBio, location: initialLocation, blog: initialBlog }: DeveloperCardProps) {
    const [profile, setProfile] = useState({
        name: initialName,
        avatar: initialAvatar,
        bio: initialBio,
        location: initialLocation,
        blog: initialBlog
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const shouldFetch = !initialAvatar || !initialBio || !initialName || username === "403errors";
        if (!username || !shouldFetch) return;

        let cancelled = false;

        const run = async () => {
            setLoading(true);
            try {
                const data = await fetchProfile(username);
                if (!cancelled && data) {
                    setProfile((prev) => ({
                        name: data.name || prev.name,
                        avatar: data.avatar_url || prev.avatar,
                        bio: data.bio || prev.bio,
                        location: data.location || prev.location,
                        blog: data.blog || prev.blog
                    }));
                }
            } catch (error) {
                console.error(error);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [username, initialAvatar, initialBio, initialName]);

    // Use a stable avatar source: provided -> fetched -> github direct fallback
    const avatarSrc = profile.avatar || `https://github.com/${username}.png`;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-4 group"
        >
            <div className="relative bg-zinc-900 border border-white/10 rounded-xl p-5 hover:border-purple-600/50 transition-all duration-300">
                {/* Gradient glow on hover */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500" />

                <div className="relative flex gap-4">
                    {/* Avatar */}
                    <div className="relative w-16 h-16 shrink-0">
                        <img
                            src={avatarSrc}
                            alt={username}
                            className="w-16 h-16 rounded-full border-2 border-white/20 bg-zinc-800 object-cover"
                            onError={(e) => {
                                // Fallback to icon if image fails to load
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                        />
                        <div className="hidden w-16 h-16 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center overflow-hidden">
                            <UserIcon className="w-full h-full text-white" />
                        </div>
                        {loading && !profile.avatar && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full">
                                <Loader2 className="w-5 h-5 animate-spin text-white" />
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        {/* Name & Username */}
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-semibold text-white truncate">
                                {profile.name || username}
                            </h3>
                            {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                        </div>
                        <p className="text-sm text-zinc-400 mb-2 truncate">@{username}</p>

                        {/* Bio */}
                        {profile.bio && (
                            <p className="text-zinc-400 text-sm mb-3 line-clamp-2">{profile.bio}</p>
                        )}

                        {/* Additional info */}
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500 mb-4">
                            {profile.location && (
                                <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {profile.location}
                                </span>
                            )}
                            {profile.blog && (
                                <a
                                    href={profile.blog.startsWith('http') ? profile.blog : `https://${profile.blog}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 hover:text-purple-400 transition-colors truncate max-w-[200px]"
                                >
                                    <LinkIcon className="w-3 h-3" />
                                    {profile.blog.replace(/https?:\/\//, '').slice(0, 30)}
                                </a>
                            )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                            <Link
                                href={`/chat?q=${username}`}
                                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors text-center"
                            >
                                View Profile
                            </Link>
                            <a
                                href={`https://github.com/${username}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Github className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
