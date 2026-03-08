"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "danger" | "primary";
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    confirmVariant = "danger",
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (typeof window === "undefined") return null;

    const confirmButtonStyles =
        confirmVariant === "danger"
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-purple-600 hover:bg-purple-500 text-white";

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        onClick={onCancel}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", duration: 0.3 }}
                        className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between p-6 pb-4">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                                    <AlertTriangle className="w-6 h-6 text-red-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">{title}</h2>
                                    <p className="text-zinc-400 text-sm mt-2 leading-relaxed">
                                        {message}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onCancel}
                                className="text-zinc-400 hover:text-white p-1 hover:bg-white/5 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 p-6 pt-4 bg-zinc-950/50 border-t border-white/5">
                            <button
                                onClick={onCancel}
                                className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-medium transition-colors"
                            >
                                {cancelText}
                            </button>
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onCancel();
                                }}
                                className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors ${confirmButtonStyles}`}
                            >
                                {confirmText}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
}
