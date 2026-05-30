import { requireAccess } from "../_shared/auth.js";
import { generatePlainReading } from "../_shared/ai.js";
import { calculateBazi } from "../_shared/bazi.js";
import { json, readJson } from "../_shared/http.js";

const scoreFrom = (bazi, palm, face) => {
  const featureCount = (palm?.reportText ? 5 : palm?.features?.length || 0) + (face?.reportText ? 5 : face?.features?.length || 0);
  const elementValues = Object.values(bazi.elements);
  const spread = Math.max(...elementValues) - Math.min(...elementValues);
  return Math.max(42, Math.min(96, 68 + Math.min(16, featureCount) - spread * 3));
};

const featureNames = (result) => (result?.features || []).slice(0, 6).map((item) => item.name).join("、");

const hasFeature = (result, id) => (result?.features || []).some((item) => item.featureId === id);

const sectionParagraphs = (result, title) =>
  (result?.sections || [])
    .filter((section) => !title || section.title === title)
    .flatMap((section) => section.paragraphs || [])
    .slice(0, 4);

const buildReading = (bazi, palm, face) => {
  const palmNames = featureNames(palm) || "手掌照片可分析信息不多";
  const faceNames = featureNames(face) || "面部照片可分析信息不多";
  return [
    `核心判断：${bazi.summary}`,
    palm?.reportText ? "手掌部分更适合看做事方式、精力恢复和阶段方向；看不清的掌纹先不强断。" : `手掌部分重点看：${palmNames}。看不清的掌纹不要强断。`,
    face?.reportText ? "面相部分更适合看当前状态、气色、精神面貌和外在给人的感觉。" : `面相部分重点看：${faceNames}。重点看整体气色、额头、眉眼、鼻子、嘴唇和下巴。`,
    `现实建议：如果生辰、手掌、面部都反复指向压力、方向、关系或财务，就优先处理这个主题。`,
    `提醒：这是传统文化娱乐和自我观察工具，不能替代医学、法律、投资或人生重大决定。`,
  ];
};

const buildSections = (bazi, palm, face) => {
  const palmNames = featureNames(palm) || "手掌照片可分析信息不多";
  const faceNames = featureNames(face) || "面部照片可分析信息不多";
  const palmPhoto = sectionParagraphs(palm);
  const facePhoto = sectionParagraphs(face);
  return [
    {
      title: "整体特点",
      paragraphs: [
        `手掌部分重点看：${palmNames}。面相部分重点看：${faceNames}。`,
        `传统看法里，不是单看一条线，而是把生日信息、手掌、面部放在一起看重复出现的提醒。`,
      ],
    },
    {
      title: "手掌照片",
      paragraphs: palmPhoto.length ? palmPhoto : ["手掌照片里能看清的信息不多，掌纹部分会谨慎处理，不强行下结论。"],
    },
    {
      title: "面部照片",
      paragraphs: facePhoto.length ? facePhoto : ["面部照片里能看清的信息不多，面相部分会谨慎处理，不强行下结论。"],
    },
    {
      title: "1. 生命线",
      paragraphs: [
        hasFeature(palm, "life_line")
          ? "生命线主要看精力、恢复力和生活稳定度，不是直接看寿命。"
          : "这张图里生命线不够清楚，先不强断。",
        "如果这条线被用户确认，通常可以理解为一个人遇到压力后还能继续撑住，但也要避免长期透支。",
      ],
    },
    {
      title: "2. 智慧线",
      paragraphs: [
        hasFeature(palm, "head_line")
          ? "智慧线主要看思路、判断力、学习能力和做事方式。"
          : "这张图里智慧线不够清楚，先不强断。",
        "如果线条偏清楚，说明做事有自己的逻辑；如果偏乱，更多是提醒容易多想、反复琢磨细节。",
      ],
    },
    {
      title: "3. 感情线",
      paragraphs: [
        hasFeature(palm, "heart_line")
          ? "感情线主要看情绪表达、人际关系和感情稳定度。"
          : "这张图里感情线不够清楚，先不强断。",
        "这类内容只适合作为沟通提醒，不能单独判断感情好坏。",
      ],
    },
    {
      title: "4. 事业线",
      paragraphs: [
        hasFeature(palm, "fate_line")
          ? "事业线主要看事业方向、目标感和阶段变化。"
          : "这张图里事业线不够清楚，先不强断。",
        "如果事业线偏淡，传统里常理解为前期方向会调整几次，更适合分阶段稳定推进。",
      ],
    },
    {
      title: "5. 一个比较明显的特点",
      paragraphs: [
        `生日信息显示：${bazi.summary}`,
        "如果手掌、面部和生日信息都在提醒同一件事，比如压力、方向、关系或财务，就优先看这个主题。",
      ],
    },
    {
      title: "现实建议",
      paragraphs: [
        "把报告当作自我观察，不要当成绝对结论。",
        "先做最现实的调整：睡眠、节奏、预算、沟通和身体状态。",
        "如果照片里有皮肤干裂、红肿、明显不适，这部分更建议按现实健康问题处理。",
      ],
    },
    {
      title: "一句话总结",
      paragraphs: [
        "单看这份资料，更像是一个细节敏感、想把事情做好，但也容易精神消耗的人。真正要看重点，要看哪些提醒在八字、手掌和面部里反复出现。",
      ],
    },
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
    const aiReport = await generatePlainReading({ bazi, palm, face, env }).catch(() => null);
    const fallbackSections = buildSections(bazi, palm, face);
    const fallbackReading = buildReading(bazi, palm, face);
    return json({
      subject: body.birth?.personName || "求测者",
      bazi,
      palm,
      face,
      score: scoreFrom(bazi, palm, face),
      sections: aiReport?.sections?.length ? aiReport.sections : fallbackSections,
      reading: aiReport?.reading?.length ? aiReport.reading : fallbackReading,
      remaining: access.remaining,
    });
  } catch (error) {
    return json({ error: error.message }, 400);
  }
};
