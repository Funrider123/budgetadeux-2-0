-- La fonction money-date-reminder lit onboarding_candidates et écrit onboarding_reminders
-- avec la clé service_role. Sans ces droits, elle échoue sur "permission denied for view"
-- et aucune relance ne part : l'erreur est bien remontée dans la réponse, mais personne ne
-- la lit un matin à 7 h. On n'ouvre qu'au service_role : anon et authenticated ne doivent
-- jamais voir cette vue, elle expose les emails des utilisateurs qui n'ont rien configuré.
grant select on public.onboarding_candidates to service_role;
grant select, insert, update on public.onboarding_reminders to service_role;
