-- ergOS client view: roles, permissions and their mapping. Idempotent.

BEGIN;

INSERT INTO role (name) VALUES ('admin'), ('manager'), ('client_user')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permission (permission_name) VALUES
  ('view_today'), ('view_savings'), ('view_iex'), ('view_banking'), ('view_billing'),
  ('manage_dashboards'), ('admin_access')
ON CONFLICT (permission_name) DO NOTHING;

-- admin: everything
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- manager: every view_* plus manage_dashboards
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.name = 'manager' AND (p.permission_name LIKE 'view\_%' OR p.permission_name = 'manage_dashboards')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- client_user: every view_*
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.permission_id FROM role r CROSS JOIN permission p
WHERE r.name = 'client_user' AND p.permission_name LIKE 'view\_%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
