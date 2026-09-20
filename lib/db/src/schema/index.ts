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

import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

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

export const photoStylesTable = pgTable(
  "photo_styles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    prompt: text("prompt").notNull().default(""),
    folderName: text("folder_name").notNull(),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nameKeyUnique: uniqueIndex("photo_styles_name_key_idx").on(table.nameKey),
  }),
);

export type PhotoStyle = typeof photoStylesTable.$inferSelect;
export type InsertPhotoStyle = typeof photoStylesTable.$inferInsert;

export const characterUrls = pgTable(
  "character_urls",
  {
    id: serial("id").primaryKey(),
    characterId: text("character_id").notNull(),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    characterSortIdx: index("character_urls_character_sort_idx").on(
      table.characterId,
      table.sortOrder,
      table.id,
    ),
  }),
);

export const characterUrlRotation = pgTable("character_url_rotation", {
  characterId: text("character_id").primaryKey(),
  currentIndex: integer("current_index").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
