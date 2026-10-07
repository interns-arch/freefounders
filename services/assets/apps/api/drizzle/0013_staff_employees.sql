-- Everyone with a login is an employee, except the CEO / leadership.
-- Logins without an employee record get one, numbered STAFF-001, STAFF-002…
WITH todo AS (
  SELECT u.id, u.name, u.email,
    'STAFF-' || lpad((row_number() OVER (ORDER BY u.created_at, u.id) + coalesce((SELECT last_value FROM sequences WHERE prefix = 'STAFF'), 0))::text, 3, '0') AS code
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE u.employee_id IS NULL AND NOT ('insights:leadership' = ANY (r.permissions))
),
added AS (
  INSERT INTO employees (employee_code, first_name, last_name, email, company_id)
  SELECT t.code,
    split_part(trim(t.name), ' ', 1),
    nullif(trim(substr(trim(t.name), length(split_part(trim(t.name), ' ', 1)) + 1)), ''),
    CASE WHEN t.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.email) = lower(t.email)) THEN t.email END,
    (SELECT id FROM companies ORDER BY created_at LIMIT 1)
  FROM todo t
  ON CONFLICT DO NOTHING
  RETURNING id, employee_code
)
UPDATE users u SET employee_id = a.id, updated_at = now()
FROM todo t JOIN added a ON a.employee_code = t.code
WHERE u.id = t.id;
--> statement-breakpoint
INSERT INTO sequences (prefix, last_value)
SELECT 'STAFF', max(substr(employee_code, 7)::int) FROM employees WHERE employee_code ~ '^STAFF-[0-9]+$' HAVING count(*) > 0
ON CONFLICT (prefix) DO UPDATE SET last_value = greatest(sequences.last_value, excluded.last_value);
