import { byId, catalogFor } from "./catalog.js";

const stripFence = (text) =>
  String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

const parseJson = (text) => {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 返回不是 JSON。");
    return JSON.parse(match[0]);
  }
};

const explainAiError = (status, text, model) => {
  const raw = String(text || "");
  if (status === 400 && /InvalidParameter|messages|image|video|vision/i.test(raw)) {
    return `AI 看图失败：当前看图模型 ${model} 不接受这张图片。请确认 Cloudflare 里的 AI_VISION_MODEL 填的是支持图片/视频理解的模型，例如 qwen3.6-plus。`;
  }
  if (status === 401 || status === 403) {
    return "AI 看图失败：API Key 不对、没权限，或者百炼账号没有开通这个模型。";
  }
  if (status === 429) {
    return "AI 看图失败：调用太频繁或额度用完了，稍后再试，或者检查百炼额度。";
  }
  return `AI 看图失败：接口返回 ${status}。请检查百炼 API Key、额度和模型名称。`;
};

const fallbackBox = (index) => ({
  x: 12 + (index % 3) * 24,
  y: 16 + Math.floor(index / 3) * 18,
  width: 18,
  height: 12,
});

const compactName = (name) => String(name || "").replace(/[（）()]/g, "").replace(/\s/g, "");

const matchCatalogItem = (catalog, catalogMap, feature, index) => {
  const byId = catalogMap.get(feature.featureId);
  if (byId) return byId;

  const featureName = compactName(feature.name);
  const byName = catalog.find((item) => {
    const itemName = compactName(item.name);
    const itemBase = compactName(item.name.split("（")[0]);
    return featureName && (featureName.includes(itemBase) || itemName.includes(featureName));
  });
  return byName || null;
};

const normalizeBox = (box) => {
  if (!box) return null;
  const rawX = Number(box.x ?? box.left);
  const rawY = Number(box.y ?? box.top);
  const rawWidth = Number(box.width ?? box.w);
  const rawHeight = Number(box.height ?? box.h);
  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.min(98, rawX));
  const y = Math.max(0, Math.min(98, rawY));
  return {
    x,
    y,
    width: Math.max(2, Math.min(100 - x, rawWidth)),
    height: Math.max(2, Math.min(100 - y, rawHeight)),
  };
};

const normalizePoints = (points) => {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      x: Math.max(0, Math.min(100, Number(point?.x ?? point?.[0] ?? 0))),
      y: Math.max(0, Math.min(100, Number(point?.y ?? point?.[1] ?? 0))),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 16);
};

const normalizeSegments = (segments, points) => {
  const rawSegments = Array.isArray(segments) && segments.length ? segments : [points || []];
  return rawSegments
    .map(normalizePoints)
    .filter((segment) => segment.length >= 2)
    .slice(0, 6);
};

const palmMainLineIds = new Set(["life_line", "head_line", "heart_line", "fate_line", "marriage_line"]);
const palmPriority = ["life_line", "head_line", "heart_line", "fate_line", "marriage_line", "palm_shape", "five_fingers"];
const featurePriority = new Map([...palmPriority, ...["yintang", "brows", "eyes", "nose_root", "nose_tip", "philtrum", "mouth", "law_lines", "ears", "chin", "forehead", "moles_scars_qi"]].map((id, index) => [id, index]));

const fallbackSubjectBox = (kind) => (kind === "palm" ? { x: 4, y: 20, width: 92, height: 78 } : { x: 10, y: 4, width: 80, height: 92 });

const subjectBoxFrom = (kind, parsed = {}) =>
  normalizeBox(parsed.subjectBox || parsed.palmBox || parsed.handBox || parsed.faceBox || parsed.regionBox || parsed.region);

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const pointInBox = (point, box, padding = 0) =>
  point.x >= box.x - padding &&
  point.x <= box.x + box.width + padding &&
  point.y >= box.y - padding &&
  point.y <= box.y + box.height + padding;

const boxCenter = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const boxInsideRegion = (box, region, padding = 2) => pointInBox(boxCenter(box), region, padding);

const pointsBounds = (points) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(2, Math.max(...xs) - x),
    height: Math.max(2, Math.max(...ys) - y),
  };
};

const segmentsBounds = (segments) => pointsBounds(segments.flat());

