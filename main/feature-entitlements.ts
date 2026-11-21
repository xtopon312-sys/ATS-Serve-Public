import { NextFunction, Request, Response } from 'express';
import { getSettingValue } from './db';

export type FeatureEntitlement = 'loyalty' | 'whatsapp' | 'onlineOrders';

const KEYS: Record<FeatureEntitlement, string> = {
  loyalty: 'feature_loyalty_entitled',
  whatsapp: 'feature_whatsapp_entitled',
  onlineOrders: 'feature_online_orders_entitled',
};

export function isFeatureAvailable(feature: FeatureEntitlement): boolean {
  try {
    return getSettingValue(KEYS[feature]) === '1';
  } catch {
    return false;
  }
}

export function getFeatureAvailability(): Record<FeatureEntitlement, boolean> {
  return {
    loyalty: isFeatureAvailable('loyalty'),
    whatsapp: isFeatureAvailable('whatsapp'),
    onlineOrders: isFeatureAvailable('onlineOrders'),
  };
}

export function requireFeature(feature: FeatureEntitlement) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!isFeatureAvailable(feature)) {
      res.status(403).json({ error: 'Feature unavailable', feature });
      return;
    }
    next();
  };
}
