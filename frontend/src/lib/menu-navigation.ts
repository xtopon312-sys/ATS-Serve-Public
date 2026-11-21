export function menuNavigationTarget(action: string): string | null {
  switch (action) {
    case 'new-order':
    case 'quick-search': return '/pos';
    case 'view-orders': return '/orders';
    case 'report-daily':
    case 'report-sales':
    case 'report-x':
    case 'report-z': return '/dashboard';
    case 'settings-business': return '/settings?tab=store';
    case 'settings-tax': return '/settings?tab=tax';
    case 'settings-printer': return '/settings?tab=receipts-printers';
    case 'settings-kitchen': return '/settings?tab=kds';
    default: return null;
  }
}
