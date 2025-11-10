-- Enable realtime publications for required tables
alter publication supabase_realtime add table if not exists public.queues;
alter publication supabase_realtime add table if not exists public.queue_history;
alter publication supabase_realtime add table if not exists public.notifications;
alter publication supabase_realtime add table if not exists public.pins;

-- Add cron job for daily maintenance (example)
select cron.schedule(
  'daily-maintenance',
  '0 5 * * *',
  $$ select 1 $$
);