"use client";

import { useState, useEffect } from "react";
import { BlogPost } from "@prisma/client";
import { EnhancedMarkdown } from "@/components/EnhancedMarkdown";
import { Save, Send, Eye, Edit3, ArrowLeft, Image as ImageIcon, Globe, Lock } from "lucide-react";
import Link from "next/link";
import { savePostAction } from "@/app/admin/blog/actions";
import { useRouter } from "next/navigation";

interface BlogEditorProps {
  initialPost?: Partial<BlogPost>;
}

export default function BlogEditor({ initialPost }: BlogEditorProps) {
  const router = useRouter();
  const [post, setPost] = useState<Partial<BlogPost>>({
    title: "",
    slug: "",
    excerpt: "",
    content: "",
    category: "Engineering",
    image: "/preview_example.png",
    author: "RepoMind Engineering",
    published: false,
    ...initialPost
  });

  const [isPreview, setIsPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setPost((prev: Partial<BlogPost>) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (published: boolean) => {
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      const dataToSave = { ...post, published };
      const result = await savePostAction(dataToSave);
      setPost(result);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
      router.refresh();
      if (!post.id) {
          router.push(`/admin/blog/${result.id}`);
      }
    } catch (error) {
      console.error("Failed to save post:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <Link 
            href="/admin/blog"
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold">
            {post.id ? "Edit Post" : "Create New Post"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPreview(!isPreview)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 transition-all text-sm font-medium"
          >
            {isPreview ? <Edit3 size={16} /> : <Eye size={16} />}
            {isPreview ? "Edit Content" : "Preview"}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 transition-all text-sm font-medium disabled:opacity-50"
          >
            <Save size={16} />
            Save Draft
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition-all text-sm font-bold disabled:opacity-50"
          >
            <Send size={16} />
            Publish
          </button>
        </div>
      </div>

      {saveStatus === "success" && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
            <Globe size={14} /> Post saved successfully!
        </div>
      )}

      {saveStatus === "error" && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm">
            Failed to save post. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className={`lg:col-span-2 space-y-6 ${isPreview ? "hidden lg:block" : ""}`}>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Content (Markdown)</label>
            <textarea
              name="content"
              value={post.content}
              onChange={handleChange}
              placeholder="Write your brilliant content here..."
              className="w-full h-[600px] bg-zinc-900/50 border border-white/5 rounded-2xl p-6 text-zinc-300 outline-none focus:border-purple-500/30 transition-all font-mono text-sm leading-relaxed resize-none"
            />
          </div>
        </div>

        {isPreview && (
          <div className="lg:col-span-2 bg-zinc-900/30 border border-white/5 rounded-2xl p-8 overflow-y-auto max-h-[700px]">
            <div className="max-w-none prose prose-invert">
                <EnhancedMarkdown content={post.content || ""} />
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Title</label>
              <input
                type="text"
                name="title"
                value={post.title}
                onChange={handleChange}
                placeholder="Post title"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-purple-500/50 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Slug</label>
              <input
                type="text"
                name="slug"
                value={post.slug}
                onChange={handleChange}
                placeholder="post-slug-url"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-purple-500/50 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Category</label>
              <select
                name="category"
                value={post.category}
                onChange={handleChange}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-purple-500/50 transition-colors appearance-none"
              >
                <option value="Engineering">Engineering</option>
                <option value="Security">Security</option>
                <option value="Product">Product</option>
                <option value="Announcement">Announcement</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Excerpt</label>
              <textarea
                name="excerpt"
                value={post.excerpt}
                onChange={handleChange}
                placeholder="Short summary for SEO and index page"
                className="w-full h-24 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-purple-500/50 transition-colors resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1 flex items-center gap-2">
                <ImageIcon size={12} /> Image URL
              </label>
              <input
                type="text"
                name="image"
                value={post.image}
                onChange={handleChange}
                placeholder="/path/to/image.png"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-purple-500/50 transition-colors"
              />
              <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 mt-2">
                  <img 
                    src={post.image || "/preview_example.png"} 
                    alt="Preview" 
                    className="object-cover w-full h-full"
                    onError={(e) => (e.currentTarget.src = "/preview_example.png")}
                  />
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Status</span>
                <span className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest ${post.published ? "text-green-400" : "text-yellow-400"}`}>
                    {post.published ? <Globe size={14} /> : <Lock size={14} />}
                    {post.published ? "Published" : "Draft"}
                </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
