import type { Order } from './types';
export const serviceLabel = (type: Order['type']) => ({delivery:'Delivery', 'dine-in':'Dine-in', takeaway:'Takeaway'})[type];
export function customerLabel(order: Pick<Order,'customer'|'type'>): string {
  return order.customer.trim() || (order.type==='delivery' ? 'Delivery customer ? name not recorded' : order.type==='dine-in' ? 'Dine-in customer' : 'Walk-in customer');
}
