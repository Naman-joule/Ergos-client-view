import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnderRoot, looksLikePdf, marketFromName, obligationPath, obligationRoot, parseObligationText, slug } from '../lib/obligation.ts';

// Text as pdf.js returns it from real IEX reports (labels and values out of order, labels glued on).
const RTM = `DAILY OBLIGATION SUMMARY REPORT
REPORT - I
24-Nov-26Delivery Date :
Entity ID N2DL0AEV0000 Aayuda Energy Ventures LLPEntity Name: :
N2UP0AEV0002 Bharatiyam_Beverages_Private_Limit
ed
Portfolio Code Portfolio Name: :
Charges
Funds Payin(-) / Payout(+)
-58,296.22
Total`;
const DAM = `DAILY OBLIGATION SUMMARY REPORT
REPORT - I
6-Oct-26Trading Date 7-Oct-26Delivery Date ::
Entity ID N2DL0AEV0000 Aayuda Energy Ventures LLPEntity Name: :
N2UP0AEV0002 Bharatiyam_Beverages_Private_Limit
ed
Portfolio Code Portfolio Name: :`;
// pdftotext -layout
const LAYOUT = `                 DAILY OBLIGATION SUMMARY REPORT
        Delivery Date                     :   10-Aug-26
        Entity ID                         :   N2DL0AEV0000                      Entity Name          : Aayuda Energy Ventures LLP
        Portfolio Code                    :   N2UP0AEV0002                      Portfolio Name       : Bharatiyam_Beverages_Private_Limit
                                                                                                       ed
`;

test('RTM report: delivery date, portfolio, market', () => {
  const r = parseObligationText(RTM, 'RTM_IEX241126DOR_AEV0002_UP0_Bharatiyam_Beverages_Pvt.pdf');
  assert.ok(!('error' in r));
  assert.equal(r.deliveryDate, '2026-11-24');
  assert.equal(r.tradingDate, null);
  assert.equal(r.market, 'RTM');
  assert.equal(r.entityId, 'N2DL0AEV0000');
  assert.equal(r.portfolioCode, 'N2UP0AEV0002');
  assert.equal(r.portfolioName, 'Bharatiyam Beverages Private Limited');
});

test('day-ahead report: delivery is the later date, filed as DAM; name is the trading date', () => {
  const r = parseObligationText(DAM, 'IEX061026DOR_AEV0002_UP0_Bharatiyam_Beverages_Pvt.pdf');
  assert.ok(!('error' in r));
  assert.deepEqual([r.tradingDate, r.deliveryDate, r.market, r.marketFrom], ['2026-10-06', '2026-10-07', 'DAM', 'content']);
  const g = parseObligationText(DAM, 'GDAM_IEX061026DOR.pdf');
  assert.ok(!('error' in g)); assert.equal(g.market, 'GDAM');
  // a name that contradicts the content is ignored
  const x = parseObligationText(DAM, 'RTM BBPL 6 Oct.pdf');
  assert.ok(!('error' in x)); assert.equal(x.market, 'DAM');
});

test('layout text and loose file names', () => {
  const r = parseObligationText(LAYOUT, 'RTM BBPL 10 Aug.pdf');
  assert.ok(!('error' in r));
  assert.deepEqual([r.deliveryDate, r.market, r.portfolioCode, r.portfolioName], ['2026-08-10', 'RTM', 'N2UP0AEV0002', 'Bharatiyam Beverages Private Limited']);
});

test('rejects other documents and ambiguous dates', () => {
  assert.ok('error' in parseObligationText('Some invoice 1-Oct-26', 'x.pdf'));
  assert.ok('error' in parseObligationText('DAILY OBLIGATION SUMMARY REPORT no date here', 'x.pdf'));
  assert.ok('error' in parseObligationText('DAILY OBLIGATION SUMMARY REPORT 1-Oct-26 2-Oct-26', 'x.pdf'));
  assert.ok('error' in parseObligationText('DAILY OBLIGATION SUMMARY REPORT 31-Sep-26 Delivery Date', 'x.pdf'));
});

test('market from file name', () => {
  assert.equal(marketFromName('RTM_IEX241126DOR.pdf'), 'RTM');
  assert.equal(marketFromName('RTM BBPL 3 August.pdf'), 'RTM');
  assert.equal(marketFromName('HP-DAM report.pdf'), 'HP-DAM');
  assert.equal(marketFromName('hpdam_x.pdf'), 'HP-DAM');
  assert.equal(marketFromName('GDAM 1 Oct.pdf'), 'GDAM');
  assert.equal(marketFromName('IEX061026DOR_AEV0002.pdf'), null);
  assert.equal(marketFromName('TRAMADOL.pdf'), null);
});

test('storage paths stay under the root', () => {
  const env = { OBLIGATION_FTP_ROOT: 'iex_obligation/' } as unknown as NodeJS.ProcessEnv;
  assert.equal(obligationRoot(env), '/iex_obligation');
  assert.equal(obligationRoot({ OBLIGATION_FTP_ROOT: '/a/../../b' } as unknown as NodeJS.ProcessEnv), '/b');
  const p = obligationPath(42, 'Bharatiyam Beverages (Unit-1)', 'RTM', '2026-11-24', env);
  assert.equal(p, '/iex_obligation/42-bharatiyam-beverages-unit-1/2026/11/RTM_2026-11-24.pdf');
  assert.ok(isUnderRoot(p, env));
  assert.ok(!isUnderRoot('/iex_obligation/../etc/passwd.pdf', env));
  assert.ok(!isUnderRoot('/other/x.pdf', env));
  assert.ok(!isUnderRoot('/iex_obligation/x.txt', env));
  assert.throws(() => obligationPath(1, 'x', 'RTM', '2026-11-24/../../x', env));
  assert.equal(slug('../../'), 'plant');
});

test('PDF magic bytes', () => {
  assert.ok(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n...')));
  assert.ok(!looksLikePdf(new TextEncoder().encode('<html>')));
});
