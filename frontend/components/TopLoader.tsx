'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import NProgress from 'nprogress';
import '@/app/nprogress.css';

export default function TopLoader() {
  const pathname = usePathname();

  useEffect(() => {
    NProgress.start();

    return () => {
      NProgress.done();
    };
  }, [pathname]);

  return null;
}
