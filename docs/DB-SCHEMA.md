# Kaampilot database schema

Generated 2026-10-13 from the local dev databases (`npm run dev`). Columns: name, type, NULL allowed, default. **PK** = primary key, **FK** = foreign key → table.column.

## How it fits together

| Database | Where | Holds | Company separation |
|---|---|---|---|
| Platform `ff_platform` (schema `platform`) | Postgres :5434 | companies, people, logins, roles + permissions (`role_grants`), sign-in sessions, signing keys | `company_id` column on each row |
| Tasks `ff_tasks` | Postgres :5434 | tasks, leads, attendance, leave, payroll, mistakes, links, notices, notifications | one schema per company (`co_<code>`); registry `public.ff_companies` |
| Assets `eam` | Postgres :5433 | assets, allocations, employees, onboarding/exits, tickets, maintenance, photos (bytea) | one schema per company (`co_<code>`); registry `ff.companies` |

Links between them (no cross-database foreign keys): a Platform `people.id` is pushed to the apps as the person's
identity (Tasks `accounts_user`, Assets `users`/`employees`); roles go to Tasks `accounts_accessrole`/`accounts_accessgrant`
and Assets `roles`/`user_roles`; cross-app events travel through each app's outbox (Tasks `tenancy_outboxevent`,
Assets `ff_events`), read by the Platform (`event_cursors`). Removed 2026-10-13: Idea board and Web forms tables.

## Databases

- Platform (sign-in, companies, people, roles)
- Tasks + HR + Payroll (Django)
- Assets (NestJS)

## Platform (sign-in, companies, people, roles)

12 tables.

### __drizzle_migrations

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | integer |  | `nextval('platform.__drizzle_migrations_i` | **PK** |
| hash | text |  |  |  |
| created_at | bigint | yes |  |  |

### companies

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text |  |  |  |
| enabled_apps | text[] |  | `'{}'::text[]` |  |
| status | text |  | `'active'::text` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| access_version | integer |  | `0` |  |
| short_name | text | yes |  |  |
| brand_colour | text | yes |  |  |
| logo | bytea | yes |  |  |
| logo_type | text | yes |  |  |
| modules | jsonb |  | `'{}'::jsonb` |  |
| profile_version | integer |  | `0` |  |
| people_version | integer |  | `0` |  |
| access_upgrades | jsonb |  | `'{}'::jsonb` |  |

### departments

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| company_id | uuid |  |  | **FK** → companies.id |
| code | text |  |  |  |
| name | text |  |  |  |
| active | boolean |  | `true` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### event_cursors

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| company_id | uuid |  |  | **PK** **FK** → companies.id |
| app | text |  |  | **PK** |
| last_id | integer |  | `0` |  |
| updated_at | timestamptz |  | `now()` |  |

### logins

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| person_id | uuid |  |  | **PK** **FK** → people.id |
| username | text | yes |  |  |
| password_hash | text |  |  |  |
| must_change_password | boolean |  | `false` |  |
| failed_logins | integer |  | `0` |  |
| locked_until | timestamptz | yes |  |  |
| last_login_at | timestamptz | yes |  |  |
| password_changed_at | timestamptz |  | `now()` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### people

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| company_id | uuid |  |  | **FK** → companies.id |
| full_name | text |  |  |  |
| employee_code | text | yes |  |  |
| email | text | yes |  |  |
| mobile | text | yes |  |  |
| platform_role | text |  | `'member'::text` |  |
| status | text |  | `'active'::text` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| department_id | uuid | yes |  | **FK** → departments.id |
| designation | text | yes |  |  |
| reports_to | uuid | yes |  | **FK** → people.id |
| join_date | date | yes |  |  |
| last_working_date | date | yes |  |  |

### person_apps

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| person_id | uuid |  |  | **PK** **FK** → people.id |
| app | text |  |  | **PK** |
| local_user_id | text |  |  |  |
| granted_at | timestamptz |  | `now()` |  |

### person_roles

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| person_id | uuid |  |  | **PK** **FK** → people.id |
| role_id | uuid |  |  | **PK** **FK** → roles.id |

### refresh_sessions

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | text |  |  | **PK** |
| family_id | uuid |  |  |  |
| person_id | uuid |  |  | **FK** → people.id |
| client | text |  | `'web'::text` |  |
| expires_at | timestamptz |  |  |  |
| rotated_at | timestamptz | yes |  |  |
| revoked_at | timestamptz | yes |  |  |
| ip | text | yes |  |  |
| user_agent | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |

### role_grants

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| role_id | uuid |  |  | **PK** **FK** → roles.id |
| app | text |  |  | **PK** |
| permission | text |  |  | **PK** |
| scope | text |  | `''::text` |  |

### roles

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| company_id | uuid |  |  | **FK** → companies.id |
| code | text |  |  |  |
| name | text |  |  |  |
| description | text | yes |  |  |
| colour | text | yes |  |  |
| level | integer |  | `1` |  |
| system | boolean |  | `false` |  |
| archived | boolean |  | `false` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| duties | jsonb |  | `'[]'::jsonb` |  |

### signing_keys

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| kid | text |  |  | **PK** |
| public_jwk | jsonb |  |  |  |
| private_enc | text |  |  |  |
| active | boolean |  | `true` |  |
| created_at | timestamptz |  | `now()` |  |


