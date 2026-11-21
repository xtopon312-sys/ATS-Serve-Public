export type ActiveTableOrderConflict = {
  tableId: string;
  activeOrderId: number | string;
};

export function activeTableOrderConflict(error: unknown): ActiveTableOrderConflict | null {
  const response = (error as {
    response?: {
      status?: number;
      data?: { code?: string; tableId?: unknown; activeOrderId?: unknown };
    };
  })?.response;
  if (response?.status !== 409 || response.data?.code !== 'TABLE_ALREADY_HAS_ACTIVE_ORDER') return null;
  const tableId = response.data.tableId;
  const activeOrderId = response.data.activeOrderId;
  if (typeof tableId !== 'string' || !tableId || (typeof activeOrderId !== 'number' && typeof activeOrderId !== 'string')) return null;
  return { tableId, activeOrderId };
}

export async function recoverActiveTableOrder<T>(
  error: unknown,
  loadOrder: (orderId: number | string) => Promise<T>,
): Promise<T | null> {
  const conflict = activeTableOrderConflict(error);
  if (!conflict) return null;
  return loadOrder(conflict.activeOrderId);
}
