-- 002_chat_thread_unique.sql — one chat thread per user + handle.
--
-- The chat route creates a thread on the first saved message. Two simultaneous
-- first messages could race into two threads; this index makes that impossible
-- across processes. A database that already holds duplicates is repaired first:
-- the oldest thread for each (user_id, handle) is kept, its messages untouched,
-- and later duplicates are removed with their messages before the index is
-- created. Safe to re-run because every step is idempotent and the index uses
-- IF NOT EXISTS.

-- Delete the messages attached to duplicate threads.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, handle
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS rn
  FROM chat_threads
)
DELETE FROM chat_messages
WHERE thread_id IN (SELECT id FROM ranked WHERE rn > 1);

-- Then the duplicate threads themselves.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, handle
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS rn
  FROM chat_threads
)
DELETE FROM chat_threads
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_user_handle_key
  ON chat_threads (user_id, handle);