## Tasks + HR + Payroll (Django) — one schema per company; shown: `co_demo` (every company schema is identical)

66 tables.

### accounts_accessgrant

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| permission | varchar(60) |  |  |  |
| scope | varchar(20) |  |  |  |
| role_id | bigint |  |  | **FK** → accounts_accessrole.id |

### accounts_accessrole

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| code | varchar(60) |  |  |  |
| name | varchar(120) |  |  |  |
| description | varchar(300) |  |  |  |
| colour | varchar(20) |  |  |  |
| level | smallint |  |  |  |
| is_system | boolean |  |  |  |
| archived | boolean |  |  |  |
| platform_role_id | uuid | yes |  |  |
| updated_at | timestamptz |  |  |  |

### accounts_departmentoption

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| code | varchar(20) |  |  |  |
| name | varchar(60) |  |  |  |
| active | boolean |  |  |  |
| order | smallint |  |  |  |

### accounts_user

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| password | varchar(128) |  |  |  |
| last_login | timestamptz | yes |  |  |
| is_superuser | boolean |  |  |  |
| username | varchar(150) |  |  |  |
| first_name | varchar(150) |  |  |  |
| last_name | varchar(150) |  |  |  |
| email | varchar(254) |  |  |  |
| is_staff | boolean |  |  |  |
| is_active | boolean |  |  |  |
| date_joined | timestamptz |  |  |  |
| role | varchar(20) |  |  |  |
| department | varchar(20) |  |  |  |
| whatsapp_phone | varchar(20) |  |  |  |
| reporting_manager_id | bigint | yes |  | **FK** → accounts_user.id |
| works_week_off | boolean |  |  |  |
| platform_person_id | uuid | yes |  |  |
| employee_code | varchar(40) |  |  |  |
| designation | varchar(120) |  |  |  |

### accounts_user_groups

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| group_id | integer |  |  | **FK** → auth_group.id |

### accounts_user_user_permissions

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| permission_id | integer |  |  | **FK** → auth_permission.id |

### accounts_useraccessrole

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| role_id | bigint |  |  | **FK** → accounts_accessrole.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| created_at | timestamptz |  |  |  |

### auth_group

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | integer |  |  | **PK** |
| name | varchar(150) |  |  |  |

### auth_group_permissions

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| group_id | integer |  |  | **FK** → auth_group.id |
| permission_id | integer |  |  | **FK** → auth_permission.id |

### auth_permission

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | integer |  |  | **PK** |
| name | varchar(255) |  |  |  |
| content_type_id | integer |  |  | **FK** → django_content_type.id |
| codename | varchar(100) |  |  |  |

### crm_assignmentrule

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| department | varchar(20) |  |  |  |
| strategy | varchar(20) |  |  |  |
| member_ids | jsonb |  |  |  |
| rr_index | integer |  |  |  |
| active | boolean |  |  |  |
| updated_at | timestamptz |  |  |  |

### crm_dutyrun

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| period | varchar(12) |  |  |  |
| created_at | timestamptz |  |  |  |
| task_id | bigint | yes |  | **FK** → crm_task.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| duty_id | bigint |  |  | **FK** → crm_roleduty.id |

### crm_holiday

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(120) |  |  |  |
| date | date |  |  |  |

### crm_lead

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| customer_name | varchar(200) |  |  |  |
| phone | varchar(30) |  |  |  |
| email | varchar(254) |  |  |  |
| company | varchar(200) |  |  |  |
| requirement | text |  |  |  |
| source | varchar(20) |  |  |  |
| department | varchar(20) |  |  |  |
| status | varchar(20) |  |  |  |
| priority | varchar(10) |  |  |  |
| follow_up_at | timestamptz | yes |  |  |
| estimated_value | numeric | yes |  |  |
| ai_meta | jsonb |  |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| assigned_to_id | bigint | yes |  | **FK** → accounts_user.id |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| reminded_at | timestamptz | yes |  |  |

### crm_leaddocument

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| file | varchar(100) |  |  |  |
| filename | varchar(255) |  |  |  |
| created_at | timestamptz |  |  |  |
| lead_id | bigint |  |  | **FK** → crm_lead.id |
| uploaded_by_id | bigint | yes |  | **FK** → accounts_user.id |

### crm_leadevent

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| type | varchar(20) |  |  |  |
| body | text |  |  |  |
| payload | jsonb |  |  |  |
| created_at | timestamptz |  |  |  |
| actor_id | bigint | yes |  | **FK** → accounts_user.id |
| lead_id | bigint |  |  | **FK** → crm_lead.id |

### crm_quotation

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| number | varchar(30) |  |  |  |
| amount | numeric |  |  |  |
| status | varchar(10) |  |  |  |
| notes | text |  |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| lead_id | bigint |  |  | **FK** → crm_lead.id |

### crm_roleduty

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| duty_id | uuid |  |  |  |
| title | varchar(200) |  |  |  |
| description | text |  |  |  |
| steps | jsonb |  |  |  |
| frequency | varchar(10) |  |  |  |
| weekday | smallint | yes |  |  |
| month_day | smallint | yes |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| role_id | bigint |  |  | **FK** → accounts_accessrole.id |

