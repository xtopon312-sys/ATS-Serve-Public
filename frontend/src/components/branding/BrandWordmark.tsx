'use client';

import Image from 'next/image';
import { useState } from 'react';

export default function BrandWordmark() {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="text-2xl font-semibold text-center">ATS Serve</p>;
  return (
    <Image
      src="/branding/ats-serve/wordmark.png"
      alt="ATS Serve"
      width={1024}
      height={326}
      unoptimized
      className="h-auto w-64 max-w-full mx-auto"
      onError={() => setFailed(true)}
    />
  );
}
