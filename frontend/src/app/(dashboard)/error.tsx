'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { reportRendererError } from '@/lib/report-renderer-error';
import { useErrorBoundaryCopy } from '@/hooks/useErrorBoundaryCopy';

const AUTO_RETRY_DELAY_MS = 2000;

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { copy } = useErrorBoundaryCopy();
  const reportedDigest = useRef<string | undefined>(undefined);
  const hasAutoRetried = useRef(false);
  const [autoRetrying, setAutoRetrying] = useState(false);
  const [reportStatus, setReportStatus] = useState<'pending' | 'sent' | 'failed'>('pending');

  useEffect(() => {
    // Deduplicate error reporting across resets using error digest.
    const digest = error.digest ?? error.message;
    if (reportedDigest.current !== digest) {
      reportedDigest.current = digest;
      setReportStatus('pending');
      void reportRendererError(error).then((sent) => {
        // Avoid overwriting status if a newer error occurred while in flight.
        if (reportedDigest.current === digest) setReportStatus(sent ? 'sent' : 'failed');
      });
    }

    // Perform a single automatic retry on transient render exceptions before showing manual actions.
    if (!hasAutoRetried.current) {
      hasAutoRetried.current = true;
      setAutoRetrying(true);
      const timer = setTimeout(() => {
        setAutoRetrying(false);
        reset();
      }, AUTO_RETRY_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [error, reset]);

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-4">
      <Card className="max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            <CardTitle>{copy.pageTitle}</CardTitle>
          </div>
          <CardDescription>
            {autoRetrying
              ? copy.recovering
              : copy.pageDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!autoRetrying && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => reset()}>{copy.tryAgain}</Button>
                <Button variant="outline" onClick={() => window.location.reload()}>{copy.reload}</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {reportStatus === 'pending' && copy.checkingDiagnostic}
                {reportStatus === 'sent' && copy.diagnosticSent}
                {reportStatus === 'failed' && copy.diagnosticUnavailable}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