### crm_task

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| title | varchar(200) |  |  |  |
| description | text |  |  |  |
| status | varchar(15) |  |  |  |
| priority | varchar(10) |  |  |  |
| due_at | timestamptz | yes |  |  |
| reminded_at | timestamptz | yes |  |  |
| completed_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| assigned_to_id | bigint |  |  | **FK** → accounts_user.id |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| lead_id | bigint | yes |  | **FK** → crm_lead.id |
| category | varchar(60) |  |  |  |
| frequency | varchar(10) |  |  |  |
| group_id | bigint | yes |  | **FK** → workspace_group.id |
| assignee_estimate_minutes | integer | yes |  |  |
| completion_note | varchar(500) |  |  |  |
| deleted_at | timestamptz | yes |  |  |
| effort_minutes | integer | yes |  |  |
| repeat_until | date | yes |  |  |
| department | varchar(20) |  |  |  |
| actual_minutes | integer | yes |  |  |
| progress_percent | smallint | yes |  |  |
| parent_id | bigint | yes |  | **FK** → crm_task.id |
| external_ref | varchar(80) |  |  |  |
| external_url | varchar(300) |  |  |  |

### crm_task_subscribers

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| task_id | bigint |  |  | **FK** → crm_task.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### crm_taskactivity

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| text | varchar(300) |  |  |  |
| created_at | timestamptz |  |  |  |
| actor_id | bigint | yes |  | **FK** → accounts_user.id |
| task_id | bigint |  |  | **FK** → crm_task.id |
| kind | varchar(10) |  |  |  |

### crm_taskattachment

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| file | varchar(100) |  |  |  |
| filename | varchar(255) |  |  |  |
| created_at | timestamptz |  |  |  |
| task_id | bigint |  |  | **FK** → crm_task.id |
| uploaded_by_id | bigint | yes |  | **FK** → accounts_user.id |

### crm_taskcategory

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(60) |  |  |  |
| department | varchar(20) |  |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| pending | boolean |  |  |  |
| requested_by_id | bigint | yes |  | **FK** → accounts_user.id |

### crm_taskchangerequest

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| changes | jsonb |  |  |  |
| reason | text |  |  |  |
| status | varchar(10) |  |  |  |
| remarks | varchar(300) |  |  |  |
| reviewed_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| requested_by_id | bigint |  |  | **FK** → accounts_user.id |
| reviewed_by_id | bigint | yes |  | **FK** → accounts_user.id |
| task_id | bigint |  |  | **FK** → crm_task.id |
| escalated | boolean |  |  |  |
| admin_alerted_at | timestamptz | yes |  |  |
| reminded_at | timestamptz | yes |  |  |

### crm_taskchecklistitem

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| text | varchar(200) |  |  |  |
| done | boolean |  |  |  |
| order | integer |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| task_id | bigint |  |  | **FK** → crm_task.id |
| done_at | timestamptz | yes |  |  |
| done_by_id | bigint | yes |  | **FK** → accounts_user.id |
| note | varchar(300) |  |  |  |
| due_at | timestamptz | yes |  |  |

### crm_taskcompletion

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| note | text |  |  |  |
| status | varchar(10) |  |  |  |
| remarks | varchar(500) |  |  |  |
| reviewed_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| approver_id | bigint | yes |  | **FK** → accounts_user.id |
| reviewed_by_id | bigint | yes |  | **FK** → accounts_user.id |
| submitted_by_id | bigint |  |  | **FK** → accounts_user.id |
| task_id | bigint |  |  | **FK** → crm_task.id |
| escalated_at | timestamptz | yes |  |  |
| reminded_at | timestamptz | yes |  |  |

### crm_taskdaylog

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| date | date |  |  |  |
| did | text |  |  |  |
| plan_tomorrow | text |  |  |  |
| percent_done | smallint | yes |  |  |
| minutes_spent | integer | yes |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| author_id | bigint | yes |  | **FK** → accounts_user.id |
| task_id | bigint |  |  | **FK** → crm_task.id |

### crm_tasksettings

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| require_completion_remarks | boolean |  |  |  |
| require_completion_attachment | boolean |  |  |  |
| updated_at | timestamptz |  |  |  |
| updated_by_id | bigint | yes |  | **FK** → accounts_user.id |

### crm_tasktemplate

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(120) |  |  |  |
| category | varchar(60) |  |  |  |
| title | varchar(200) |  |  |  |
| description | text |  |  |  |
| priority | varchar(10) |  |  |  |
| frequency | varchar(10) |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |

### directory_directorytemplate

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| category | varchar(80) |  |  |  |
| name | varchar(160) |  |  |  |
| description | text |  |  |  |
| priority | varchar(10) |  |  |  |
| frequency | varchar(10) |  |  |  |
| tags | jsonb |  |  |  |
| steps | jsonb |  |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| industry_id | bigint |  |  | **FK** → directory_industry.id |

### directory_industry

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(80) |  |  |  |
| slug | varchar(80) |  |  |  |
| icon | varchar(8) |  |  |  |
| description | varchar(300) |  |  |  |
| order | integer |  |  |  |
| active | boolean |  |  |  |

### django_admin_log

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | integer |  |  | **PK** |
| action_time | timestamptz |  |  |  |
| object_id | text | yes |  |  |
| object_repr | varchar(200) |  |  |  |
| action_flag | smallint |  |  |  |
| change_message | text |  |  |  |
| content_type_id | integer | yes |  | **FK** → django_content_type.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### django_content_type

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | integer |  |  | **PK** |
| app_label | varchar(100) |  |  |  |
| model | varchar(100) |  |  |  |

