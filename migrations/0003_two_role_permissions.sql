-- Canonicalize legacy account roles and replace broad legacy permissions.
-- Existing per-user permission JSON is retained; the application enforces a strict
-- content-manager module/action allowlist at request time.
UPDATE admins
SET role = 'content_admin'
WHERE role IN ('editor', 'viewer', 'admin');

UPDATE admins
SET permissions_json = json_set(
  CASE
    WHEN permissions_json IS NOT NULL AND json_valid(permissions_json) AND json_type(permissions_json) = 'object' THEN permissions_json
    ELSE '{}'
  END,
  '$.__role_key',
  'content_admin'
)
WHERE role = 'content_admin';

DELETE FROM admin_role_templates
WHERE role_key IN ('editor', 'viewer', 'admin');

INSERT INTO admin_role_templates (
  role_key,
  role_name,
  permissions_json,
  is_system,
  updated_at
)
VALUES (
  'content_admin',
  'İçerik Yöneticisi',
  '{"dashboard":{"view":true},"pages":{"view":true,"create":true,"edit":true,"delete":false,"publish":true},"lessons":{"view":true,"create":true,"edit":true,"delete":false},"services":{"view":true,"create":true,"edit":true,"delete":false,"publish":true},"media":{"view":true,"create":true,"edit":true,"delete":false},"applications":{"view":true,"create":false,"edit":true,"delete":false},"menu":{"view":true,"create":false,"edit":true,"delete":false,"publish":false},"profile":{"view":true,"create":false,"edit":true,"delete":false,"publish":false}}',
  1,
  datetime('now')
)
ON CONFLICT(role_key) DO UPDATE SET
  role_name = excluded.role_name,
  permissions_json = excluded.permissions_json,
  is_system = 1,
  updated_at = datetime('now');
