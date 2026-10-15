CREATE TABLE `waitlist` (
  `email` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `created_at` text NOT NULL,
  `utm_source` text NOT NULL DEFAULT '',
  `utm_medium` text NOT NULL DEFAULT '',
  `utm_campaign` text NOT NULL DEFAULT '',
  `utm_content` text NOT NULL DEFAULT '',
  `utm_term` text NOT NULL DEFAULT ''
);
