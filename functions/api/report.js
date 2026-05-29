import { requireAccess } from "../_shared/auth.js";
import { calculateBazi } from "../_shared/bazi.js";
import { json, readJson } from "../_shared/http.js";

const scoreFrom = (bazi, palm, face) => {
  const featureCount = (palm?.features?.length || 0) + (face?.features?.length || 0);
  const elementValues = Object.values(bazi.elements);
  const spread = Math.max(...elementValues) - Math.min(...elementValues);
  return Math.max(42, Math.min(96, 68 + Math.min(16, featureCount) - spread * 3));
};

const featureNames = (result) => (result?.features || []).slice(0, 6).map((item) => item.name).join("、");

const buildReading = (bazi, palm, face) => {
  const palmNames = featureNames(palm) || "没有识别到清楚掌纹";
  const faceNames = featureNames(face) || "没有识别到清楚面部特征";
  return [
    `生日信息显示：${bazi.summary}`,
    `手掌照片里，本次主要看到：${palmNames}。重点先看生命线、智慧线、感情线、事业线、婚姻线这些大家能看懂的线，再看细纹和掌色。`,
    `面部照片里，本次主要看到：${faceNames}。重点看印堂、眉眼、鼻子、人中、嘴唇、耳朵、下巴，以及痣疤和明显气色。`,
    `综合看法：同一个提醒如果在生日信息、手掌、面部里反复出现，才算重点；只出现一次的内容，当作娱乐参考即可。`,
    `提醒：这是传统文化娱乐和自我观察工具，不能替代医学、法律、投资或人生重大决定。`,
  ];
};

export const onRequestPost = async ({ request, env }) => {
  const body = await readJson(request);
  const access = await requireAccess(request, env, body);
  if (access.error) return access.error;

  try {
    const bazi = calculateBazi(body.birth || {});
    const palm = body.palm || { features: [] };
    const face = body.face || { features: [] };
    return json({
      subject: body.birth?.personName || "求测者",
      bazi,
      palm,
      face,
      score: scoreFrom(bazi, palm, face),
      reading: buildReading(bazi, palm, face),
      remaining: access.remaining,
    });
  } catch (error) {
    return json({ error: error.message }, 400);
  }
};