const traceScore = (points) => {
  if (points.length < 2) return { length: 0, maxSegment: 0 };
  const distances = points.slice(1).map((point, index) => pointDistance(points[index], point));
  return {
    length: distances.reduce((sum, value) => sum + value, 0),
    maxSegment: Math.max(...distances),
  };
};

const allSegmentsInside = (segments, region) => segments.every((segment) => segment.every((point) => pointInBox(point, region, 2)));

const validPalmLine = (featureId, segments) => {
  const points = segments.flat();
  const bounds = pointsBounds(points);
  if (!bounds) return false;

  const requiredPoints = {
    life_line: 5,
    head_line: 5,
    heart_line: 5,
    fate_line: 3,
    marriage_line: 2,
  }[featureId] || 4;
  const maxSegment = {
    life_line: 18,
    head_line: 18,
    heart_line: 18,
    fate_line: 22,
    marriage_line: 12,
  }[featureId] || 18;
  const score = traceScore(points);
  if (points.length < requiredPoints || score.length < 4 || score.maxSegment > maxSegment) return false;

  const center = boxCenter(bounds);
  if (featureId === "life_line") return bounds.height >= 25 && bounds.width >= 5 && bounds.width <= 48 && center.y >= 50;
  if (featureId === "head_line") return bounds.width >= 20 && bounds.height <= 36 && center.y >= 36 && center.y <= 72;
  if (featureId === "heart_line") return bounds.width >= 20 && bounds.height <= 32 && center.y >= 18 && center.y <= 55;
  if (featureId === "fate_line") return bounds.height >= 16 && bounds.width <= 36 && center.x >= 28 && center.x <= 72;
  if (featureId === "marriage_line") return bounds.width >= 4 && bounds.width <= 24 && bounds.height <= 10 && center.y >= 15 && center.y <= 55 && (center.x <= 42 || center.x >= 58);
  return true;
};

const faceBoxLimits = {
  forehead: { width: 70, height: 22 },
  yintang: { width: 18, height: 14 },
  brows: { width: 62, height: 14 },
  eyes: { width: 62, height: 18 },
  nose_root: { width: 18, height: 20 },
  nose_tip: { width: 28, height: 24 },
  philtrum: { width: 18, height: 18 },
  mouth: { width: 38, height: 16 },
  law_lines: { width: 46, height: 28 },
  ears: { width: 28, height: 38 },
  chin: { width: 42, height: 20 },
  moles_scars_qi: { width: 24, height: 20 },
};

const validFeatureGeometry = ({ kind, featureId, box, segments, subjectBox }) => {
  if (!box && !segments.length) return false;

  if (kind === "palm") {
    if (segments.length && !allSegmentsInside(segments, subjectBox)) return false;
    if (box && !boxInsideRegion(box, subjectBox)) return false;
    if (palmMainLineIds.has(featureId)) return validPalmLine(featureId, segments);
    if (!box) return false;
    return box.width <= subjectBox.width * 0.72 && box.height <= subjectBox.height * 0.72;
  }

  if (!box || !boxInsideRegion(box, subjectBox)) return false;
  const limit = faceBoxLimits[featureId] || { width: 46, height: 32 };
  if (box.width > Math.min(limit.width, subjectBox.width * 0.82)) return false;
  if (box.height > Math.min(limit.height, subjectBox.height * 0.45)) return false;
  return true;
};

