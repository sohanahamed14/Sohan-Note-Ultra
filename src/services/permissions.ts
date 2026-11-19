import type { Role } from '@/db/schema';

export type Action =
  | 'sell'
  | 'buy'
  | 'viewProducts'
  | 'manageProducts'
  | 'viewCost'
  | 'viewProfit'
  | 'viewReports'
  | 'viewStock'
  | 'adjustStock'
  | 'manageParties'
  | 'collectDue'
  | 'addExpense'
  | 'viewCashbox'
  | 'manageCash'
  | 'manageCapital'
  | 'manageOnline'
  | 'delete'
  | 'restore'
  | 'manageSettings'
  | 'manageEmployees';

const CASHIER: readonly Action[] = [
  'sell',
  'viewProducts',
  'viewStock',
  'manageParties',
  'collectDue',
  'addExpense',
];

const MANAGER_DENIED: readonly Action[] = ['manageSettings', 'manageEmployees'];

const ALL: readonly Action[] = [
  ...CASHIER,
  'buy',
  'manageProducts',
  'viewCost',
  'viewProfit',
  'viewReports',
  'adjustStock',
  'viewCashbox',
  'manageCash',
  'manageCapital',
  'manageOnline',
  'delete',
  'restore',
  'manageSettings',
  'manageEmployees',
];

const GRANTS: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ALL),
  manager: new Set(ALL.filter((a) => !MANAGER_DENIED.includes(a))),
  cashier: new Set(CASHIER),
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role ? GRANTS[role].has(action) : false;
}
