-- Attribution travels in the package, so the store keeps the last submitted
-- credits beside the version it published. A later submission compares against
-- them; without this a credits-only correction looks like "no change".
ALTER TABLE presign_event ADD COLUMN credits_json TEXT;
ALTER TABLE item_version ADD COLUMN credits_json TEXT;
