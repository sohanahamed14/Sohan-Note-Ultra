import { can } from './permissions';

describe('permissions', () => {
  it('owner can everything', () => {
    expect(can('owner', 'manageEmployees')).toBe(true);
    expect(can('owner', 'viewProfit')).toBe(true);
  });
  it('manager lacks settings/employees only', () => {
    expect(can('manager', 'viewReports')).toBe(true);
    expect(can('manager', 'delete')).toBe(true);
    expect(can('manager', 'manageSettings')).toBe(false);
    expect(can('manager', 'manageEmployees')).toBe(false);
  });
  it('cashier restricted', () => {
    expect(can('cashier', 'sell')).toBe(true);
    for (const a of [
      'viewProfit',
      'viewReports',
      'viewCost',
      'manageSettings',
      'manageEmployees',
      'delete',
    ] as const) {
      expect(can('cashier', a)).toBe(false);
    }
  });
  it('no role → no access', () => {
    expect(can(null, 'sell')).toBe(false);
  });
});
