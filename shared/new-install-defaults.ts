export const NEW_INSTALL_COUNTRY = 'BR';
export const NEW_INSTALL_LANGUAGE = 'pt';
export const NEW_INSTALL_CURRENCY = 'BRL';
export const NEW_INSTALL_TIMEZONE = 'America/Sao_Paulo';

// IANA zones within Brazil; matching a UTC offset alone cannot identify a country.
const BRAZIL_TIMEZONES = new Set([
  'America/Araguaina', 'America/Bahia', 'America/Belem', 'America/Boa_Vista',
  'America/Campo_Grande', 'America/Cuiaba', 'America/Eirunepe', 'America/Fortaleza',
  'America/Maceio', 'America/Manaus', 'America/Noronha', 'America/Porto_Velho',
  'America/Recife', 'America/Rio_Branco', 'America/Santarem', 'America/Sao_Paulo',
]);

export function resolveBrazilianTimeZone(detectedTimeZone?: string): string {
  try {
    const detected = detectedTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const canonical = new Intl.DateTimeFormat('en', { timeZone: detected }).resolvedOptions().timeZone;
    return BRAZIL_TIMEZONES.has(canonical) ? canonical : NEW_INSTALL_TIMEZONE;
  } catch {
    return NEW_INSTALL_TIMEZONE;
  }
}
