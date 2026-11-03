import { pgTable, text, bigint, jsonb } from 'drizzle-orm/pg-core'
import type { CodeFile } from '../src/types/index.js'

export const workspaceProjects = pgTable('workspace_projects', {
  id: text().primaryKey(),
  owner: text().notNull(),
  name: text().notNull(),
  files: jsonb().$type<CodeFile[]>().notNull().default([]),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
})
