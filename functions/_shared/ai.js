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

const normalizeSegments = (segments, points) => {
  const rawSegments = Array.isArray(segments) && segments.length ? segments : [points || []];
  return rawSegments
    .map(normalizePoints)
    .filter((segment) => segment.length >= 2)
    .slice(0, 6);
};

const palmMainLineIds = new Set(["life_line", "head_line", "heart_line", "fate_line", "marriage_line"]);

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
    "这是手掌识别。你必须先按掌纹原理判断，不要按模板乱画。生命线：从拇指和食指之间附近起，沿拇指根部大鱼际外缘向手腕方向弧形下行，不应画成穿过掌心的直线。智慧线：从虎口附近或生命线起点附近出发，横穿掌心中部，常向小指侧或月丘方向略下斜。感情线：在手指根部下方，从小指侧横向走向食指/中指方向，位置在掌心上部。事业线：从掌底或掌心下方往中指方向上行，通常偏竖，常淡或断续，不清楚就只给候选框。婚姻线：在小指下方掌边，是短横线，不应画成横穿掌心的长线。断续线请用 segments 多段返回，不要把断开的地方硬连起来；每段至少 2 个点，清楚长线用 4-10 个点贴着真实纹路走。可选特征按优先级：生命线、智慧线、感情线、事业线、婚姻线，然后才是成功线、财运纹、断掌、痣、岛纹、掌色、八宫。name 必须用普通名称。";
  const faceGuide =
    "这是面部识别。先判断图片是否为清楚正脸。优先标注普通人能看懂的位置：印堂、额头、眉眼、山根、鼻头鼻翼、人中、嘴唇、法令纹、耳朵、下巴、痣疤和明显气色。面部只返回 box，不要返回 points，不要画横跨脸部的线。box 要贴近真实部位，例如印堂只框两眉之间，山根只框鼻梁上方，耳朵只框耳朵，不要大范围乱框。name 必须用普通名称。";
  const prompt =
    `你是图像识别助手，任务是给传统文化测算软件做可视化标注，语言要让普通用户看懂。${correctionGuide}${kind === "palm" ? palmGuide : faceGuide}` +
    `必须只返回 JSON，不要解释。可选特征库：${names}。` +
    `返回格式：{"features":[{"featureId":"life_line","name":"生命线","category":"主要掌纹","segments":[[{"x":28,"y":45},{"x":25,"y":55},{"x":22,"y":68},{"x":25,"y":82}]],"box":{"x":18,"y":40,"width":22,"height":42},"confidence":0.82,"evidence":"拇指根部外侧弧线清楚","plainSummary":"简单说，看精力、稳定度和恢复力，不是看寿命。","advice":"近期注意规律作息，重要决定别硬撑。","needsReview":false}],"imageQuality":"clear|blurry|partial","notes":["..."]}。` +
    `box、points、segments 坐标都用百分比 0-100。只标有视觉依据的内容；看不清时不要硬编，不要画跨过无掌纹的直线，confidence 低于 0.55 且 needsReview=true。`;

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
      const segments = kind === "face" ? [] : normalizeSegments(feature.segments, feature.points);
      const pointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
      const needsLineReview = kind === "palm" && palmMainLineIds.has(known.id) && pointCount < (known.id === "marriage_line" ? 2 : 4);
      const faceLowConfidence = kind === "face" && confidence < 0.72;
      return {
        featureId: known.id,
        name: feature.name || known.name,
        category: feature.category || known.category,
        points: needsLineReview ? [] : segments[0] || [],
        segments: needsLineReview ? [] : segments,
        box: feature.box || fallbackBox(index),
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence: String(feature.evidence || ""),
        plainSummary: String(feature.plainSummary || ""),
        advice: String(feature.advice || ""),
        needsReview: Boolean(feature.needsReview || confidence < 0.58 || needsLineReview || faceLowConfidence),
        interpretation: known.interpretation,
        sourceTitle: known.sourceTitle,
      };
    }),
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
