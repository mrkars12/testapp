// app/(public)/login/page.tsx
import { Suspense } from 'react';
import LoginClient from './LoginClient';

export default async function LoginPage(props: {
  searchParams: Promise<{ intended?: string }>;
}) {
  const searchParams = await props.searchParams;
  const intendedParam = searchParams.intended;

  const finalIntended = (intendedParam && 
                        typeof intendedParam === 'string' && 
                        intendedParam.startsWith('/') && 
                        !intendedParam.startsWith('//')) 
    ? intendedParam 
    : undefined;

  console.log('✅ Server intended:', finalIntended);

  return <LoginClient intended={finalIntended} />;
}