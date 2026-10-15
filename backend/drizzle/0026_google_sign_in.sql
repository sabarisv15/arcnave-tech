-- ADR-0056: an account made with Google sign-in has no password.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;