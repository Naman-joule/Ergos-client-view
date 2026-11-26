// Exchange (IEX) purchases priced the way ergOS's daily savings statement prices them. The cleared quantity less
// open-access losses (distribution, CTU, STU) is what reaches the plant; its cost is the landed cost plus
// cross-subsidy surcharge (CSS) on the delivered kWh. e.g. Haldiram C1, 4 Nov 2026: 12,750 kWh cleared ×
// (1 − 3%)(1 − 3.95%)(1 − 3.18%) = 11,501.2 kWh delivered; CSS 0.49 × 11,501.2 = ₹5,635.60, as on its statement.
//
// The loss and CSS rates come from, in order:
//   1. the plant's latest savings statement on or before the day (iex_tod_daily_obligation: the rates ergOS
//      applied; matched by plant, or by portfolio for statements without a plant);
//   2. the plant's open-access charges row in force that day (plant_open_access_charges);
//   3. neither: the cleared quantity and landed cost stand.
//
// `buyRows(where)` is a FROM-able subquery with: date, block_no, cleared, kwh (delivered), landed (₹, incl. CSS),
// mcp (₹/kWh market clearing price). `where` filters trading_result_block aliased as b.
export const buyRows = (where: string) => `(
  SELECT b.date, b.block_no,
         coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250) AS cleared,
         coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250) * coalesce(oa.factor, 1) AS kwh,
         coalesce(b.landed_cost, coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250) * b.landed_cost_rs_per_kwh)
           + coalesce(oa.css, 0) * coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250) * coalesce(oa.factor, 1) AS landed,
         CASE WHEN b.cleared_price > 100 THEN b.cleared_price / 1000 ELSE b.cleared_price END AS mcp
  FROM trading_result_block b
  LEFT JOIN LATERAL (
    SELECT factor, css FROM (
      (SELECT 1 AS src, (1 - coalesce(o.distribution_loss_pct, 0) / 100) * (1 - coalesce(o.ctu_loss_pct, 0) / 100)
                * (1 - coalesce(o.stu_loss_pct, 0) / 100) AS factor,
              coalesce(o.css_rate_per_kwh, 0) AS css
       FROM iex_tod_daily_obligation o
       WHERE (o.plant_id = b.plant_id OR (o.plant_id IS NULL AND o.portfolio_id = b.portfolio_id))
         AND o.trade_date <= b.date
         AND (o.distribution_loss_pct IS NOT NULL OR o.ctu_loss_pct IS NOT NULL OR o.stu_loss_pct IS NOT NULL OR o.css_rate_per_kwh IS NOT NULL)
       ORDER BY o.trade_date DESC, o.id DESC LIMIT 1)
      UNION ALL
      (SELECT 2, (1 - coalesce(c.distribution_loss_pct, 0) / 100) * (1 - coalesce(c.ctu_loss_pct, 0) / 100)
                * (1 - coalesce(c.stu_loss_pct, 0) / 100),
              coalesce(c.css_rate_per_kwh, 0)
       FROM plant_open_access_charges c
       WHERE c.plant_id = b.plant_id AND c.effective_from <= b.date AND (c.effective_to IS NULL OR c.effective_to >= b.date)
       ORDER BY c.effective_from DESC LIMIT 1)
    ) r ORDER BY src LIMIT 1
  ) oa ON true
  WHERE upper(b.type_) = 'BUY' AND ${where}
)`;
