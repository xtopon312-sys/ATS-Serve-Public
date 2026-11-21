/** Copy-diagnostic-and-hand-off-to-AI helper for the printer support-error panel. */

export interface AiProvider {
  id: 'chatgpt' | 'gemini' | 'claude';
  label: string;
  url: string;
}

export const AI_HELP_PROVIDERS: readonly AiProvider[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/new' },
];

async function resolveAppContext(): Promise<string> {
  try {
    const info = await window.electronAPI?.getAppInfo?.();
    if (info && 'version' in info) return `ATS Serve ${info.version} on ${info.platform}`;
  } catch { /* best-effort only */ }
  return 'ATS Serve (desktop app)';
}

/** Builds the prompt copied to the clipboard for AI hand-off on a printer failure. */
export async function buildPrinterDiagnosticPrompt(message: string, technicalDetail?: string): Promise<string> {
  const context = await resolveAppContext();
  const lines = [
    `I'm using ${context}, an open-source restaurant point-of-sale app, and a printer job just failed:`,
    '',
    `"${message}"`,
  ];
  if (technicalDetail && technicalDetail !== message) {
    lines.push('', `Technical detail: ${technicalDetail}`);
  }
  lines.push(
    '',
    'Please help me diagnose and fix this printer problem using the local configuration and diagnostic details.',
  );
  return lines.join('\n');
}

/** Copies the diagnostic prompt to the clipboard. Returns whether it succeeded. */
export async function copyPrinterDiagnostic(message: string, technicalDetail?: string): Promise<boolean> {
  try {
    const prompt = await buildPrinterDiagnosticPrompt(message, technicalDetail);
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch {
    return false;
  }
}