export const analyzeImage = async ({ kind, imageDataUrl, imageMeta, userCorrection = "", env }) => {
  if (!env.AI_API_KEY) {
    throw new Error("尚未配置通义千问 API Key。请在 Cloudflare 环境变量中设置 AI_API_KEY。");
  }

  if (!String(imageDataUrl || "").startsWith("data:image/")) {
    throw new Error("图片格式无效。");
  }

  const catalog = catalogFor(kind);
  const names = catalog.map((item) => `${item.id}:${item.name}`).join("；");
  const correctionGuide = userCorrection
    ? `用户反馈说：${userCorrection}。请优先根据这句反馈重新检查，不是让用户标注，而是你自己修正识别。`
    : "";
  const palmGuide =
    "这是手掌识别。第一步必须先框出整只手掌和手指的 subjectBox，后面所有掌纹点和候选框都必须在 subjectBox 里面；键盘、桌面、背景、手掌外面的东西一律不要标。第二步才看掌纹。生命线、智慧线、感情线大多是弧线，不是两点直线；清楚可画时每条主线必须给 6-10 个沿真实纹路走向的点，让曲线贴着掌纹转弯。生命线：从拇指和食指之间附近起，沿拇指根部大鱼际外缘向手腕方向弧形下行，绝不能画成穿过掌心的直线。智慧线：从虎口附近或生命线起点附近出发，横穿掌心中部，常向小指侧或月丘方向略下斜，也要沿纹路弯折。感情线：在手指根部下方，从小指侧横向走向食指/中指方向，位置在掌心上部，通常略弯，不要压到掌心中部。事业线：从掌底或掌心下方往中指方向上行，通常偏竖，常淡或断续，不清楚就只给候选框。婚姻线：在小指下方掌边，是短横线，可以 2-4 个点，不应画成横穿掌心的长线。断续线请用 segments 多段返回，不要把断开的地方硬连起来；每段点必须贴着能看到的纹路。若生命线、智慧线、感情线只能给 2-4 个点，说明不够确定，请返回 box 候选区并 needsReview=true，不要硬画。可选特征按优先级：生命线、智慧线、感情线、事业线、婚姻线，然后才是成功线、财运纹、断掌、痣、岛纹、掌色、八宫。name 必须用普通名称。";
  const faceGuide =
    "这是面部识别。第一步必须先框出脸部主体 subjectBox，范围以额头到下巴、左右脸颊为主，不要把大面积头发、背景、衣服算进去。第二步才标五官。优先标注普通人能看懂的位置：印堂、额头、眉眼、山根、鼻头鼻翼、人中、嘴唇、法令纹、耳朵、下巴、痣疤和明显气色。面部只返回 box，不要返回 points，不要画横跨脸部的线。box 要贴近真实部位，例如印堂只框两眉之间，山根只框鼻梁上方，耳朵只框耳朵，不要大范围乱框；不确定就 needsReview=true 或不要返回。name 必须用普通名称。";
  const prompt =
    `你是图像识别助手，任务是给传统文化测算软件做可视化标注，语言要让普通用户看懂。${correctionGuide}${kind === "palm" ? palmGuide : faceGuide}` +
    `必须只返回 JSON，不要解释。subjectBox 必填；如果不能先确定主体区域，就返回 {"features":[],"imageQuality":"partial","notes":["主体区域不清楚"]}。可选特征库：${names}。` +
    `返回格式：{"subjectBox":{"x":12,"y":18,"width":76,"height":78},"features":[{"featureId":"life_line","name":"生命线","category":"主要掌纹","segments":[[{"x":30,"y":38},{"x":25,"y":45},{"x":22,"y":55},{"x":21,"y":66},{"x":24,"y":77},{"x":30,"y":88}]],"box":{"x":18,"y":36,"width":24,"height":54},"confidence":0.82,"evidence":"拇指根部外侧弧线清楚","plainSummary":"简单说，看精力、稳定度和恢复力，不是看寿命。","advice":"近期注意规律作息，重要决定别硬撑。","needsReview":false}],"imageQuality":"clear|blurry|partial","notes":["..."]}。` +
    `box、points、segments 坐标都用百分比 0-100。只标有视觉依据的内容；看不清时不要硬编，不要画跨过无掌纹的直线，confidence 低于 0.55 且 needsReview=true。`;

  const baseUrl = env.AI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = env.AI_VISION_MODEL || "qwen3.6-plus";
  const endpoint = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const requestBody = {
    model,
    temperature: 0.15,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  if (env.AI_JSON_MODE === "on") {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(explainAiError(response.status, text, model));
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJson(content);
  const catalogMap = byId(kind);
  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const subjectBox = subjectBoxFrom(kind, parsed);
  if (!subjectBox) {
    return {
      kind,
      imageMeta,
      subjectBox: fallbackSubjectBox(kind),
      imageQuality: parsed.imageQuality || "unknown",
      notes: [
        ...(Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : []),
        kind === "palm" ? "AI 没有先锁定手掌区域，已停止标注，避免乱画到背景上。" : "AI 没有先锁定脸部区域，已停止标注，避免乱框到背景上。",
      ],
      features: [],
    };
  }
  const rejected = [];
  const normalizedFeatures = features
    .slice(0, 18)
    .map((feature, index) => {
      const known = matchCatalogItem(catalog, catalogMap, feature, index);
      if (!known) {
        rejected.push(feature.name || feature.featureId || "未知标注");
        return null;
      }
      const confidence = Number(feature.confidence ?? 0.5);
      const segments = kind === "face" ? [] : normalizeSegments(feature.segments, feature.points);
      const pointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
      const minLinePoints = {
        life_line: 5,
        head_line: 5,
        heart_line: 5,
        fate_line: 3,
        marriage_line: 2,
      }[known.id] || 4;
      const needsLineReview = kind === "palm" && palmMainLineIds.has(known.id) && pointCount < minLinePoints;
      const faceLowConfidence = kind === "face" && confidence < 0.72;
      const box = normalizeBox(feature.box) || segmentsBounds(segments) || fallbackBox(index);
      const cleanSegments = needsLineReview ? [] : segments;
      const geometryOk = validFeatureGeometry({
        kind,
        featureId: known.id,
        box,
        segments: cleanSegments,
        subjectBox,
      });
      if (!geometryOk) {
        rejected.push(feature.name || known.name);
        return null;
      }
      return {
        featureId: known.id,
        name: feature.name || known.name,
        category: feature.category || known.category,
        points: cleanSegments[0] || [],
        segments: cleanSegments,
        box,
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence: String(feature.evidence || ""),
        plainSummary: String(feature.plainSummary || ""),
        advice: String(feature.advice || ""),
        needsReview: Boolean(feature.needsReview || confidence < 0.58 || needsLineReview || faceLowConfidence),
        interpretation: known.interpretation,
        sourceTitle: known.sourceTitle,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (featurePriority.get(a.featureId) ?? 99) - (featurePriority.get(b.featureId) ?? 99));

  return {
    kind,
    imageMeta,
    subjectBox,
    imageQuality: parsed.imageQuality || "unknown",
    notes: [
      ...(Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : []),
      ...(rejected.length ? [`已自动丢弃 ${rejected.length} 个位置不合理的标注`] : []),
    ],
    features: normalizedFeatures,
  };
};

const summarizeFeatures = (result) =>
  (result?.features || []).slice(0, 10).map((feature) => ({
    featureId: feature.featureId,
    name: feature.name,
    category: feature.category,
    confidence: feature.confidence,
    evidence: feature.evidence,
    plainSummary: feature.plainSummary,
    advice: feature.advice,
    needsReview: feature.needsReview,
  }));

export const generatePlainReading = async ({ bazi, palm, face, env }) => {
  if (!env.AI_API_KEY) return null;

  const baseUrl = env.AI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = env.AI_REPORT_MODEL || "qwen3.7-max";
  const endpoint = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const input = {
    baziSummary: bazi.summary,
    baziElements: bazi.elements,
    palmFeatures: summarizeFeatures(palm),
    faceFeatures: summarizeFeatures(face),
  };
  const prompt =
    "你是传统文化测算报告助手。请按真人看图聊天的口吻写报告，格式参考：先说整体特点，再分 1.生命线 2.智慧线 3.感情线 4.事业线 5.明显特点，最后给现实建议和一句总结。" +
    "要求：普通人能听懂；像认真给朋友分析；不要吓人，不要绝对化，不要编医学/投资结论；可以说“传统里一般会理解为”。" +
    "如果输入没有某条线，就写“这张图里这条线不够清楚，先不强断”。现实建议要温和实用。" +
    "输出必须是 JSON：{\"sections\":[{\"title\":\"整体特点\",\"paragraphs\":[\"...\"]}],\"reading\":[\"一句结论或建议\",...]}。" +
    "sections 输出 7-8 段，每段 title 清楚，paragraphs 每段 2-5 句短句；reading 输出 4 条摘要。输入：" +
    JSON.stringify(input);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJson(content);
  return {
    sections: Array.isArray(parsed.sections) ? parsed.sections.slice(0, 9) : [],
    reading: Array.isArray(parsed.reading) ? parsed.reading.slice(0, 6).map(String) : [],
  };
};