### django_migrations

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| app | varchar(255) |  |  |  |
| name | varchar(255) |  |  |  |
| applied | timestamptz |  |  |  |

### django_session

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| session_key | varchar(40) |  |  | **PK** |
| session_data | text |  |  |  |
| expire_date | timestamptz |  |  |  |

### hr_attendance

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| date | date |  |  |  |
| check_in | timestamptz | yes |  |  |
| check_out | timestamptz | yes |  |  |
| check_in_lat | double precision | yes |  |  |
| check_in_lng | double precision | yes |  |  |
| check_out_lat | double precision | yes |  |  |
| check_out_lng | double precision | yes |  |  |
| status | varchar(10) |  |  |  |
| working_minutes | integer |  |  |  |
| is_late | boolean |  |  |  |
| is_early_checkout | boolean |  |  |  |
| face_verified | boolean |  |  |  |
| face_confidence | double precision | yes |  |  |
| note | varchar(300) |  |  |  |
| created_at | timestamptz |  |  |  |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| leave_request_id | bigint | yes |  | **FK** → hr_leaverequest.id |
| location_id | bigint | yes |  | **FK** → hr_officelocation.id |
| check_in_photo | varchar(100) |  |  |  |
| check_out_photo | varchar(100) |  |  |  |

### hr_attendancecorrection

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| date | date |  |  |  |
| requested_check_in | timestamptz | yes |  |  |
| requested_check_out | timestamptz | yes |  |  |
| reason | text |  |  |  |
| status | varchar(10) |  |  |  |
| remarks | varchar(300) |  |  |  |
| created_at | timestamptz |  |  |  |
| reviewed_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| escalated_at | timestamptz | yes |  |  |
| reminded_at | timestamptz | yes |  |  |

### hr_compoff

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| date | date |  |  |  |
| days | numeric |  |  |  |
| source | varchar(12) |  |  |  |
| note | varchar(300) |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### hr_faceprofile

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| descriptor | jsonb |  |  |  |
| enrolled_at | timestamptz |  |  |  |
| enrolled_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### hr_leaverequest

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| start_date | date |  |  |  |
| end_date | date |  |  |  |
| days | integer |  |  |  |
| reason | text |  |  |  |
| document | varchar(100) | yes |  |  |
| status | varchar(10) |  |  |  |
| remarks | varchar(300) |  |  |  |
| reviewed_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| reviewed_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| leave_type_id | bigint |  |  | **FK** → hr_leavetype.id |
| escalated_at | timestamptz | yes |  |  |
| reminded_at | timestamptz | yes |  |  |

### hr_leavetype

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(60) |  |  |  |
| annual_quota | integer |  |  |  |
| paid | boolean |  |  |  |
| requires_document | boolean |  |  |  |
| active | boolean |  |  |  |
| is_comp_off | boolean |  |  |  |

### hr_officelocation

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(120) |  |  |  |
| latitude | double precision |  |  |  |
| longitude | double precision |  |  |  |
| radius_m | integer |  |  |  |
| active | boolean |  |  |  |

### intake_inboundmessage

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| channel | varchar(10) |  |  |  |
| external_id | varchar(200) |  |  |  |
| sender | varchar(200) |  |  |  |
| sender_name | varchar(200) |  |  |  |
| subject | varchar(300) |  |  |  |
| body | text |  |  |  |
| media | jsonb |  |  |  |
| ai_result | jsonb |  |  |  |
| status | varchar(10) |  |  |  |
| error | text |  |  |  |
| created_at | timestamptz |  |  |  |
| processed_at | timestamptz | yes |  |  |
| lead_id | bigint | yes |  | **FK** → crm_lead.id |

### mistakes_mistake

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| department | varchar(20) |  |  |  |
| category | varchar(80) |  |  |  |
| severity | varchar(10) |  |  |  |
| classification | varchar(12) |  |  |  |
| description | text |  |  |  |
| impact | varchar(500) |  |  |  |
| financial_loss | numeric | yes |  |  |
| occurrence_level | smallint |  |  |  |
| explanation | text |  |  |  |
| root_cause | varchar(25) |  |  |  |
| root_cause_note | varchar(500) |  |  |  |
| corrective_action | text |  |  |  |
| preventive_action | text |  |  |  |
| sop_name | varchar(150) |  |  |  |
| sop_version | varchar(40) |  |  |  |
| sop_step | varchar(200) |  |  |  |
| sop_followed | boolean | yes |  |  |
| sop_adequate | boolean | yes |  |  |
| status | varchar(10) |  |  |  |
| manager_remarks | varchar(1000) |  |  |  |
| level3_action | varchar(25) |  |  |  |
| level3_action_note | varchar(500) |  |  |  |
| sla_due_at | timestamptz | yes |  |  |
| escalation_level | smallint |  |  |  |
| resolved_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| corrective_task_id | bigint | yes |  | **FK** → crm_task.id |
| employee_id | bigint |  |  | **FK** → accounts_user.id |
| lead_id | bigint | yes |  | **FK** → crm_lead.id |
| manager_id | bigint | yes |  | **FK** → accounts_user.id |
| repeat_of_id | bigint | yes |  | **FK** → mistakes_mistake.id |
| reported_by_id | bigint | yes |  | **FK** → accounts_user.id |
| task_id | bigint | yes |  | **FK** → crm_task.id |
| sop_id | bigint | yes |  | **FK** → mistakes_sop.id |

