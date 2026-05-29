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
  return byName || catalog[index % catalog.length];
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

export const analyzeImage = async ({ kind, imageDataUrl, imageMeta, env }) => {
  if (!env.AI_API_KEY) {
    throw new Error("尚未配置通义千问 API Key。请在 Cloudflare 环境变量中设置 AI_API_KEY。");
  }

  if (!String(imageDataUrl || "").startsWith("data:image/")) {
    throw new Error("图片格式无效。");
  }

  const catalog = catalogFor(kind);
  const names = catalog.map((item) => `${item.id}:${item.name}`).join("；");
  const palmGuide =
    "这是手掌识别。先判断图片是否清楚、是否为完整掌心。最优先标注普通人能看懂的线：生命线、智慧线、感情线、事业线、婚姻线；然后才是成功线、财运纹、断掌、痣、岛纹、掌色、八宫等。生命线/智慧线/感情线/事业线/婚姻线必须尽量返回 points，points 是沿着掌纹走势的 3-8 个百分比坐标点，用来画线。";
  const faceGuide =
    "这是面部识别。先判断图片是否为清楚正脸。优先标注普通人能看懂的位置：印堂、额头、眉眼、山根、鼻头鼻翼、人中、嘴唇、法令纹、耳朵、下巴、痣疤和明显气色。";
  const prompt =
    `你是图像识别助手，任务是给传统文化测算软件做可视化标注，语言要让普通用户看懂。${kind === "palm" ? palmGuide : faceGuide}` +
    `必须只返回 JSON，不要解释。可选特征库：${names}。` +
    `返回格式：{"features":[{"featureId":"life_line","name":"生命线","category":"主要掌纹","points":[{"x":28,"y":45},{"x":22,"y":60},{"x":25,"y":82}],"box":{"x":18,"y":40,"width":22,"height":42},"confidence":0.82,"evidence":"拇指根部外侧弧线清楚","needsReview":false}],"imageQuality":"clear|blurry|partial","notes":["..."]}。` +
    `box 和 points 坐标都用百分比 0-100。只标有视觉依据的内容；看不清时不要硬编，confidence 低于 0.55 且 needsReview=true。`;

  const baseUrl = env.AI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = env.AI_VISION_MODEL || env.AI_MODEL || "qwen3-vl-plus";
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
    throw new Error(`AI 识别失败：${response.status}。当前模型 ${model} 可能不支持图片，或 API Key/额度异常。${text.slice(0, 90)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJson(content);
  const catalogMap = byId(kind);
  const features = Array.isArray(parsed.features) ? parsed.features : [];

  return {
    kind,
    imageMeta,
    imageQuality: parsed.imageQuality || "unknown",
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 4) : [],
    features: features.slice(0, 18).map((feature, index) => {
      const known = matchCatalogItem(catalog, catalogMap, feature, index);
      const confidence = Number(feature.confidence ?? 0.5);
      return {
        featureId: known.id,
        name: feature.name || known.name,
        category: feature.category || known.category,
        points: normalizePoints(feature.points),
        box: feature.box || fallbackBox(index),
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence: String(feature.evidence || ""),
        needsReview: Boolean(feature.needsReview || confidence < 0.58),
        interpretation: known.interpretation,
        sourceTitle: known.sourceTitle,
      };
    }),
  };
};
