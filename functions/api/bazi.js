import { requireAccess } from "../_shared/auth.js";
import { calculateBazi } from "../_shared/bazi.js";
import { json, readJson } from "../_shared/http.js";

export const onRequestPost = async ({ request, env }) => {
  const body = await readJson(request);
  const access = await requireAccess(request, env, body);
  if (access.error) return access.error;

  try {
    return json({ bazi: calculateBazi(body.birth || body), remaining: access.remaining });
  } catch (error) {
    return json({ error: error.message }, 400);
  }
};
