// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

import { jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type KallaatamStoryCharacter = {
  name: string;
  description: string;
};

export const kallaatamStoriesTable = pgTable(
  "kallaatam_stories",
  {
    id: serial("id").primaryKey(),
    personaId: text("persona_id").notNull(),
    storyHash: text("story_hash").notNull(),
    story: text("story").notNull(),
    outline: text("outline").notNull().default(""),
    characters: jsonb("characters").$type<KallaatamStoryCharacter[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    personaStoryHash: uniqueIndex("kallaatam_stories_persona_story_hash_idx").on(
      table.personaId,
      table.storyHash,
    ),
  }),
);

export type KallaatamStory = typeof kallaatamStoriesTable.$inferSelect;
export type InsertKallaatamStory = typeof kallaatamStoriesTable.$inferInsert;