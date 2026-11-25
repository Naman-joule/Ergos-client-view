// Exchange (IEX) purchases as ergOS bills them. The cleared quantity less open-access losses (distribution, CTU,
// STU) is what reaches the plant; its cost is the landed cost plus cross-subsidy surcharge on the delivered kWh.
// Loss and CSS come from the plant's open-access charges row in force that day; with no row the cleared quantity
// and landed cost stand. ergOS's Haldiram C1 bill: delivered = cleared × 0.9056, cost = landed + ₹0.49 × delivered.
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
    SELECT (1 - coalesce(c.distribution_loss_pct, 0) / 100) * (1 - coalesce(c.ctu_loss_pct, 0) / 100)
             * (1 - coalesce(c.stu_loss_pct, 0) / 100) AS factor,
           coalesce(c.css_rate_per_kwh, 0) AS css
    FROM plant_open_access_charges c
    WHERE c.plant_id = b.plant_id AND c.effective_from <= b.date AND (c.effective_to IS NULL OR c.effective_to >= b.date)
    ORDER BY c.effective_from DESC LIMIT 1
  ) oa ON true
  WHERE upper(b.type_) = 'BUY' AND ${where}
)`;
