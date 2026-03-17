import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { getCuratedRepos, getIndexableTopics, getCatalogStats } from "@/lib/repo-catalog";
import IndexManagementClient from "./IndexManagementClient";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function AdminIndexManagementPage() {
  const session = await auth();

  if (!isAdminUser(session)) {
    redirect("/");
  }

  const [repos, topics, stats] = await Promise.all([
    getCuratedRepos(),
    getIndexableTopics(),
    getCatalogStats(),
  ]);

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col gap-4">
        <Link 
          href="/admin" 
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors group w-fit"
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </Link>
        <div>
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
            Index Management
          </h1>
          <p className="text-zinc-400">
            Audit and manage the curated repository catalog and indexable topics.
          </p>
        </div>
      </div>

      <IndexManagementClient 
        repos={repos} 
        topics={topics} 
        stats={stats} 
      />
    </div>
  );
}
