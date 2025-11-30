export default function JsonLd() {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "WebSite",
                    name: "RepoMind",
                    url: "https://repomind-ai.vercel.app",
                }),
            }}
        />
    );
}
