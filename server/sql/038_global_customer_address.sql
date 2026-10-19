-- Extend the legacy China-only address table without losing existing addresses.
ALTER TABLE customer_address ADD COLUMN country_code TEXT NOT NULL DEFAULT 'CN';
ALTER TABLE customer_address ADD COLUMN recipient_name TEXT;
ALTER TABLE customer_address ADD COLUMN phone_e164 TEXT;
ALTER TABLE customer_address ADD COLUMN address_line1 TEXT;
ALTER TABLE customer_address ADD COLUMN address_line2 TEXT;
ALTER TABLE customer_address ADD COLUMN state_code TEXT;
ALTER TABLE customer_address ADD COLUMN postal_code TEXT;
ALTER TABLE customer_address ADD COLUMN street TEXT;
ALTER TABLE customer_address ADD COLUMN region_codes TEXT;
ALTER TABLE customer_address ADD COLUMN label TEXT;
ALTER TABLE customer_address ADD COLUMN delivery_instructions TEXT;
ALTER TABLE customer_address ADD COLUMN validated_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE customer_address ADD COLUMN last_used_at DATETIME;
UPDATE customer_address SET recipient_name = receiver_name, phone_e164 = '+86' || receiver_phone, address_line1 = detail_address,
  region_codes = NULL WHERE phone_e164 IS NULL;
