CREATE TABLE "openreader_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"client_id" text NOT NULL,
	"access_token" text NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"refresh_token" text NOT NULL,
	"scope" text NOT NULL,
	"host_voices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "openreader_connections" ADD CONSTRAINT "openreader_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;