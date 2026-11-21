'use client';

import { useEffect, useState } from 'react';
import { getErrorBoundaryCopy, resolveErrorLanguage } from '@/lib/error-boundary-copy';
import { getLanguageDirection, getLanguageLocale, type Language } from '@/lib/i18n/languages';
import { loadLocaleMessages } from '@/lib/i18n/loader';

export function useErrorBoundaryCopy() {
  const [language, setLanguage] = useState<Language>('pt');
  const [copy, setCopy] = useState(() => getErrorBoundaryCopy('pt'));

  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Storage can be unavailable during recovery. */ }
    const selected = resolveErrorLanguage(storage, document.documentElement.lang);
    let active = true;
    const publishCopy = () => {
      if (!active) return;
      setLanguage(selected);
      setCopy(getErrorBoundaryCopy(selected));
    };
    void loadLocaleMessages(selected).then(publishCopy, publishCopy);
    return () => { active = false; };
  }, []);

  return { copy, locale: getLanguageLocale(language), direction: getLanguageDirection(language) };
}
