"use client";

import { 
    File, FileCode2, FileJson, FileText, FilePenLine, FileType2, FileImage, 
    Settings, FileKey, FileBox, Database, Terminal, Lock,
    Folder, FolderOpen, FolderCode, FolderGit2, FolderCheck, FolderCog, FolderArchive, FolderKanban,
    Globe, Layers, FileVideo, FileAudio
} from 'lucide-react';
import { cn } from "@/lib/utils";

interface FileIconProps {
    filename: string;
    className?: string;
}

export function FileIcon({ filename, className }: FileIconProps) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const name = filename.toLowerCase();

    // Specific filenames
    if (name === 'package.json' || name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml' || name.endsWith('.lock')) 
        return <Lock className={cn("w-4 h-4 text-rose-400 shrink-0 transition-colors", className)} />;
    
    if (name.includes('config') || name.startsWith('.') || name.includes('prettier') || name.includes('eslint') || name.includes('tsconfig'))
        return <Settings className={cn("w-4 h-4 text-zinc-400 shrink-0 transition-colors", className)} />;
    
    if (name === 'dockerfile' || name.includes('docker-compose'))
        return <FileBox className={cn("w-4 h-4 text-blue-500 shrink-0 transition-colors", className)} />;
    
    if (name.startsWith('.env'))
        return <FileKey className={cn("w-4 h-4 text-amber-500 shrink-0 transition-colors", className)} />;

    if (name === 'favicon.ico')
        return <Globe className={cn("w-4 h-4 text-blue-400 shrink-0 transition-colors", className)} />;

    // Extensions
    switch (ext) {
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return <FileCode2 className={cn("w-4 h-4 text-amber-400 shrink-0 transition-colors", className)} />;
        case 'ts':
        case 'tsx':
            return <FileCode2 className={cn("w-4 h-4 text-blue-400 shrink-0 transition-colors", className)} />;
        case 'json':
            return <FileJson className={cn("w-4 h-4 text-green-400 shrink-0 transition-colors", className)} />;
        case 'md':
        case 'txt':
        case 'log':
            return <FileText className={cn("w-4 h-4 text-zinc-400 shrink-0 transition-colors", className)} />;
        case 'css':
        case 'scss':
        case 'less':
            return <FilePenLine className={cn("w-4 h-4 text-pink-400 shrink-0 transition-colors", className)} />;
        case 'html':
            return <FileType2 className={cn("w-4 h-4 text-orange-400 shrink-0 transition-colors", className)} />;
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'svg':
        case 'webp':
        case 'ico':
        case 'tiff':
        case 'avif':
            return <FileImage className={cn("w-4 h-4 text-purple-400 shrink-0 transition-colors", className)} />;
        case 'mp4':
        case 'mov':
        case 'avi':
        case 'webm':
        case 'mkv':
        case 'ogv':
            return <FileVideo className={cn("w-4 h-4 text-rose-400 shrink-0 transition-colors", className)} />;
        case 'mp3':
        case 'wav':
        case 'ogg':
        case 'm4a':
        case 'aac':
        case 'flac':
            return <FileAudio className={cn("w-4 h-4 text-blue-500 shrink-0 transition-colors", className)} />;
        case 'pdf':
            return <FileText className={cn("w-4 h-4 text-red-500 shrink-0 transition-colors", className)} />;
        case 'yml':
        case 'yaml':
            return <Settings className={cn("w-4 h-4 text-rose-400 shrink-0 transition-colors", className)} />;
        case 'sql':
        case 'prisma':
            return <Database className={cn("w-4 h-4 text-cyan-400 shrink-0 transition-colors", className)} />;
        case 'py':
            return <FileCode2 className={cn("w-4 h-4 text-indigo-400 shrink-0 transition-colors", className)} />;
        case 'go':
            return <FileCode2 className={cn("w-4 h-4 text-cyan-500 shrink-0 transition-colors", className)} />;
        case 'rs':
            return <FileCode2 className={cn("w-4 h-4 text-orange-700 shrink-0 transition-colors", className)} />;
        case 'sh':
        case 'bash':
        case 'zsh':
            return <Terminal className={cn("w-4 h-4 text-emerald-400 shrink-0 transition-colors", className)} />;
        default:
            return <File className={cn("w-4 h-4 text-zinc-500 shrink-0 transition-colors", className)} />;
    }
}

interface FolderIconProps {
    name: string;
    isExpanded: boolean;
    className?: string;
}

export function FolderIcon({ name, isExpanded, className }: FolderIconProps) {
    const iconClass = cn("w-4 h-4 shrink-0 transition-colors", className);
    const folderName = name.toLowerCase();

    const getIcon = () => {
        if (folderName === 'src') return <FolderCode className={cn(iconClass, "text-blue-400")} />;
        if (folderName === '.github') return <FolderGit2 className={cn(iconClass, "text-orange-500")} />;
        if (folderName === 'public' || folderName === 'assets' || folderName === 'images' || folderName === 'static') 
            return <FolderOpen className={cn(iconClass, "text-purple-400")} />;
        if (folderName === 'components' || folderName === 'ui' || folderName === 'blocks') 
            return <FolderOpen className={cn(iconClass, "text-indigo-400")} />;
        if (folderName === 'app' || folderName === 'pages' || folderName === 'routes' || folderName === 'views') 
            return <Layers className={cn(iconClass, "text-emerald-400")} />;
        if (folderName === 'test' || folderName === '__tests__' || folderName === 'spec' || folderName === 'tests')
            return <FolderCheck className={cn(iconClass, "text-green-500")} />;
        if (folderName === 'lib' || folderName === 'utils' || folderName === 'helpers' || folderName === 'services' || folderName === 'config' || folderName === 'settings' || folderName === 'api' || folderName === 'actions' || folderName === 'hooks') 
            return <FolderCog className={cn(iconClass, "text-amber-400")} />;
        if (folderName === 'docs' || folderName === 'documentation' || folderName === 'archive') 
            return <FolderArchive className={cn(iconClass, "text-zinc-400")} />;
        if (folderName === 'node_modules') 
            return <FolderKanban className={cn(iconClass, "text-rose-400")} />;
        
        return isExpanded ? <FolderOpen className={cn(iconClass, "text-blue-400")} /> : <Folder className={cn(iconClass, "text-blue-400")} />;
    };

    return getIcon();
}
