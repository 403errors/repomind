export function CopySquaresIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <rect x="5" y="5" width="10" height="10" rx="2" />
            <rect x="9" y="9" width="10" height="10" rx="2" />
        </svg>
    );
}