### mistakes_mistakecategory

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(80) |  |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |

### mistakes_mistakeevent

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| text | varchar(400) |  |  |  |
| created_at | timestamptz |  |  |  |
| actor_id | bigint | yes |  | **FK** → accounts_user.id |
| mistake_id | bigint |  |  | **FK** → mistakes_mistake.id |

### mistakes_mistakesettings

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| sla_low_hours | integer |  |  |  |
| sla_medium_hours | integer |  |  |  |
| sla_high_hours | integer |  |  |  |
| sla_critical_hours | integer |  |  |  |
| updated_at | timestamptz |  |  |  |
| updated_by_id | bigint | yes |  | **FK** → accounts_user.id |
| last_daily_digest | date | yes |  |  |
| last_weekly_digest | date | yes |  |  |

### mistakes_sop

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| title | varchar(150) |  |  |  |
| department | varchar(20) |  |  |  |
| category | varchar(60) |  |  |  |
| version | varchar(40) |  |  |  |
| steps | text |  |  |  |
| checks | text |  |  |  |
| common_errors | text |  |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| owner_id | bigint | yes |  | **FK** → accounts_user.id |

### notifications_notification

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| type | varchar(40) |  |  |  |
| title | varchar(200) |  |  |  |
| body | text |  |  |  |
| link | varchar(200) |  |  |  |
| channels | jsonb |  |  |  |
| read_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### notifications_whatsappdelivery

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| wamid | varchar(128) |  |  |  |
| phone | varchar(20) |  |  |  |
| template | varchar(80) |  |  |  |
| status | varchar(20) |  |  |  |
| detail | text |  |  |  |
| sent_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| user_id | bigint | yes |  | **FK** → accounts_user.id |

### payroll_advance

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| amount | numeric |  |  |  |
| given_on | date |  |  |  |
| reason | varchar(200) |  |  |  |
| recovered | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |
| recovered_in_id | bigint | yes |  | **FK** → payroll_payslip.id |
| recovered_amount | numeric |  |  |  |

### payroll_payrollrun

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| year | integer |  |  |  |
| month | smallint |  |  |  |
| status | varchar(10) |  |  |  |
| working_days | numeric |  |  |  |
| total_net | numeric |  |  |  |
| finalised_at | timestamptz | yes |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |

### payroll_payslip

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| monthly_gross | numeric |  |  |  |
| working_days | numeric |  |  |  |
| payable_days | numeric |  |  |  |
| lwp_days | numeric |  |  |  |
| earned_gross | numeric |  |  |  |
| pf | numeric |  |  |  |
| professional_tax | numeric |  |  |  |
| advance_deduction | numeric |  |  |  |
| other_deduction | numeric |  |  |  |
| net_payable | numeric |  |  |  |
| breakdown | jsonb |  |  |  |
| note | varchar(200) |  |  |  |
| run_id | bigint |  |  | **FK** → payroll_payrollrun.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### payroll_salarystructure

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| monthly_gross | numeric |  |  |  |
| basic | numeric | yes |  |  |
| pf_percent | numeric |  |  |  |
| professional_tax | numeric |  |  |  |
| other_deduction | numeric |  |  |  |
| effective_from | date |  |  |  |
| note | varchar(200) |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### tenancy_companysetting

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| key | varchar(100) |  |  |  |
| value | text |  |  |  |
| secret | boolean |  |  |  |
| updated_at | timestamptz |  |  |  |

### tenancy_outboxevent

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| type | varchar(60) |  |  |  |
| payload | jsonb |  |  |  |
| created_at | timestamptz |  |  |  |

### token_blacklist_blacklistedtoken

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| blacklisted_at | timestamptz |  |  |  |
| token_id | bigint |  |  | **FK** → token_blacklist_outstandingtoken.id |

### token_blacklist_outstandingtoken

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| token | text |  |  |  |
| created_at | timestamptz | yes |  |  |
| expires_at | timestamptz |  |  |  |
| user_id | bigint | yes |  | **FK** → accounts_user.id |
| jti | varchar(255) |  |  |  |

### workspace_group

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(120) |  |  |  |
| description | text |  |  |  |
| category | varchar(60) |  |  |  |
| active | boolean |  |  |  |
| created_at | timestamptz |  |  |  |
| owner_id | bigint | yes |  | **FK** → accounts_user.id |

### workspace_group_members

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| group_id | bigint |  |  | **FK** → workspace_group.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### workspace_link

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| title | varchar(200) |  |  |  |
| url | varchar(500) |  |  |  |
| description | varchar(300) |  |  |  |
| created_at | timestamptz |  |  |  |
| added_by_id | bigint | yes |  | **FK** → accounts_user.id |
| group_id | bigint | yes |  | **FK** → workspace_group.id |
| collection_id | bigint |  |  | **FK** → workspace_linkcollection.id |

### workspace_link_favorites

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| link_id | bigint |  |  | **FK** → workspace_link.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### workspace_linkcollection

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| name | varchar(120) |  |  |  |
| created_at | timestamptz |  |  |  |
| created_by_id | bigint | yes |  | **FK** → accounts_user.id |

