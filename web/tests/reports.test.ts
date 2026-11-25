import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateReport, reportFileName, ftpSettings, pickCovering } from '../lib/report-path.ts';

const env = (e: Record<string, string>) => ({ REPORTS_FTP_URL: 'ftp://ro:pw@reports.example:21/', ...e }) as unknown as NodeJS.ProcessEnv;

test('web links open directly, even without FTP configured', () => {
  assert.deepEqual(locateReport('https://x.example/a.pdf', {} as unknown as NodeJS.ProcessEnv), { via: 'url', url: 'https://x.example/a.pdf' });
});

test('plain and ftp:// paths go through FTP only when it is configured', () => {
  assert.equal(locateReport('/reports/2026/10/a.xlsx', {} as unknown as NodeJS.ProcessEnv), null);
  assert.deepEqual(locateReport('/reports/2026/10/a.xlsx', env({})), { via: 'ftp', path: '/reports/2026/10/a.xlsx' });
  assert.deepEqual(locateReport('reports/a b.xlsx', env({})), { via: 'ftp', path: '/reports/a b.xlsx' });
  assert.deepEqual(locateReport('ftp://host/reports/a%20b.pdf', env({})), { via: 'ftp', path: '/reports/a b.pdf' });
  assert.deepEqual(locateReport('C:\\ergos\\reports\\a.pdf', env({ REPORTS_FTP_STRIP_PREFIX: 'C:\\ergos' })), { via: 'ftp', path: '/reports/a.pdf' });
});

test('strip prefix maps server paths to FTP paths', () => {
  assert.deepEqual(locateReport('/home/ergos/ftp/reports/a.pdf', env({ REPORTS_FTP_STRIP_PREFIX: '/home/ergos/ftp/' })), { via: 'ftp', path: '/reports/a.pdf' });
});

test('no escaping the reports folder', () => {
  assert.equal(locateReport('/reports/../etc/passwd', env({})), null);
  assert.equal(locateReport('/other/a.pdf', env({ REPORTS_FTP_ROOT: '/reports' })), null);
  assert.equal(locateReport('/reportsX/a.pdf', env({ REPORTS_FTP_ROOT: 'reports' })), null);
  assert.deepEqual(locateReport('/reports/x/a.pdf', env({ REPORTS_FTP_ROOT: '/reports/' })), { via: 'ftp', path: '/reports/x/a.pdf' });
  assert.equal(locateReport('/reports/', env({})), null);
  assert.equal(locateReport('javascript:alert(1)', env({})), null);
  assert.equal(locateReport('file:///etc/passwd', env({})), null);
  assert.equal(locateReport('', env({})), null);
});

test('file names and settings', () => {
  assert.equal(reportFileName('/r/Savings "Oct" 22.xlsx', 'x'), 'Savings _Oct_ 22.xlsx');
  assert.deepEqual(ftpSettings('ftps://user:p%40ss@h.example:990/'), { host: 'h.example', port: 990, user: 'user', password: 'p@ss', secure: true });
});

test('local:// paths from older ergOS rows map to the FTP folder', () => {
  assert.deepEqual(locateReport('local://tod_savings/excel/A_01-Oct-2026_to_29-Oct-2026.xlsx', env({})),
    { via: 'ftp', path: '/tod_savings/excel/A_01-Oct-2026_to_29-Oct-2026.xlsx' });
  assert.deepEqual(locateReport('ftp://122.186.70.126:21/tod_savings/pdf/IEX_Trade_Report_Haldiram_23-Nov-2026.pdf', env({ REPORTS_FTP_ROOT: '/tod_savings' })),
    { via: 'ftp', path: '/tod_savings/pdf/IEX_Trade_Report_Haldiram_23-Nov-2026.pdf' });
});

test('a replaced period file is found by the range that covers the day', () => {
  const folder = [
    'ToD_Savings_Calculations_IEX_Bharatiyam_20-Nov-2026_to_23-Nov-2026.xlsx',
    'ToD_Savings_Calculations_IEX_HALDIRAM_01-Oct-2026_to_31-Oct-2026.xlsx',
    'ToD_Savings_Calculations_IEX_Haldiram_01-Nov-2026_to_23-Nov-2026.xlsx',
  ];
  const old = '/tod_savings/excel/ToD_Savings_Calculations_IEX_HALDIRAM_01-Oct-2026_to_29-Oct-2026.xlsx';
  assert.equal(pickCovering(folder, old, '2026-10-29'), 'ToD_Savings_Calculations_IEX_HALDIRAM_01-Oct-2026_to_31-Oct-2026.xlsx');
  assert.equal(pickCovering(folder, '/x/ToD_Savings_Calculations_IEX_Haldiram_01-Nov-2026_to_14-Nov-2026.xlsx', '2026-11-10'),
    'ToD_Savings_Calculations_IEX_Haldiram_01-Nov-2026_to_23-Nov-2026.xlsx');
  assert.equal(pickCovering(folder, old, '2026-12-01'), null);                       // nothing covers it
  assert.equal(pickCovering(['IEX_Trade_Report_HALDIRAM_30-Oct-2026.pdf'], '/p/IEX_Trade_Report_HALDIRAM_29-Oct-2026.pdf', '2026-10-29'), null);
});
