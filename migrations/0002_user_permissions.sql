-- EDWISE user permission model migration
-- Apply once to the production D1 database before deploying code that reads these columns.
-- Existing role values are intentionally preserved to avoid rebuilding the admins table
-- and breaking current accounts or foreign-key references.

ALTER TABLE admins
  ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE admins
  ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_role_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO admin_role_templates
  (role_key, role_name, permissions_json, is_system)
VALUES
  ('content_admin', 'Admin', '{"dashboard":{"view":true},"pages":{"view":true,"create":true,"edit":true,"delete":true,"publish":true},"services":{"view":true,"create":true,"edit":true,"delete":true,"publish":true},"applications":{"view":true,"create":true,"edit":true},"menu":{"view":true,"create":true,"edit":true},"seo":{"view":true,"edit":true},"languages":{"view":true,"edit":true},"settings":{"view":true,"edit":true}}', 1),
  ('editor', 'Editör', '{"dashboard":{"view":true},"pages":{"view":true,"create":true,"edit":true},"services":{"view":true,"create":true,"edit":true},"applications":{"view":true},"menu":{"view":true},"seo":{"view":true}}', 1),
  ('viewer', 'Görüntüleyici', '{"dashboard":{"view":true},"pages":{"view":true},"services":{"view":true},"applications":{"view":true},"menu":{"view":true},"seo":{"view":true},"languages":{"view":true},"settings":{"view":true}}', 1);
