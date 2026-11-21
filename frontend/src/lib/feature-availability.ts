export interface FeatureAvailability {
  loyalty: boolean;
  whatsapp: boolean;
  onlineOrders: boolean;
}

export function parseFeatureAvailability(value: unknown): FeatureAvailability {
  const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    loyalty: payload.loyalty === true,
    whatsapp: payload.whatsapp === true,
    onlineOrders: payload.onlineOrders === true,
  };
}
