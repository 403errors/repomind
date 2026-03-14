import { Suspense } from 'react';
import { Metadata } from 'next';
import HomeClient from './HomeClient';
import { getPublishedPosts } from '@/lib/services/blog-service';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  const posts = await getPublishedPosts();
  const latestPosts = posts.slice(0, 3);

  return (
    <Suspense fallback={null}>
      <HomeClient initialPosts={latestPosts} />
    </Suspense>
  );
}
