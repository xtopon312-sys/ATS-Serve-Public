'use client';

import { useEffect, useRef, useState } from 'react';
import { reportRendererError } from '@/lib/report-renderer-error';
import { useErrorBoundaryCopy } from '@/hooks/useErrorBoundaryCopy';

/** Root error boundary catching layout-level exceptions;
 * renders dedicated html/body wrapper. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { copy, locale, direction } = useErrorBoundaryCopy();
  const reportedDigest = useRef<string | undefined>(undefined);
  const [reportStatus, setReportStatus] = useState<'pending' | 'sent' | 'failed'>('pending');

  useEffect(() => {
    const digest = error.digest ?? error.message;
    if (reportedDigest.current !== digest) {
      reportedDigest.current = digest;
      setReportStatus('pending');
      void reportRendererError(error).then((sent) => {
        // Avoid overwriting status if a newer error occurred while in flight.
        if (reportedDigest.current === digest) setReportStatus(sent ? 'sent' : 'failed');
      });
    }
  }, [error]);

  return (
    <html lang={locale} dir={direction}>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8f8f8', color: '#1a1a1a' }}>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{copy.rootTitle}</h1>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>
              {copy.rootDescription}{' '}
              {reportStatus === 'pending' && copy.checkingDiagnostic}
              {reportStatus === 'sent' && copy.diagnosticSent}
              {reportStatus === 'failed' && copy.diagnosticUnavailable}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={() => reset()}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#3248FF', color: '#fff', cursor: 'pointer' }}
              >
                {copy.tryAgain}
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}
              >
                {copy.reload}
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
