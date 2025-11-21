"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { User, ExternalLink, MapPin, Link as LinkIcon, Github } from "lucide-react";

interface DeveloperCardProps {
    username: string;
    name?: string;
    avatar?: string;
    bio?: string;
    location?: string;
    blog?: string;
}

export function DeveloperCard({ username, name, avatar, bio, location, blog }: DeveloperCardProps) {
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
                    <img
                        src={avatar || `https://github.com/${username}.png`}
                        alt={username}
                        className="w-16 h-16 rounded-xl border-2 border-white/20 bg-zinc-800"
                        onError={(e) => {
                            // Fallback to icon if image fails to load
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                    />
                    <div className="hidden w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                        <User className="w-8 h-8 text-white" />
                    </div>

                    <div className="flex-1">
                        {/* Name & Username */}
                        <h3 className="text-lg font-semibold text-white mb-1">
                            {name || username}
                        </h3>
                        <p className="text-sm text-zinc-400 mb-2">@{username}</p>

                        {/* Bio */}
                        {bio && (
                            <p className="text-zinc-400 text-sm mb-3 line-clamp-2">{bio}</p>
                        )}

                        {/* Additional info */}
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500 mb-4">
                            {location && (
                                <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {location}
                                </span>
                            )}
                            {blog && (
                                <a
                                    href={blog}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 hover:text-purple-400 transition-colors"
                                >
                                    <LinkIcon className="w-3 h-3" />
                                    {blog.replace(/https?:\/\//, '').slice(0, 30)}
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
