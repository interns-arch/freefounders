-- PLAN.md §19.23 (founder, 2026-10-13): Idea board and Web forms were removed from Tasks; their grants go too.
DELETE FROM "platform"."role_grants" WHERE "app" = 'tasks' AND "permission" IN ('forms.view', 'forms.build', 'forms.all', 'ideas.view', 'ideas.review');
