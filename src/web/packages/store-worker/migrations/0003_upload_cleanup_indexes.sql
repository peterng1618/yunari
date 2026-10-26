-- Cleanup selects by age alone, and its NOT EXISTS plus the finalize release
-- join read item_version.package_key; neither has an index today.
CREATE INDEX upload_created_at ON upload(created_at);
CREATE INDEX item_version_package_key ON item_version(package_key);
