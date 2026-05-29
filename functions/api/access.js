import { requireAccess } from "../_shared/auth.js";
import { json, readJson } from "../_shared/http.js";

export const onRequestPost = async ({ request, env }) => {
  const body = await readJson(request);
  const access = await requireAccess(request, env, body);
  if (access.error) return access.error;
  return json({ ok: true, remaining: access.remaining, limit: access.limit });
};