### workspace_notice

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| title | varchar(200) |  |  |  |
| content | text |  |  |  |
| category | varchar(60) |  |  |  |
| priority | varchar(10) |  |  |  |
| status | varchar(10) |  |  |  |
| publish_at | timestamptz | yes |  |  |
| expire_at | timestamptz | yes |  |  |
| attachment | varchar(100) | yes |  |  |
| audience_type | varchar(12) |  |  |  |
| audience_value | jsonb |  |  |  |
| created_at | timestamptz |  |  |  |
| updated_at | timestamptz |  |  |  |
| author_id | bigint | yes |  | **FK** → accounts_user.id |

### workspace_noticeread

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  |  | **PK** |
| read_at | timestamptz |  |  |  |
| notice_id | bigint |  |  | **FK** → workspace_notice.id |
| user_id | bigint |  |  | **FK** → accounts_user.id |

### public.ff_companies

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| company_id | uuid |  |  | **PK** |
| schema_name | text |  |  |  |
| name | text |  |  |  |
| created_at | timestamptz |  | `now()` |  |


## Assets (NestJS) — one schema per company; shown: `co_demo`

33 tables.

### __ff_migrations

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| tag | text |  |  | **PK** |
| applied_at | timestamptz |  | `now()` |  |

### allocation_photos

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| asset_id | uuid |  |  | **FK** → assets.id |
| allocation_id | uuid | yes |  | **FK** → allocations.id |
| kind | text |  |  |  |
| file_name | text |  |  |  |
| mime_type | text |  |  |  |
| size_bytes | integer |  |  |  |
| uploaded_by | uuid | yes |  |  |
| uploaded_by_name | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| data | bytea | yes |  |  |

### allocations

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| asset_id | uuid |  |  | **FK** → assets.id |
| holder_type | text |  |  |  |
| employee_id | uuid | yes |  | **FK** → employees.id |
| department_id | uuid | yes |  | **FK** → departments.id |
| location_id | uuid | yes |  | **FK** → locations.id |
| company_id | uuid | yes |  | **FK** → companies.id |
| vendor_id | uuid | yes |  | **FK** → vendors.id |
| holder_name | text |  |  |  |
| quantity | integer |  | `1` |  |
| exclusive | boolean |  | `true` |  |
| status | text |  | `'ACTIVE'::text` |  |
| assigned_at | timestamptz |  | `now()` |  |
| assigned_by | uuid | yes |  |  |
| assigned_by_name | text | yes |  |  |
| expected_return_date | date | yes |  |  |
| notes | text | yes |  |  |
| ended_at | timestamptz | yes |  |  |
| ended_by | uuid | yes |  |  |
| ended_by_name | text | yes |  |  |
| return_condition | text | yes |  |  |
| end_notes | text | yes |  |  |

### asset_categories

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text |  |  |  |
| icon | text | yes |  |  |
| color | text | yes |  |  |
| description | text | yes |  |  |
| sort_order | integer |  | `0` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### asset_requests

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| number | text |  |  |  |
| employee_id | uuid |  |  | **FK** → employees.id |
| requested_by | uuid | yes |  |  |
| requested_by_name | text | yes |  |  |
| asset_type_id | uuid | yes |  | **FK** → asset_types.id |
| quantity | integer |  | `1` |  |
| priority | text |  | `'MEDIUM'::text` |  |
| needed_by | date | yes |  |  |
| reason | text |  |  |  |
| status | text |  | `'PENDING'::text` |  |
| decided_by_name | text | yes |  |  |
| decided_at | timestamptz | yes |  |  |
| decision_note | text | yes |  |  |
| fulfilled_asset_id | uuid | yes |  | **FK** → assets.id |
| fulfilled_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| item_name | text | yes |  |  |

### asset_types

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| category_id | uuid |  |  | **FK** → asset_categories.id |
| name | text |  |  |  |
| code | text |  |  |  |
| icon | text | yes |  |  |
| description | text | yes |  |  |
| tracking_mode | text |  | `'INDIVIDUAL'::text` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| consumable | boolean |  | `false` |  |

