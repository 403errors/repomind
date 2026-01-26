# Changelog

All notable changes to this project will be documented in this file.

## [v1.3.5] - 2026-01-26
### Added
- **Security Report UX**: New DevTools Security tab with scan depth controls and AI toggle.
- **File Scope Picker**: Tree-based file selection to scope security scans precisely.
- **Per-Finding Patch Copy**: Generate and copy suggested patches for individual findings.
- **Snippet Context**: Findings now include surrounding code context for faster review.

### Improved
- **AI Quality Parsing**: More resilient JSON parsing to prevent malformed AI responses from crashing analysis.

## [v1.3.4] - 2026-01-25
### Added
- **Chat Export**: Export chats to Markdown with Mermaid rendering.
- **Copy Response**: One-click copy for AI responses with enhanced clipboard support and icon updates.
- **Chat UX**: Reference text handling, selection support, and refined chat input/profile chat interfaces.
- **File Preview**: Refactored base64 decoding logic for readability.

## [v1.3.3] - 2025-12-8
### Added
 - **Markdown Support**: User input contained between three backticks is now treated as markdown.
 - **PWA Support**: Full Progressive Web App support is now available.
 - **GitHub Link**: GitHub repository link is now implemented on the webpage.

## [v1.3.2] - 2025-11-30
### Added
- **Blazing Fast Optimization**: Instant profile loads & faster file selection with Flash-Lite.
- **Native Web Search**: Real-time answers for competitors, news, and jobs using Gemini's `googleSearch`.
- **Smart URL Handling**: Intelligent LinkedIn summarization & identity verification.

## [v1.3.1]
### Improved
- **Flowchart Accuracy**: Increased accuracy in complex flowchart generation from 70% to 95+%.
- **Error Handling**: Mermaid syntax errors are now hidden from the UI.
- **Context Awareness**: Added context for better chat results.

## [v1.3]
### Added
- **Code Blocks**: Horizontal scrolling code blocks in chat UI.
- **Enhanced Flowcharts**: Integrated enhanced flowchart diagrams.
- **Hidden Files**: Added hidden files section to optimize the repo tree.
- **DevTools**: Implemented the devtools suite.
- **Real-time Response**: Added realtime Next.js server response.
- **Caching**: Introduced Vercel KV caching for GitHub API calls.
- **Mermaid Fix Pipeline**: Robust diagram fix pipeline using JSON-to-Mermaid conversion.

## [v1.2]
### Added
- **Dev Tools Suite**: Advanced Search (Regex/AST), Code Quality Analysis, and Automated Generators.
- **Zero-Cost Security**: Vulnerability scanning using pattern matching and Gemini AI.
- **Enhanced Data**: Precise language statistics via GraphQL and commit history.
- **Auto-Persistence**: Conversations are now automatically saved locally and restored instantly.

## [v1.1]
### Added
- **Smart Caching**: Instant load times for previously visited profiles and repositories.
- **Mobile Experience**: Optimized layout for mobile devices.
- **Repo Chat**: Deep dive into repositories with AI-powered chat and file analysis.
- **File Preview**: Instant syntax-highlighted previews for any file in the repository.
