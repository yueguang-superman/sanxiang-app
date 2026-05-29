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
  const palmNames = featureNames(palm) || "掌纹未成局";
  const faceNames = featureNames(face) || "面相未成局";
  return [
    `四柱显示：${bazi.summary}`,
    `手相取象：本次见 ${palmNames}。掌中之纹重在清浊、深浅、断续，宜与八宫落点同参。`,
    `面相取象：本次见 ${faceNames}。面部以三停为纲、五官为用，痣疤纹气色为应事之端。`,
    `合参建议：先看五行偏枯，再看掌面特殊点是否互相呼应；若同一主题在八字、掌纹、面相重复出现，才可作为重点提示。`,
    `谨记：此为传统文化娱乐与自我观察参考，不替代医学、法律、投资或人生重大决策。`,
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
