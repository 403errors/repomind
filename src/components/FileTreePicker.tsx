import { useMemo, useState } from "react";
import { ChevronRight, Folder, FileText, CheckSquare, Square } from "lucide-react";

interface FileTreePickerProps {
    files: Array<{ path: string }>;
    selected: string[];
    onChange: (paths: string[]) => void;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'dir' | 'file';
    children?: TreeNode[];
    filePaths?: string[];
}

function buildTree(paths: string[]): TreeNode {
    const root: TreeNode = { name: '', path: '', type: 'dir', children: [], filePaths: [] };

    for (const fullPath of paths) {
        const parts = fullPath.split('/').filter(Boolean);
        let current = root;
        current.filePaths?.push(fullPath);

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            if (isLast) {
                current.children = current.children || [];
                current.children.push({
                    name: part,
                    path: fullPath,
                    type: 'file'
                });
                return;
            }

            current.children = current.children || [];
            let next = current.children.find(c => c.type === 'dir' && c.name === part);
            if (!next) {
                next = { name: part, path: current.path ? `${current.path}/${part}` : part, type: 'dir', children: [], filePaths: [] };
                current.children.push(next);
            }
            next.filePaths?.push(fullPath);
            current = next;
        });
    }

    return root;
}

function sortTree(node: TreeNode): TreeNode {
    if (!node.children) return node;
    const children = [...node.children];
    children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return {
        ...node,
        children: children.map(child => sortTree(child))
    };
}

function filterTree(node: TreeNode, query: string): TreeNode | null {
    if (!query.trim()) return node;
    const lower = query.toLowerCase();
    if (node.type === 'file') {
        return node.path.toLowerCase().includes(lower) ? node : null;
    }

    const children = (node.children || [])
        .map(child => filterTree(child, query))
        .filter(Boolean) as TreeNode[];

    if (children.length > 0 || node.path.toLowerCase().includes(lower)) {
        return { ...node, children };
    }

    return null;
}

function FileNode({
    node,
    level,
    selectedSet,
    expandedSet,
    toggleExpand,
    toggleFile,
    toggleDirectory
}: {
    node: TreeNode;
    level: number;
    selectedSet: Set<string>;
    expandedSet: Set<string>;
    toggleExpand: (path: string) => void;
    toggleFile: (path: string) => void;
    toggleDirectory: (paths: string[]) => void;
}) {
    const paddingLeft = 12 + level * 12;
    if (node.type === 'file') {
        const isChecked = selectedSet.has(node.path);
        return (
            <div className="flex items-center gap-2 py-1" style={{ paddingLeft }}>
                <button type="button" onClick={() => toggleFile(node.path)} className="text-zinc-400 hover:text-white">
                    {isChecked ? <CheckSquare className="w-4 h-4 text-purple-400" /> : <Square className="w-4 h-4" />}
                </button>
                <FileText className="w-4 h-4 text-zinc-500" />
                <span className="text-xs text-zinc-300 truncate">{node.name}</span>
            </div>
        );
    }

    const isExpanded = expandedSet.has(node.path);
    const dirPaths = node.filePaths || [];
    const allSelected = dirPaths.length > 0 && dirPaths.every(path => selectedSet.has(path));

    return (
        <div>
            <div className="flex items-center gap-2 py-1" style={{ paddingLeft }}>
                <button type="button" onClick={() => toggleExpand(node.path)} className="text-zinc-400 hover:text-white">
                    <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
                <button type="button" onClick={() => toggleDirectory(dirPaths)} className="text-zinc-400 hover:text-white">
                    {allSelected ? <CheckSquare className="w-4 h-4 text-purple-400" /> : <Square className="w-4 h-4" />}
                </button>
                <Folder className="w-4 h-4 text-zinc-500" />
                <span className="text-xs text-zinc-300">{node.name || 'root'}</span>
            </div>
            {isExpanded && (
                <div>
                    {(node.children || []).map(child => (
                        <FileNode
                            key={child.path}
                            node={child}
                            level={level + 1}
                            selectedSet={selectedSet}
                            expandedSet={expandedSet}
                            toggleExpand={toggleExpand}
                            toggleFile={toggleFile}
                            toggleDirectory={toggleDirectory}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FileTreePicker({ files, selected, onChange }: FileTreePickerProps) {
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    const allPaths = useMemo(() => files.map((f) => f.path), [files]);
    const tree = useMemo(() => sortTree(buildTree(allPaths)), [allPaths]);
    const filteredTree = useMemo(() => filterTree(tree, search) || tree, [tree, search]);

    const toggleExpand = (path: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const toggleFile = (path: string) => {
        const next = new Set(selectedSet);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        onChange(Array.from(next));
    };

    const toggleDirectory = (paths: string[]) => {
        const next = new Set(selectedSet);
        const allSelected = paths.every(path => next.has(path));
        if (allSelected) {
            paths.forEach(path => next.delete(path));
        } else {
            paths.forEach(path => next.add(path));
        }
        onChange(Array.from(next));
    };

    return (
        <div className="space-y-3">
            <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500/50 outline-none text-sm"
                placeholder="Filter files..."
            />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-zinc-950/50 p-2">
                {(filteredTree.children || []).map(child => (
                    <FileNode
                        key={child.path}
                        node={child}
                        level={0}
                        selectedSet={selectedSet}
                        expandedSet={expanded}
                        toggleExpand={toggleExpand}
                        toggleFile={toggleFile}
                        toggleDirectory={toggleDirectory}
                    />
                ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button
                    type="button"
                    onClick={() => onChange(allPaths)}
                    className="px-2 py-1 rounded bg-zinc-800 border border-white/10 hover:bg-zinc-700"
                >
                    Select All
                </button>
                <button
                    type="button"
                    onClick={() => onChange([])}
                    className="px-2 py-1 rounded bg-zinc-800 border border-white/10 hover:bg-zinc-700"
                >
                    Clear
                </button>
                <span>{selected.length} selected</span>
            </div>
        </div>
    );
}
