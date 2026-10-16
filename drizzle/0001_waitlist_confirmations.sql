CREATE TABLE `waitlist_confirmation_outbox` (
  `email` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL DEFAULT 'pending'
    CHECK (`status` IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
  `attempts` integer NOT NULL DEFAULT 0 CHECK (`attempts` BETWEEN 0 AND 3),
  `available_at` integer NOT NULL CHECK (`available_at` >= 0),
  `lease_token` text,
  `lease_until` integer,
  `created_at` integer NOT NULL CHECK (`created_at` >= 0),
  `client_key` text NOT NULL
    CHECK (length(`client_key`) = 64 AND `client_key` NOT GLOB '*[^0-9a-f]*'),
  `last_reason` text NOT NULL DEFAULT 'queued'
    CHECK (`last_reason` IN (
      'queued', 'sending', 'accepted', 'delivered', 'rate-limited',
      'provider-unavailable', 'invalid-config', 'invalid-recipient',
      'invalid-request', 'permanent-bounce', 'recipient-suppressed',
      'not-configured', 'timeout', 'network', 'invalid-response',
      'ambiguous', 'lease-expired', 'attempts-exhausted', 'permanent-failure'
    )),
  CHECK (
    (`status` = 'sending' AND `attempts` >= 1
      AND `lease_token` IS NOT NULL AND `lease_until` IS NOT NULL)
    OR (`status` <> 'sending' AND `lease_token` IS NULL AND `lease_until` IS NULL)
  )
);

CREATE INDEX `waitlist_confirmation_ready`
  ON `waitlist_confirmation_outbox` (`status`, `available_at`, `created_at`, `email`);
CREATE INDEX `waitlist_confirmation_created`
  ON `waitlist_confirmation_outbox` (`created_at`);
CREATE INDEX `waitlist_confirmation_client_created`
  ON `waitlist_confirmation_outbox` (`client_key`, `created_at`);
