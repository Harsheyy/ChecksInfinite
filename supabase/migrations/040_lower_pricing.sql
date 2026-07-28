-- supabase/migrations/040_lower_pricing.sql
-- Safe to re-run: plain UPDATE, idempotent
--
-- Lowers pricing per user feedback that the initial $1/$0.50 rates felt
-- excessive: search_query 1 -> 0.5 credit ($0.50), recipe_view 0.5 -> 0.25
-- credit ($0.25).

UPDATE pricing_config SET price_credits = 0.5  WHERE action_type = 'search_query';
UPDATE pricing_config SET price_credits = 0.25 WHERE action_type = 'recipe_view';
