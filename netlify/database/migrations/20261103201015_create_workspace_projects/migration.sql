CREATE TABLE "workspace_projects" (
	"id" text PRIMARY KEY,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"files" jsonb DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
