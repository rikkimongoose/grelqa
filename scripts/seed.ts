import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { openDatabase, type Database } from "../src/db/connection";
import * as s from "../src/db/schema";
import { demoContests } from "./demo-contests";
import { longDemoStory } from "./demo-stories";

export async function seed(db: Database) {
  const createdAt = new Date("2026-10-01T12:00:00Z");
  await db.transaction(async (tx) => {
    for (let n = 1; n <= 3; n++) {
      // Случайный неизвестный пароль: seed не создаёт пригодных для входа аккаунтов.
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(randomBytes(32), salt, 64).toString("hex");
      await tx.insert(s.users).values({
        id: `demo-user-${n}`, email: `writer-${n}@grelqa.example`,
        passwordHash: `scrypt:${salt}:${hash}`, emailVerifiedAt: createdAt, createdAt,
      }).onConflictDoNothing({ target: s.users.id });
    }
    for (const [index, demo] of demoContests.entries()) {
      const contestId = `demo-contest-${demo.slug}`;
      const date = (stage: string) => demo.schedule.find((item) => item.stage === stage)?.date;
      const start = date("submissions")!;
      await tx.insert(s.contests).values({
        id: contestId, slug: demo.slug, organizerId: "demo-user-1",
        title: demo.title, description: demo.description, stage: demo.stage,
        preparationAt: date("preparation") ? new Date(date("preparation")!) : null,
        submissionsStartAt: new Date(start), startDayMoscow: start.slice(0, 10),
        submissionsEndAt: new Date(date("moderation")!),
        roundOneStartAt: new Date(date("round-one")!),
        roundTwoStartAt: date("round-two") ? new Date(date("round-two")!) : null,
        endsAt: new Date(date("completed")!),
        groupCapacity: 20, finalCapacity: 12,
        minLength: index === 1 ? 5000 : 3000,
        maxLength: [15000, 20000, 12000][index],
        isDemo: true, createdAt,
      }).onConflictDoNothing({ target: s.contests.id });
      await tx.insert(s.contestThemes).values({
        contestId,
        theme: demo.theme ?? "СЕКРЕТНАЯ ДЕМОТЕМА: снег в кармане",
        conditions: demo.theme ? demo.conditions : ["СЕКРЕТНОЕ ДЕМОУСЛОВИЕ: история начинается со снежинки."],
        enteredAt: createdAt,
        publishedAt: demo.theme ? new Date(start) : null,
      }).onConflictDoNothing({ target: s.contestThemes.contestId });
    }
    const contestId = "demo-contest-city-between-lines";
    const groupId = "demo-city-group-1";
    const publishedAt = new Date("2026-10-25T12:00:00Z");
    await tx.insert(s.contestGroups).values({
      id: groupId, contestId, round: 1, number: 1, capacity: 20, publishedAt,
    }).onConflictDoNothing({ target: s.contestGroups.id });
    const titles = ["Переулок забытых часов", "Окно на восьмом этаже", "Последний трамвай"];
    for (let n = 1; n <= 3; n++) {
      const participationId = `demo-city-participant-${n}`;
      const storyId = `demo-city-story-${n}`;
      await tx.insert(s.participations).values({
        id: participationId, userId: `demo-user-${n}`, contestId,
        assignedGroupId: groupId, mustVoteRoundOne: true, createdAt,
      }).onConflictDoNothing({ target: s.participations.id });
      await tx.insert(s.stories).values({
        id: storyId, contestId, participationId, title: titles[n - 1],
        content: n === 1 ? longDemoStory : [
          { type: "paragraph", children: [{ text: "На карте этого переулка не было. ", italic: true }, { text: "Но каждый вечер там зажигался свет." }] },
          { type: "paragraph", children: [{ text: "— Значит, кто-то всё ещё ждёт, — подумала путница.", bold: true }] },
        ],
        // Это демонстрационные тексты, не допущенные реальной модерацией.
        // Конкурсная длина не вычисляется до согласования алгоритма.
        status: "admitted", createdAt, updatedAt: createdAt, publishedAt,
      }).onConflictDoNothing({ target: s.stories.id });
      await tx.insert(s.storyRounds).values({ storyId, contestId, round: 1, groupId })
        .onConflictDoNothing({ target: [s.storyRounds.storyId, s.storyRounds.round] });
    }
    for (let n = 1; n <= 3; n++) {
      const ballotId = `demo-city-ballot-${n}`;
      await tx.insert(s.ballots).values({
        id: ballotId, participationId: `demo-city-participant-${n}`,
        contestId, round: 1, groupId, createdAt: publishedAt, updatedAt: publishedAt,
        submittedAt: publishedAt,
      }).onConflictDoNothing({ target: s.ballots.id });
      const others = [1, 2, 3].filter((author) => author !== n);
      for (const [position, author] of others.entries()) {
        await tx.insert(s.ballotEntries).values({
          ballotId, storyId: `demo-city-story-${author}`, contestId, round: 1, groupId,
          position: position + 1,
        }).onConflictDoNothing({ target: [s.ballotEntries.ballotId, s.ballotEntries.storyId] });
      }
    }
  });
}

async function main() {
  const { db, client } = await openDatabase();
  try {
    await seed(db);
    console.log("Демонстрационные записи добавлены; существующие записи сохранены.");
  } finally { client.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
