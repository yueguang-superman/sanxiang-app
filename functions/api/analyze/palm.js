import { requireAccess } from "../../_shared/auth.js";
import { analyzeImage } from "../../_shared/ai.js";
import { json, readJson } from "../../_shared/http.js";

export const onRequestPost = async ({ request, env }) => {
  const body = await readJson(request);
  const access = await requireAccess(request, env, body, { consume: true });
  if (access.error) return access.error;

  try {
    const result = await analyzeImage({
      kind: "palm",
      imageDataUrl: body.imageDataUrl,
      imageMeta: body.imageMeta,
      birth: body.birth,
      userCorrection: body.userCorrection,
      env,
    });
    return json({ ...result, remaining: access.remaining });
  } catch (error) {
    return json({ error: error.message, remaining: access.remaining }, 502);
  }
};
