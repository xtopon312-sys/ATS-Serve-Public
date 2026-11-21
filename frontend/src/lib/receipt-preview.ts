const PORTUGUESE_PREVIEWS: Record<'classic' | 'compact', string> = {
  classic: `RESTAURANTE EXEMPLO
COMPROVANTE NÃO FISCAL
---------------------
Conta: 1   16/10 12:30
---------------------
Prato do dia    29,90
  + Adicional    3,00
---------------------
TOTAL R$        32,90
PIX             32,90
---------------------
Modelo ilustrativo`,
  compact: `RESTAURANTE EXEMPLO
COMPROVANTE NÃO FISCAL
---------------------
Conta: 1   16/10 12:30
Prato do dia    29,90
---------------------
TOTAL R$        29,90
Dinheiro        29,90
---------------------
Modelo ilustrativo`,
};

export function localizeCoreReceiptPreview(templateId: string, locale: string, fallback: string): string {
  if (locale.startsWith('pt') && (templateId === 'classic' || templateId === 'compact')) {
    return PORTUGUESE_PREVIEWS[templateId];
  }
  return fallback;
}
