import {
  ACTIVE_TABLE_ORDER_PREDICATE_SQL,
  TABLE_ALREADY_HAS_ACTIVE_ORDER,
} from '../../shared/order-lifecycle';
import type Database from 'better-sqlite3';

type QueryDatabase = Pick<Database.Database, 'prepare'>;

export type ActiveTableOrder = {
  id: number | string;
  table_id: string;
  status: string;
};

export type TableOrderConflictError = Error & {
  status: number;
  statusCode: number;
  code: typeof TABLE_ALREADY_HAS_ACTIVE_ORDER;
  tableId: string;
  activeOrderId: number | string;
};

export function findActiveTableOrder(
  db: QueryDatabase,
  tableId: string,
  excludeOrderId?: number | string,
): ActiveTableOrder | undefined {
  const exclusion = excludeOrderId === undefined ? '' : ' AND id != ?';
  const params = excludeOrderId === undefined ? [tableId] : [tableId, excludeOrderId];
  return db.prepare(`
    SELECT id, table_id, status
    FROM orders
    WHERE table_id = ? AND ${ACTIVE_TABLE_ORDER_PREDICATE_SQL}${exclusion}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(...params) as ActiveTableOrder | undefined;
}

export function tableOrderConflictError(
  tableId: string,
  activeOrderId: number | string,
): TableOrderConflictError {
  return Object.assign(new Error('Table already has an active order'), {
    status: 409,
    statusCode: 409,
    code: TABLE_ALREADY_HAS_ACTIVE_ORDER,
    tableId,
    activeOrderId,
  }) as TableOrderConflictError;
}

export function isActiveTableOrderUniqueConstraint(error: unknown): boolean {
  const sqliteError = error as { code?: string; message?: string } | null;
  return sqliteError?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && String(sqliteError.message || '').includes('orders.table_id');
}

export function normalizeActiveTableOrderConstraint(
  error: unknown,
  db: QueryDatabase,
  tableId: string | null | undefined,
): unknown {
  if (!tableId || !isActiveTableOrderUniqueConstraint(error)) return error;
  const activeOrder = findActiveTableOrder(db, tableId);
  return activeOrder ? tableOrderConflictError(tableId, activeOrder.id) : error;
}

export function tableOrderConflictBody(error: TableOrderConflictError) {
  return {
    code: error.code,
    error: error.message,
    tableId: error.tableId,
    activeOrderId: error.activeOrderId,
  };
}
