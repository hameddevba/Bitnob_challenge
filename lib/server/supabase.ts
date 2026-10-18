import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key",
  { auth: { persistSession: false } }
);

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

