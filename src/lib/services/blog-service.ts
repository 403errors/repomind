import { prisma } from "@/lib/db";
import { BlogPost, Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";

/**
 * Service to manage blog posts in the database.
 */

export const BLOG_HOMEPAGE_CACHE_TAG = "blog:homepage";

const getCachedHomepagePosts = unstable_cache(
  async () => {
    return prisma.blogPost.findMany({
      where: { published: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 3,
    });
  },
  ["blog-homepage-posts"],
  { tags: [BLOG_HOMEPAGE_CACHE_TAG] },
);

export type SavePostInput = Partial<BlogPost> & { id?: string; slug?: string };

function revalidateBlogRoutes(slugs: Iterable<string>) {
  revalidateTag(BLOG_HOMEPAGE_CACHE_TAG);
  revalidatePath("/");
  revalidatePath("/blog");
  revalidatePath("/sitemap.xml");

  for (const slug of slugs) {
    if (!slug) continue;
    revalidatePath(`/blog/${slug}`);
  }
}

function ensureSlugValue(data: SavePostInput): string | null {
  if (typeof data.slug !== "string") return null;
  const value = data.slug.trim();
  if (!value) {
    throw new Error("Slug cannot be empty.");
  }
  return value;
}

function toCreatePayload(data: SavePostInput, slug: string): Prisma.BlogPostCreateInput {
  const published = data.published ?? false;
  return {
    slug,
    title: data.title || "",
    excerpt: data.excerpt || "",
    content: data.content || "",
    author: data.author || "RepoMind Engineering",
    category: data.category || "Engineering",
    image: data.image || "/assets/landing_page.png",
    keywords: data.keywords ?? null,
    date:
      data.date ||
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    published,
    publishedAt: published ? new Date() : null,
  };
}

export async function getPublishedPosts() {
  return await prisma.blogPost.findMany({
    where: { published: true },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function getHomepagePosts() {
  return getCachedHomepagePosts();
}

export async function getAllPosts() {
  return await prisma.blogPost.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function getPostBySlug(slug: string) {
  return await prisma.blogPost.findUnique({
    where: { slug },
  });
}

export async function getPublishedPostBySlug(slug: string) {
  return await prisma.blogPost.findFirst({
    where: { slug, published: true },
  });
}

export async function savePost(data: SavePostInput) {
  const providedSlug = ensureSlugValue(data);

  try {
    if (data.id) {
      const existing = await prisma.blogPost.findUnique({
        where: { id: data.id },
      });

      if (!existing) {
        throw new Error("Post not found.");
      }

      const nextSlug = providedSlug ?? existing.slug;
      if (existing.publishedAt && nextSlug !== existing.slug) {
        throw new Error("Slug cannot be changed after a post is published.");
      }

      const updateData: Prisma.BlogPostUpdateInput = {};
      if (providedSlug && providedSlug !== existing.slug) updateData.slug = providedSlug;
      if (typeof data.title === "string") updateData.title = data.title;
      if (typeof data.excerpt === "string") updateData.excerpt = data.excerpt;
      if (typeof data.content === "string") updateData.content = data.content;
      if (typeof data.date === "string") updateData.date = data.date;
      if (typeof data.author === "string") updateData.author = data.author;
      if (typeof data.category === "string") updateData.category = data.category;
      if (typeof data.image === "string") updateData.image = data.image;
      if (typeof data.published === "boolean") updateData.published = data.published;
      if (typeof data.keywords === "string" || data.keywords === null) updateData.keywords = data.keywords ?? null;

      const nextPublished = data.published ?? existing.published;
      if (!existing.publishedAt && nextPublished) {
        updateData.publishedAt = new Date();
      }

      const result = await prisma.blogPost.update({
        where: { id: data.id },
        data: updateData,
      });

      revalidateBlogRoutes(new Set([existing.slug, result.slug]));
      return result;
    }

    if (!providedSlug) {
      throw new Error("Slug is required.");
    }

    const result = await prisma.blogPost.create({
      data: toCreatePayload(data, providedSlug),
    });

    revalidateBlogRoutes([result.slug]);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("A post with this slug already exists.");
    }
    throw error;
  }
}

export async function deletePost(id: string) {
  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: { slug: true },
  });

  const result = await prisma.blogPost.delete({
    where: { id },
  });

  revalidateBlogRoutes([post?.slug ?? "", result.slug]);

  return result;
}
