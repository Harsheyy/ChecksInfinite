-- supabase/migrations/041_pattern_query_pricing.sql
-- Safe to re-run: DROP/ADD CONSTRAINT IF EXISTS, ON CONFLICT upsert
--
-- Adds a distinct 'pattern_query' action, priced separately from
-- 'recipe_view'. Previously clicking a Pattern layout to reveal its
-- matching recipes was billed as 'recipe_view' (0.25 credit) with no
-- further charge for opening an individual recipe within it. Now:
--   - pattern_query (0.5): clicking a layout to reveal its recipe list
--     (was mispriced as recipe_view before this migration)
--   - recipe_view (0.25): opening one specific recipe's detail — already
--     used by Curated, now ALSO applies within Patterns' opened layout
--     list and to Token ID / Wallet / Global search results (frontend
--     changes, not part of this migration).

ALTER TABLE pricing_config DROP CONSTRAINT IF EXISTS pricing_config_action_type_check;
ALTER TABLE pricing_config ADD CONSTRAINT pricing_config_action_type_check
  CHECK (action_type IN ('search_query', 'recipe_view', 'pattern_query'));

ALTER TABLE credit_charges DROP CONSTRAINT IF EXISTS credit_charges_action_type_check;
ALTER TABLE credit_charges ADD CONSTRAINT credit_charges_action_type_check
  CHECK (action_type IN ('search_query', 'recipe_view', 'pattern_query'));

INSERT INTO pricing_config (action_type, price_credits) VALUES ('pattern_query', 0.5)
ON CONFLICT (action_type) DO UPDATE SET price_credits = EXCLUDED.price_credits;
