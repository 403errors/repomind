import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

export interface SearchResult {
    file: string;
    line: number;
    content: string;
    matchType: 'text' | 'regex' | 'ast';
    context?: string;
}

export interface SearchOptions {
    query: string;
    type: 'text' | 'regex' | 'ast';
    astType?: 'function' | 'class' | 'variable' | 'import';
    caseSensitive?: boolean;
}

/**
 * Perform advanced search across files
 */
export function searchFiles(
    files: Array<{ path: string; content: string }>,
    options: SearchOptions
): SearchResult[] {
    const results: SearchResult[] = [];

    for (const file of files) {
        try {
            if (options.type === 'ast') {
                if (/\.(js|jsx|ts|tsx)$/.test(file.path)) {
                    results.push(...searchAST(file, options));
                }
            } else if (options.type === 'regex') {
                results.push(...searchRegex(file, options));
            } else {
                results.push(...searchText(file, options));
            }
        } catch (e) {
            console.warn(`Search failed for ${file.path}:`, e);
        }
    }

    return results;
}

/**
 * AST-based structural search
 */
function searchAST(
    file: { path: string; content: string },
    options: SearchOptions
): SearchResult[] {
    const results: SearchResult[] = [];

    try {
        const ast = parse(file.content, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy']
        });

        const queryLower = options.query.toLowerCase();

        traverse(ast, {
            FunctionDeclaration(path) {
                if (options.astType === 'function' || !options.astType) {
                    if (path.node.id?.name.toLowerCase().includes(queryLower)) {
                        results.push({
                            file: file.path,
                            line: path.node.loc?.start.line || 0,
                            content: `function ${path.node.id.name}(...)`,
                            matchType: 'ast',
                            context: 'Function Declaration'
                        });
                    }
                }
            },
            ClassDeclaration(path) {
                if (options.astType === 'class' || !options.astType) {
                    if (path.node.id?.name.toLowerCase().includes(queryLower)) {
                        results.push({
                            file: file.path,
                            line: path.node.loc?.start.line || 0,
                            content: `class ${path.node.id.name}`,
                            matchType: 'ast',
                            context: 'Class Declaration'
                        });
                    }
                }
            },
            VariableDeclarator(path) {
                if (options.astType === 'variable' || !options.astType) {
                    if (
                        'name' in path.node.id &&
                        typeof path.node.id.name === "string" &&
                        path.node.id.name.toLowerCase().includes(queryLower)
                    ) {
                        results.push({
                            file: file.path,
                            line: path.node.loc?.start.line || 0,
                            content: `const/let/var ${path.node.id.name}`,
                            matchType: 'ast',
                            context: 'Variable Declaration'
                        });
                    }
                }
            },
            ImportDeclaration(path) {
                if (options.astType === 'import' || !options.astType) {
                    if (path.node.source.value.toLowerCase().includes(queryLower)) {
                        results.push({
                            file: file.path,
                            line: path.node.loc?.start.line || 0,
                            content: `import ... from '${path.node.source.value}'`,
                            matchType: 'ast',
                            context: 'Import'
                        });
                    }
                }
            }
        });
    } catch {
        // Parser error, skip file
    }

    return results;
}

/**
 * Regex search
 */
function searchRegex(
    file: { path: string; content: string },
    options: SearchOptions
): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = file.content.split('\n');

    try {
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(options.query, flags);

        lines.forEach((line, index) => {
            if (regex.test(line)) {
                results.push({
                    file: file.path,
                    line: index + 1,
                    content: line.trim(),
                    matchType: 'regex'
                });
            }
        });
    } catch {
        // Invalid regex
    }

    return results;
}

/**
 * Simple text search
 */
function searchText(
    file: { path: string; content: string },
    options: SearchOptions
): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = file.content.split('\n');
    const query = options.caseSensitive ? options.query : options.query.toLowerCase();

    lines.forEach((line, index) => {
        const lineContent = options.caseSensitive ? line : line.toLowerCase();
        if (lineContent.includes(query)) {
            results.push({
                file: file.path,
                line: index + 1,
                content: line.trim(),
                matchType: 'text'
            });
        }
    });

    return results;
}
