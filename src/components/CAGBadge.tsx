"use client";



export function CAGBadge() {
    const scrollToCAG = () => {
        const element = document.getElementById('cag-comparison');
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <button
            onClick={scrollToCAG}
            className="mb-6 group hover:scale-105 transition-transform"
        >
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full backdrop-blur-md hover:bg-blue-500/20 hover:border-blue-500/40 transition-colors">
                <span className="text-sm font-medium text-blue-200 group-hover:text-white transition-colors">
                    Powered by <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Agentic CAG Architecture</span>
                </span>
            </div>
        </button>
    );
}
