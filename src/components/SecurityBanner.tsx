import { ShieldCheck, Lock } from "lucide-react";

export default function SecurityBanner() {
    return (
        <section className="w-full py-16 relative z-10">
            <div className="max-w-4xl mx-auto px-4">
                <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 border border-zinc-800 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full blur-[80px]" />

                    <div className="flex gap-6 items-center flex-1 relative z-10">
                        <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-8 h-8 text-green-500" />
                        </div>
                        <div>
                            <h3 className="text-xl md:text-2xl font-bold text-white mb-2">Zero Data Retention. Period.</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed max-w-lg">
                                Your codebase is your intellectual property. Our models do not train on your private code. Everything is ephemeral and secured with enterprise-grade encryption.
                            </p>
                        </div>
                    </div>

                    <div className="shrink-0 bg-black/40 border border-zinc-800 rounded-xl px-5 py-3 flex items-center justify-center gap-2 relative z-10 m-auto md:m-0 w-full md:w-auto">
                        <Lock className="w-4 h-4 text-zinc-500" />
                        <span className="text-sm font-semibold text-zinc-300">SOC2 Ready</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
