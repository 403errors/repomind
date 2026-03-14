"use server";

import { upsertPost, deletePost as deletePostFromDb } from "@/lib/services/blog-service";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BlogPost } from "@prisma/client";

async function checkAdmin() {
  const session = await auth();
  if (!isAdminUser(session)) {
    throw new Error("Unauthorized");
  }
}

export async function savePostAction(data: Partial<BlogPost>) {
  await checkAdmin();
  
  const result = await upsertPost(data);
  
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  if (result.slug) {
    revalidatePath(`/blog/${result.slug}`);
  }
  
  return result;
}

export async function deletePostAction(id: string) {
  await checkAdmin();
  
  await deletePostFromDb(id);
  
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  
  redirect("/admin/blog");
}
