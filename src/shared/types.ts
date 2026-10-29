export type Role = 'owner' | 'cashier';
export interface User { id: string; name: string; username: string; role: Role; recoveryEnabled?: boolean }
export interface Shop { name: string; category: string; phone: string; address: string; currency: string; footer: string; paperWidth: '80' | '58' | 'A4'; logo?: string }
export interface Product { id: string; name: string; category: string; variant: string; price: number; stock: number; trackStock: boolean; active: boolean; image?: string }
export interface OrderItem { productId: string; quantity: number; note: string; name?: string; price?: number; stockDeducted?: number }
export type OrderStatus = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type StockDisposition = 'return' | 'waste';
export type PaymentMethod = 'cash' | 'card' | 'bank' | 'unpaid';
export interface OrderInput { items: OrderItem[]; type: 'dine-in' | 'takeaway' | 'delivery'; table: string; customer: string; phone: string; address: string; rider: string; note: string; discount: number; deliveryCharge: number; paymentMethod: PaymentMethod; cashReceived: number }
export interface Order extends OrderInput { id: string; number: number; createdAt: string; status: OrderStatus; subtotal: number; total: number; paid: number; change: number; refunded: number; createdBy: string; stockDisposition?: StockDisposition }
export interface Expense { id: string; category: string; amount: number; note: string; date: string }
export interface Closing { id: string; openedAt: string; closedAt: string | null; openingCash: number; expectedCash: number; countedCash: number | null; difference: number | null }
export interface Snapshot { shop: Shop | null; user: User | null; users: User[]; products: Product[]; orders: Order[]; expenses: Expense[]; closing: Closing | null; dataPath: string; version: string }
export interface SetupInput { shop: Shop; owner: { name: string; username: string; password: string; recoveryToken?: string } }
export interface ChangePasswordInput { currentPassword: string; newPassword: string; confirmPassword: string }
export interface RecoveryTokenInput { currentPassword: string; recoveryToken: string; confirmToken: string }
export interface ServeoAPI {
  snapshot(): Promise<Snapshot>;
  setup(input: SetupInput): Promise<Snapshot>;
  login(username: string, password: string): Promise<Snapshot>;
  logout(): Promise<Snapshot>;
  changePassword(input: ChangePasswordInput): Promise<Snapshot>;
  setRecoveryToken(input: RecoveryTokenInput): Promise<Snapshot>;
  beginPasswordReset(username: string, recoveryToken: string): Promise<void>;
  resetPassword(newPassword: string, confirmPassword: string): Promise<Snapshot>;
  saveShop(shop: Shop): Promise<Snapshot>;
  saveProduct(product: Product): Promise<Snapshot>;
  saveUser(input: { name: string; username: string; password: string; role: Role; recoveryToken?: string }): Promise<Snapshot>;
  createOrder(input: OrderInput): Promise<Snapshot>;
  setOrderStatus(id: string, status: OrderStatus): Promise<Snapshot>;
  collectPayment(id: string, method: PaymentMethod, cashReceived: number): Promise<Snapshot>;
  refundOrder(id: string, reason: string, disposition: StockDisposition): Promise<Snapshot>;
  addExpense(input: { category: string; amount: number; note: string }): Promise<Snapshot>;
  openDay(openingCash: number): Promise<Snapshot>;
  closeDay(countedCash: number): Promise<Snapshot>;
  exportBackup(): Promise<string | null>;
  restoreBackup(): Promise<Snapshot | null>;
  printOrder(id: string, kind: 'receipt' | 'kitchen' | 'invoice'): Promise<void>;
}
declare global { interface Window { serveo: ServeoAPI } }
