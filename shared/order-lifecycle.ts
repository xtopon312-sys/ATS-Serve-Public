export const ORDER_STATUSES = [
  'pending',
  'preparing',
  'ready',
  'served',
  'completed',
  'cancelled',
] as const;

export const ACTIVE_TABLE_ORDER_STATUSES = [
  'pending',
  'preparing',
  'ready',
  'served',
] as const;

export const CLOSED_ORDER_STATUSES = ['completed', 'cancelled'] as const;

export const ACTIVE_TABLE_ORDER_PREDICATE_SQL =
  "type = 'dine_in' AND table_id IS NOT NULL AND status IN ('pending', 'preparing', 'ready', 'served')";

export const ACTIVE_TABLE_ORDER_INDEX = 'orders_one_active_dine_in_per_table';
export const TABLE_ALREADY_HAS_ACTIVE_ORDER = 'TABLE_ALREADY_HAS_ACTIVE_ORDER';
