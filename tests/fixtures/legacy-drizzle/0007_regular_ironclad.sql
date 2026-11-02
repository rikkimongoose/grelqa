ALTER TABLE `participations` ADD `round_two_rights_ended_at` integer;--> statement-breakpoint
-- Apply the newly agreed rule to already prepared finals, without rewriting admission/history or ballots.
UPDATE participations AS p
SET must_vote_round_two = 0,
    round_two_rights_ended_at = COALESCE((
      SELECT MAX(COALESCE(sr.withdrawn_at, s.withdrawn_at))
      FROM final_rounds f JOIN story_rounds sr ON sr.contest_id = f.contest_id AND sr.group_id = f.group_id AND sr.round = 2
      JOIN stories s ON s.id = sr.story_id
      WHERE f.contest_id = p.contest_id AND s.participation_id = p.id
        AND sr.story_id IN (SELECT value FROM json_each(f.snapshot, '$.storyIds'))
    ), CAST(strftime('%s', 'now') AS integer) * 1000),
    round_two_exempt_at = NULL,
    round_two_exempt_reason = NULL
WHERE p.round_two_rights_ended_at IS NULL
  AND EXISTS (
    SELECT 1 FROM final_rounds f, json_each(f.snapshot, '$.members') member
    WHERE f.contest_id = p.contest_id
      AND json_extract(member.value, '$.participationId') = p.id
      AND json_extract(member.value, '$.userId') = p.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM final_rounds f JOIN story_rounds sr ON sr.contest_id = f.contest_id AND sr.group_id = f.group_id AND sr.round = 2
    JOIN stories s ON s.id = sr.story_id
    WHERE f.contest_id = p.contest_id AND s.participation_id = p.id
      AND sr.story_id IN (SELECT value FROM json_each(f.snapshot, '$.storyIds'))
      AND sr.status = 'active' AND s.withdrawn_at IS NULL AND s.status != 'withdrawn'
  );