### assets

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| asset_tag | text |  |  |  |
| qr_code | text |  |  |  |
| name | text |  |  |  |
| category_id | uuid |  |  | **FK** → asset_categories.id |
| asset_type_id | uuid |  |  | **FK** → asset_types.id |
| tracking_mode | text |  | `'INDIVIDUAL'::text` |  |
| status | text |  |  |  |
| condition | text |  | `'GOOD'::text` |  |
| quantity | integer |  | `1` |  |
| available_quantity | integer |  | `1` |  |
| serial_number | text | yes |  |  |
| manufacturer | text | yes |  |  |
| model | text | yes |  |  |
| description | text | yes |  |  |
| ownership | text |  | `'OWNED'::text` |  |
| owner_company_id | uuid | yes |  | **FK** → companies.id |
| vendor_id | uuid | yes |  | **FK** → vendors.id |
| purchase_date | date | yes |  |  |
| purchase_cost | numeric | yes |  |  |
| currency | text |  | `'INR'::text` |  |
| invoice_number | text | yes |  |  |
| warranty_expiry | date | yes |  |  |
| location_id | uuid | yes |  | **FK** → locations.id |
| holder_type | text | yes |  |  |
| holder_id | uuid | yes |  |  |
| holder_name | text | yes |  |  |
| assigned_at | timestamptz | yes |  |  |
| attributes | jsonb |  | `'{}'::jsonb` |  |
| search_vector | tsvector | yes |  |  |
| version | integer |  | `1` |  |
| created_by | uuid | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### companies

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text | yes |  |  |
| legal_name | text | yes |  |  |
| address | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### departments

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text | yes |  |  |
| company_id | uuid | yes |  | **FK** → companies.id |
| parent_id | uuid | yes |  | **FK** → departments.id |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### employees

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| employee_code | text |  |  |  |
| first_name | text |  |  |  |
| last_name | text | yes |  |  |
| full_name | text |  |  |  |
| email | text | yes |  |  |
| phone | text | yes |  |  |
| designation | text | yes |  |  |
| company_id | uuid | yes |  | **FK** → companies.id |
| department_id | uuid | yes |  | **FK** → departments.id |
| location_id | uuid | yes |  | **FK** → locations.id |
| manager_id | uuid | yes |  | **FK** → employees.id |
| status | text |  | `'ACTIVE'::text` |  |
| join_date | date | yes |  |  |
| notice_date | date | yes |  |  |
| last_working_date | date | yes |  |  |
| exit_date | date | yes |  |  |
| notes | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| personal_email | text | yes |  |  |
| personal_phone | text | yes |  |  |
| assets_verified_at | timestamptz | yes |  |  |
| assets_verified_by_name | text | yes |  |  |

### exit_cases

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| case_number | text |  |  |  |
| employee_id | uuid |  |  | **FK** → employees.id |
| status | text |  | `'OPEN'::text` |  |
| notice_date | date | yes |  |  |
| last_working_date | date |  |  |  |
| reason | text | yes |  |  |
| initiated_by | uuid | yes |  |  |
| initiated_by_name | text | yes |  |  |
| completed_at | timestamptz | yes |  |  |
| completed_by_name | text | yes |  |  |
| overridden | boolean |  | `false` |  |
| override_reason | text | yes |  |  |
| cancelled_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### exit_items

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| exit_case_id | uuid |  |  | **FK** → exit_cases.id |
| asset_id | uuid | yes |  | **FK** → assets.id |
| allocation_id | uuid | yes |  | **FK** → allocations.id |
| asset_tag | text | yes |  |  |
| asset_name | text |  |  |  |
| asset_type_name | text | yes |  |  |
| category_name | text | yes |  |  |
| quantity | integer |  | `1` |  |
| status | text |  | `'PENDING'::text` |  |
| source | text |  | `'AUTO'::text` |  |
| notes | text | yes |  |  |
| resolved_at | timestamptz | yes |  |  |
| resolved_by_name | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |

### ff_events

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  | `nextval('co_demo.ff_events_id_seq'::regc` | **PK** |
| type | text |  |  |  |
| payload | jsonb |  |  |  |
| created_at | timestamptz |  | `now()` |  |

### field_definitions

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| category_id | uuid | yes |  | **FK** → asset_categories.id |
| asset_type_id | uuid | yes |  | **FK** → asset_types.id |
| key | text |  |  |  |
| label | text |  |  |  |
| type | text |  |  |  |
| required | boolean |  | `false` |  |
| is_unique | boolean |  | `false` |  |
| options | jsonb | yes |  |  |
| min | double precision | yes |  |  |
| max | double precision | yes |  |  |
| placeholder | text | yes |  |  |
| help_text | text | yes |  |  |
| sort_order | integer |  | `0` |  |
| show_in_table | boolean |  | `false` |  |
| filterable | boolean |  | `true` |  |
| archived_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### history_events

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  | `nextval('co_demo.history_events_id_seq':` | **PK** |
| occurred_at | timestamptz |  | `now()` |  |
| actor_id | uuid | yes |  |  |
| actor_name | text |  |  |  |
| entity_type | text |  |  |  |
| entity_id | uuid |  |  |  |
| entity_label | text | yes |  |  |
| action | text |  |  |  |
| summary | text |  |  |  |
| changes | jsonb | yes |  |  |
| asset_id | uuid | yes |  |  |
| employee_id | uuid | yes |  |  |
| metadata | jsonb | yes |  |  |

### locations

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text | yes |  |  |
| type | text |  | `'OFFICE'::text` |  |
| parent_id | uuid | yes |  | **FK** → locations.id |
| company_id | uuid | yes |  | **FK** → companies.id |
| address | text | yes |  |  |
| is_store | boolean |  | `false` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### maintenance_records

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| number | text |  |  |  |
| asset_id | uuid |  |  | **FK** → assets.id |
| type | text |  | `'REPAIR'::text` |  |
| title | text |  |  |  |
| description | text | yes |  |  |
| vendor_id | uuid | yes |  | **FK** → vendors.id |
| status | text |  | `'SCHEDULED'::text` |  |
| scheduled_date | date | yes |  |  |
| started_at | timestamptz | yes |  |  |
| completed_at | timestamptz | yes |  |  |
| cost | numeric | yes |  |  |
| resolution | text | yes |  |  |
| previous_status | text | yes |  |  |
| created_by | uuid | yes |  |  |
| created_by_name | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### notifications

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| user_id | uuid |  |  | **FK** → users.id |
| type | text |  |  |  |
| title | text |  |  |  |
| body | text | yes |  |  |
| link | text | yes |  |  |
| read_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |

