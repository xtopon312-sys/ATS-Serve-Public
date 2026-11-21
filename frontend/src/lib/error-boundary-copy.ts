import en from './i18n/messages/en.json';
import { getLanguageFromLocale, isLanguage, type Language } from './i18n/languages';
import { getCachedMessages } from './i18n/loader';

export type ErrorBoundaryCopy = typeof en.errorBoundary;

// Recovery must work even when the Portuguese translation chunk fails to load.
const PORTUGUESE_RECOVERY_COPY: ErrorBoundaryCopy = {
  rootTitle: 'O ATS Serve precisa reiniciar',
  pageTitle: 'Não foi possível carregar esta tela',
  rootDescription: 'Um erro impediu o carregamento do ATS Serve. Recarregue o aplicativo. Antes de repetir um pagamento, confira o histórico de pedidos.',
  pageDescription: 'Recarregue esta página para continuar. Antes de repetir uma operação, confira o resultado no histórico de pedidos.',
  recovering: 'Tentando recuperar esta tela automaticamente…',
  checkingDiagnostic: 'Verificando a disponibilidade do diagnóstico…',
  diagnosticSent: 'Um relatório de diagnóstico foi enviado.',
  diagnosticUnavailable: 'Nenhum diagnóstico foi enviado. O serviço remoto pode estar indisponível ou desativado.',
  tryAgain: 'Tentar novamente',
  reload: 'Recarregar ATS Serve',
};

export function resolveErrorLanguage(storage: { getItem(key: string): string | null } | undefined, documentLanguage?: string): Language {
  try {
    const saved = JSON.parse(storage?.getItem('pos-settings') || 'null')?.state?.language;
    if (isLanguage(saved)) return saved;
  } catch {
    // Recovery must remain usable when persisted settings cannot be read.
  }
  if (documentLanguage) {
    const language = getLanguageFromLocale(documentLanguage);
    if (language) return language;
  }
  return 'pt';
}

export function getErrorBoundaryCopy(language: Language): ErrorBoundaryCopy {
  const fallback = language === 'pt' ? PORTUGUESE_RECOVERY_COPY : en.errorBoundary;
  return (getCachedMessages(language)?.errorBoundary as ErrorBoundaryCopy | undefined) ?? fallback;
}
