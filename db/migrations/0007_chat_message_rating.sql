-- 0007_chat_message_rating.sql — thumbs up / down on Beleth's chat answers.
--
-- The chat UI lets a user rate an assistant message (like / dislike, toggleable)
-- and the signal is worth keeping: it is transparency data, same as everything
-- else this project persists. Only assistant rows are ever rated in the UI, but
-- the column is not constrained to a role — a CHECK on `rating` is enough.
--
-- No new policy: the "own chat messages" policy from 0006 is `for all`, so the
-- owner can already UPDATE their own message rows; this UPDATE touches one
-- nullable column and never changes `session_id`, so the WITH CHECK still holds.
--
-- Idempotent: safe to re-run.

alter table public.chat_messages
    add column if not exists rating text
        check (rating in ('up', 'down'));