### onboarding_cases

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| case_number | text |  |  |  |
| employee_id | uuid |  |  | **FK** → employees.id |
| status | text |  | `'DRAFT'::text` |  |
| join_date | date |  |  |  |
| notes | text | yes |  |  |
| created_by | uuid | yes |  |  |
| created_by_name | text | yes |  |  |
| submitted_at | timestamptz | yes |  |  |
| submitted_by_name | text | yes |  |  |
| completed_at | timestamptz | yes |  |  |
| completed_by_name | text | yes |  |  |
| cancelled_at | timestamptz | yes |  |  |
| cancel_reason | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| return_note | text | yes |  |  |
| approved_at | timestamptz | yes |  |  |
| approved_by_name | text | yes |  |  |

### onboarding_items

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| case_id | uuid |  |  | **FK** → onboarding_cases.id |
| asset_type_id | uuid | yes |  | **FK** → asset_types.id |
| item_name | text |  |  |  |
| quantity | integer |  | `1` |  |
| notes | text | yes |  |  |
| status | text |  | `'PLANNED'::text` |  |
| prepared_asset_id | uuid | yes |  | **FK** → assets.id |
| prepared_by_name | text | yes |  |  |
| allocation_id | uuid | yes |  | **FK** → allocations.id |
| issued_at | timestamptz | yes |  |  |
| issued_by_name | text | yes |  |  |
| skip_reason | text | yes |  |  |
| sort_order | integer |  | `0` |  |
| created_at | timestamptz |  | `now()` |  |

### onboarding_kits

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| items | jsonb |  |  |  |
| created_by_name | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### ownership_records

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| asset_id | uuid |  |  | **FK** → assets.id |
| ownership | text |  |  |  |
| owner_company_id | uuid | yes |  | **FK** → companies.id |
| owner_company_name | text | yes |  |  |
| vendor_id | uuid | yes |  | **FK** → vendors.id |
| vendor_name | text | yes |  |  |
| started_at | timestamptz |  | `now()` |  |
| ended_at | timestamptz | yes |  |  |
| recorded_by | uuid | yes |  |  |

### reconciliation_runs

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| source | text |  |  |  |
| file_name | text |  |  |  |
| row_count | integer |  |  |  |
| repaired_rows | integer |  | `0` |  |
| summary | jsonb |  |  |  |
| items | jsonb |  |  |  |
| created_by | uuid | yes |  |  |
| created_by_name | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |

### roles

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| description | text | yes |  |  |
| permissions | text[] |  | `'{}'::text[]` |  |
| is_system | boolean |  | `false` |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| archived | boolean |  | `false` |  |
| platform_role_id | uuid | yes |  |  |

### sequences

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| prefix | text |  |  | **PK** |
| last_value | integer |  | `0` |  |

### sessions

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | text |  |  | **PK** |
| user_id | uuid |  |  | **FK** → users.id |
| expires_at | timestamptz |  |  |  |
| last_seen_at | timestamptz |  | `now()` |  |
| ip | text | yes |  |  |
| user_agent | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| fixed_expiry | boolean |  | `false` |  |

### sync_state

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| key | text |  |  | **PK** |
| value | text |  |  |  |

### tickets

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| number | text |  |  |  |
| title | text |  |  |  |
| description | text | yes |  |  |
| asset_id | uuid | yes |  | **FK** → assets.id |
| reported_by | uuid | yes |  |  |
| reported_by_name | text | yes |  |  |
| reporter_employee_id | uuid | yes |  | **FK** → employees.id |
| assignee_id | uuid | yes |  | **FK** → users.id |
| type | text |  | `'ISSUE'::text` |  |
| priority | text |  | `'MEDIUM'::text` |  |
| status | text |  | `'OPEN'::text` |  |
| resolution | text | yes |  |  |
| resolved_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| linked_task | jsonb | yes |  |  |

### user_roles

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| user_id | uuid |  |  | **PK** **FK** → users.id |
| role_id | uuid |  |  | **PK** **FK** → roles.id |

### users

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| email | text | yes |  |  |
| name | text |  |  |  |
| password_hash | text |  |  |  |
| role_id | uuid |  |  | **FK** → roles.id |
| employee_id | uuid | yes |  | **FK** → employees.id |
| is_active | boolean |  | `true` |  |
| failed_logins | integer |  | `0` |  |
| locked_until | timestamptz | yes |  |  |
| last_login_at | timestamptz | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |
| username | text | yes |  |  |
| platform_person_id | uuid | yes |  |  |

### vendors

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` | **PK** |
| name | text |  |  |  |
| code | text | yes |  |  |
| contact_name | text | yes |  |  |
| email | text | yes |  |  |
| phone | text | yes |  |  |
| website | text | yes |  |  |
| address | text | yes |  |  |
| notes | text | yes |  |  |
| created_at | timestamptz |  | `now()` |  |
| updated_at | timestamptz |  | `now()` |  |

### public.ff_events

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| id | bigint |  | `nextval('ff_events_id_seq'::regclass)` | **PK** |
| type | text |  |  |  |
| payload | jsonb |  |  |  |
| created_at | timestamptz |  | `now()` |  |

### ff.companies

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| company_id | uuid |  |  | **PK** |
| schema_name | text |  |  |  |
| name | text |  |  |  |
| created_at | timestamptz |  | `now()` |  |

