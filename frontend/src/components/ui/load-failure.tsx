'use client';

import { useTranslations } from 'use-intl';
import { Button } from './button';

export function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('errorBoundary');
  return (
    <div role="alert" className="my-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry}>{t('tryAgain')}</Button>
    </div>
  );
}
