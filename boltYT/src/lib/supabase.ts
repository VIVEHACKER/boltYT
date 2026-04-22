import { createLocalClient } from "./local-db";

export const DEMO_MODE = true;

export const supabase = createLocalClient();
