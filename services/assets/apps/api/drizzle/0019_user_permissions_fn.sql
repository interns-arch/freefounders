-- FreeFounders roles (PLAN.md section 15): a user's permissions. When the role builder gave the user roles
-- (user_roles), only those count (archived roles give nothing); otherwise the user's own role does.
-- A plain SQL body (not BEGIN ATOMIC) is resolved with the caller's search_path, so in multi-company mode it reads
-- the company's own tables.
CREATE OR REPLACE FUNCTION user_permissions(uid uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = uid) THEN
      coalesce((SELECT array_agg(DISTINCT p ORDER BY p)
                FROM user_roles ur JOIN roles r ON r.id = ur.role_id, unnest(r.permissions) AS p
                WHERE ur.user_id = uid AND NOT r.archived), '{}'::text[])
    ELSE (SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = uid)
  END
$$;
