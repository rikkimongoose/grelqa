import "server-only";
import { sql } from "drizzle-orm";
import { contests, stories, contestFinalizations } from "./schema";

// Disclosure comes only from the atomic, successful final publication snapshot.
// Email and authentication fields are never queried; withdrawn works have no entry.
export function publicAuthorName() {
  return sql<string | null>`(select json_extract(author.value, '$.name')
    from ${contestFinalizations}, json_each(${contestFinalizations.snapshot}, '$.authors') author
    where ${contestFinalizations.contestId} = ${contests.id}
      and ${contests.stage} = 'completed'
      and json_extract(${contestFinalizations.snapshot}, '$.tally.outcome') = 'results'
      and json_extract(author.value, '$.storyId') = ${stories.id} limit 1)`;
}
