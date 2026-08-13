'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const publicPaths = ['/login', '/register'];
    const isPublic = publicPaths.some(p => pathname.startsWith(p));

    if (!isAuthenticated && !isPublic) {
      const intended = pathname;
      console.log('RouteGuard → توجيه للـ login م intended:', intended);
      router.replace(`/login?intended=${encodeURIComponent(intended)}`);
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) return null;
  if (!isAuthenticated && !['/login', '/register'].some(p => pathname.startsWith(p))) {
    return null;
  }

  return <>{children}</>;
}