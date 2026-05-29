const $ = (id) => document.getElementById(id);

const state = {
  accessCode: sessionStorage.getItem("accessCode") || "",
  anonymousId: localStorage.getItem("anonymousId") || crypto.randomUUID(),
  palmImage: null,
  faceImage: null,
  palmResult: null,
  faceResult: null,
};

localStorage.setItem("anonymousId", state.anonymousId);

const api = async (path, body) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessCode: state.accessCode,
      anonymousId: state.anonymousId,
      ...body,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
};

const setMessage = (id, text, isError = false) => {
  const node = $(id);
  node.textContent = text;
  node.classList.toggle("error", isError);
};

const unlock = async () => {
  state.accessCode = $("accessCode").value.trim();
  if (!state.accessCode) {
    setMessage("accessMessage", "先输入共享访问码。", true);
    return;
  }

  setMessage("accessMessage", "正在检查访问码...");
  try {
    const result = await api("/api/access", {});
    sessionStorage.setItem("accessCode", state.accessCode);
    $("workspace").classList.remove("locked");
    $("quotaStatus").textContent = `今日剩余 ${result.remaining} 次`;
    setMessage("accessMessage", "已进入，可以开始测算。");
  } catch (error) {
    $("workspace").classList.add("locked");
    setMessage("accessMessage", error.message, true);
  }
};

const compressImage = (file, maxSize = 1400, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", quality),
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const loadImage = async (kind, file) => {
  if (!file) return;
  const image = await compressImage(file);
  state[`${kind}Image`] = image;
  state[`${kind}Result`] = null;
  clearReview(kind);

  const preview = $(`${kind}Preview`);
  $(`${kind}Stage`).style.aspectRatio = `${image.width} / ${image.height}`;
  preview.src = image.dataUrl;
  preview.hidden = false;
  $(`${kind}Empty`).hidden = true;
  $(`${kind}Marks`).innerHTML = "";
  setMessage(`${kind}Status`, `已压缩：${image.width}×${image.height}`);
};

const escapeHtml = (text = "") =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const normalizeBox = (box = {}) => {
  const rawX = Number.isFinite(Number(box.x ?? box.left)) ? Number(box.x ?? box.left) : 0;
  const rawY = Number.isFinite(Number(box.y ?? box.top)) ? Number(box.y ?? box.top) : 0;
  const x = Math.max(0, Math.min(96, rawX));
  const y = Math.max(0, Math.min(96, rawY));
  const width = Number.isFinite(Number(box.width ?? box.w)) ? Number(box.width ?? box.w) : 12;
  const height = Number.isFinite(Number(box.height ?? box.h)) ? Number(box.height ?? box.h) : 8;
  return {
    x,
    y,
    width: Math.max(3, Math.min(100 - x, width)),
    height: Math.max(3, Math.min(100 - y, height)),
  };
};

const normalizePoint = (point = {}) => ({
  x: Math.max(0, Math.min(100, Number(point.x ?? 0))),
  y: Math.max(0, Math.min(100, Number(point.y ?? 0))),
});

const palmMainLineIds = new Set(["life_line", "head_line", "heart_line", "fate_line", "marriage_line"]);

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const traceScore = (points) => {
  if (points.length < 2) return { length: 0, maxSegment: 0 };
  const segments = points.slice(1).map((point, index) => pointDistance(points[index], point));
  return {
    length: segments.reduce((sum, value) => sum + value, 0),
    maxSegment: Math.max(...segments),
  };
};

const canDrawTrace = (kind, feature, points) => {
  if (kind !== "palm") {
    return false;
  }
  if (!palmMainLineIds.has(feature.featureId)) {
    return points.length >= 3 && !feature.needsReview && (feature.confidence ?? 0) >= 0.7;
  }
  const score = traceScore(points);
  return points.length >= 4 && score.length >= 14 && score.maxSegment <= 32 && (feature.confidence ?? 0) >= 0.68 && !feature.needsReview;
};

const activeFeatures = (result) => (result?.features || []).filter((feature) => feature.included !== false);

const drawMarks = (kind, result) => {
  const svg = $(`${kind}Marks`);
  svg.innerHTML = "";
  const features = activeFeatures(result);
  for (const feature of features) {
    const box = normalizeBox(feature.box);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const points = (feature.points || []).map(normalizePoint).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const shouldDrawTrace = canDrawTrace(kind, feature, points);

    if (shouldDrawTrace) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("class", "mark-line");
      line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
      group.append(line);
    } else {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", feature.needsReview ? "mark-box mark-candidate" : "mark-box");
      rect.setAttribute("x", box.x);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.width);
      rect.setAttribute("height", box.height);
      rect.setAttribute("rx", 1.4);
      group.append(rect);
    }

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "mark-label");
    label.setAttribute("x", Math.min(94, shouldDrawTrace ? points[0].x : box.x + 1));
    label.setAttribute("y", Math.max(5, (shouldDrawTrace ? points[0].y : box.y) - 1));
    label.textContent = `${feature.name || feature.featureId || "特殊点"}${feature.needsReview ? "候选" : ""}`;

    group.append(label);
    svg.append(group);
  }
};

const reviewSummary = (result) => {
  const features = result?.features || [];
  return {
    kept: features.filter((feature) => feature.included !== false).length,
    excluded: features.filter((feature) => feature.included === false).length,
    confirmed: features.filter((feature) => feature.reviewStatus === "confirmed").length,
  };
};

const clearReview = (kind) => {
  const panel = $(`${kind}Review`);
  const list = $(`${kind}ReviewList`);
  if (panel) panel.hidden = true;
  if (list) list.innerHTML = "";
};

const prepareReview = (kind, result) => ({
  ...result,
  features: (result.features || []).map((feature, index) => ({
    ...feature,
    localId: `${kind}-${Date.now()}-${index}`,
    included: feature.included !== false,
    reviewStatus: feature.needsReview ? "pending" : "kept",
  })),
});

const renderReview = (kind) => {
  const result = state[`${kind}Result`];
  const panel = $(`${kind}Review`);
  const list = $(`${kind}ReviewList`);
  if (!panel || !list) return;

  const features = result?.features || [];
  panel.hidden = !features.length;
  if (!features.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = features
    .map((feature, index) => {
      const guide = guideForFeature(feature);
      const confidence = Math.round((feature.confidence ?? 0) * 100);
      const status =
        feature.included === false
          ? "已排除"
          : feature.reviewStatus === "confirmed"
            ? "已确认"
            : feature.needsReview
              ? "待复核"
              : "已保留";
      const statusClass = feature.included === false ? "excluded" : feature.reviewStatus === "confirmed" ? "confirmed" : "pending";
      const evidence = feature.evidence || "AI 只识别到大概位置";
      return `
        <article class="review-item ${feature.included === false ? "is-excluded" : ""}">
          <div class="review-main">
            <strong>${escapeHtml(guide.label)}</strong>
            <span class="${statusClass}">${status} · AI把握 ${confidence}%</span>
            <p>${escapeHtml(evidence)}</p>
          </div>
          <div class="review-actions">
            <button type="button" data-kind="${kind}" data-index="${index}" data-action="confirm">确认</button>
            <button type="button" data-kind="${kind}" data-index="${index}" data-action="edit">${feature.editing ? "收起" : "修改"}</button>
            <button type="button" data-kind="${kind}" data-index="${index}" data-action="${feature.included === false ? "restore" : "exclude"}">${feature.included === false ? "恢复" : "排除"}</button>
          </div>
          ${
            feature.editing
              ? `
                <div class="review-editor">
                  <label>
                    改成正确的线/部位
                    <select data-edit-field="featureId">
                      ${featureOptions(kind, feature.featureId)}
                    </select>
                  </label>
                  <p>用户只纠正识别位置，说明和建议仍由 AI 自动生成。</p>
                  <button type="button" data-kind="${kind}" data-index="${index}" data-action="save">保存纠正</button>
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
};

const updateReviewStatus = (kind, index, action) => {
  const result = state[`${kind}Result`];
  const feature = result?.features?.[index];
  if (!feature) return;

  if (action === "exclude") {
    feature.included = false;
    feature.reviewStatus = "excluded";
  } else if (action === "restore") {
    feature.included = true;
    feature.reviewStatus = feature.needsReview ? "pending" : "kept";
  } else if (action === "confirm") {
    feature.included = true;
    feature.reviewStatus = "confirmed";
  } else if (action === "edit") {
    feature.editing = !feature.editing;
  }

  drawMarks(kind, result);
  renderReview(kind);
  const summary = reviewSummary(result);
  setMessage(`${kind}Status`, `已保留 ${summary.kept} 个，排除 ${summary.excluded} 个`);
};

const featureOptions = (kind, selectedId) => {
  const palmOptions = [
    ["life_line", "生命线"],
    ["head_line", "智慧线"],
    ["heart_line", "感情线"],
    ["fate_line", "事业线"],
    ["marriage_line", "婚姻线"],
    ["palm_shape", "手型和掌色"],
    ["five_fingers", "手指长短和指缝"],
    ["moles_veins", "痣、青筋和颜色"],
    ["special_shapes", "特殊纹路"],
  ];
  const faceOptions = [
    ["forehead", "额头"],
    ["yintang", "印堂"],
    ["brows", "眉毛"],
    ["eyes", "眼睛"],
    ["nose_root", "山根"],
    ["nose_tip", "鼻子"],
    ["philtrum", "人中"],
    ["mouth", "嘴唇"],
    ["law_lines", "法令纹"],
    ["ears", "耳朵"],
    ["chin", "下巴"],
    ["moles_scars_qi", "痣疤和气色"],
  ];
  const options = kind === "face" ? faceOptions : palmOptions;
  return options
    .map(([value, label]) => `<option value="${value}" ${value === selectedId ? "selected" : ""}>${label}</option>`)
    .join("");
};

const applyFeatureCorrection = (kind, feature, featureId) => {
  const guide = featureGuides[featureId];
  if (!guide) return;
  feature.featureId = featureId;
  feature.name = guide.label;
  feature.category = kind === "face" ? "用户纠正的面部位置" : "用户纠正的手掌位置";
  feature.plainSummary = "";
  feature.advice = "";
  feature.evidence = `用户将此项纠正为：${guide.label}`;
};

const saveReviewEdit = (kind, index, button) => {
  const result = state[`${kind}Result`];
  const feature = result?.features?.[index];
  const editor = button.closest(".review-editor");
  if (!feature || !editor) return;

  const select = editor.querySelector('[data-edit-field="featureId"]');
  applyFeatureCorrection(kind, feature, select?.value || feature.featureId);

  feature.included = true;
  feature.needsReview = false;
  feature.reviewStatus = "confirmed";
  feature.editing = false;
  drawMarks(kind, result);
  renderReview(kind);
  setMessage(`${kind}Status`, "已保存用户纠正，说明和建议将由 AI 自动生成");
};

const analyze = async (kind) => {
  const image = state[`${kind}Image`];
  if (!image) {
    setMessage(`${kind}Status`, "请先选择图片。", true);
    return null;
  }

  const label = kind === "palm" ? "手掌照片" : "面部照片";
  setMessage(`${kind}Status`, `AI 正在分析${label}...`);
  try {
    const result = await api(`/api/analyze/${kind}`, {
      imageDataUrl: image.dataUrl,
      imageMeta: { width: image.width, height: image.height },
    });
    state[`${kind}Result`] = prepareReview(kind, result);
    drawMarks(kind, state[`${kind}Result`]);
    renderReview(kind);
    const count = state[`${kind}Result`].features?.length || 0;
    const emptyTip = kind === "palm" ? "没识别到清楚掌纹，请换一张掌心更近、更清晰的照片。" : "没识别到清楚面部特征，请换一张正脸照片。";
    const reviewCount = state[`${kind}Result`].features?.filter((feature) => feature.needsReview).length || 0;
    const doneText =
      kind === "palm" && reviewCount
        ? `已标出 ${count} 个候选位置，掌纹太淡的线已改为候选区`
        : `已标出 ${count} 个位置`;
    setMessage(`${kind}Status`, count ? doneText : emptyTip, !count);
    if (typeof result.remaining === "number") {
      $("quotaStatus").textContent = `今日剩余 ${result.remaining} 次`;
    }
    return result;
  } catch (error) {
    setMessage(`${kind}Status`, error.message, true);
    return null;
  }
};

const birthPayload = () => ({
  personName: $("personName").value.trim() || "求测者",
  gender: $("gender").value,
  birthDate: $("birthDate").value,
  birthTime: $("birthTime").value,
  timezone: Number($("timezone").value),
  birthPlace: $("birthPlace").value.trim(),
});

const reviewedResult = (kind) => {
  const result = state[`${kind}Result`];
  if (!result) return null;
  return {
    ...result,
    features: activeFeatures(result).map(({ editing, localId, ...feature }) => feature),
  };
};

const featureGuides = {
  life_line: {
    label: "生命线",
    plain: "简单说：看一个人的精力、恢复力和生活稳定度，不是直接看寿命。",
    advice: "建议：如果线条有断续或杂纹，就把它当作“最近别硬扛”的提醒，规律作息、少透支体力。",
  },
  head_line: {
    label: "智慧线",
    plain: "简单说：看思路、判断力、学习能力和做事方式。",
    advice: "建议：线清楚就适合把想法落到计划；线乱或断续时，重要决定先写下来、隔天再定。",
  },
  heart_line: {
    label: "感情线",
    plain: "简单说：看情绪表达、人际关系和感情稳定度。",
    advice: "建议：感情线杂乱时，别急着用情绪做决定，先把话说清楚，减少误会。",
  },
  fate_line: {
    label: "事业线",
    plain: "简单说：看事业方向、目标感和阶段变化。",
    advice: "建议：事业线断续时，不代表不好，而是适合分阶段推进，先稳住一个主方向。",
  },
  marriage_line: {
    label: "婚姻线",
    plain: "简单说：看感情关系的节奏和稳定感，不能单独断婚姻好坏。",
    advice: "建议：如果线浅或分叉，只当作沟通提醒，感情问题要看现实相处，别只看一条线。",
  },
  palm_shape: {
    label: "手型和掌色",
    plain: "简单说：看整体状态。掌色红润、手型舒展，一般代表当前气色和精神状态更稳。",
    advice: "建议：掌色发暗或偏青时，先从休息、饮食、运动调整，不要过度解读。",
  },
  five_fingers: {
    label: "手指长短和指缝",
    plain: "简单说：看做事风格、花钱习惯和人际边界。",
    advice: "建议：指缝大可以提醒自己记账和控制冲动消费；手指紧也要注意别太保守。",
  },
  nails: {
    label: "指甲状态",
    plain: "简单说：看近期身体状态的参考，比如疲劳、压力、营养状态。",
    advice: "建议：指甲异常不要当命理结论，长期明显异常更适合去做健康检查。",
  },
  mingtang: {
    label: "掌心区域",
    plain: "简单说：看内心压力和事情是否缠得多。",
    advice: "建议：掌心杂纹多时，适合给事情分优先级，先处理最重要的三件事。",
  },
  bagong: {
    label: "手掌分区",
    plain: "简单说：这是传统手相里的辅助区域，用来配合主要掌纹看方向。",
    advice: "建议：分区只能辅助，真正重点还是生命线、智慧线、感情线、事业线、婚姻线。",
  },
  simian_line: {
    label: "断掌",
    plain: "简单说：代表做事容易集中、较有冲劲，但也可能比较固执。",
    advice: "建议：有冲劲是优势，但遇到大事要多听一个外部意见，避免一条路走到底。",
  },
  six_success: {
    label: "成功线",
    plain: "简单说：看表现力、名气、技能成果和被看见的机会。",
    advice: "建议：如果成功线清楚，适合主动展示作品和能力；如果不明显，就先积累可展示成果。",
  },
  noble_line: {
    label: "贵人纹",
    plain: "简单说：看外部帮助、人缘助力和遇到支持者的机会。",
    advice: "建议：别只等贵人，主动维护关系、表达需求，助力才更容易出现。",
  },
  wealth_marks: {
    label: "财运纹",
    plain: "简单说：看理财意识、赚钱机会和守财能力的参考。",
    advice: "建议：有财运纹也要靠预算和执行；没有也不代表没财，关键是稳定收入和少乱花。",
  },
  special_shapes: {
    label: "特殊纹路",
    plain: "简单说：岛纹、三角纹、井字纹这些属于额外提醒，要看出现在哪里。",
    advice: "建议：特殊纹不要单独下结论，必须和主要掌纹、八字、面部一起看。",
  },
  moles_veins: {
    label: "痣、青筋和颜色",
    plain: "简单说：看局部状态和近期压力，更多是提醒项。",
    advice: "建议：明显青筋、色暗或变化很快时，先关注身体状态，必要时做现实检查。",
  },
  forehead: {
    label: "额头",
    plain: "简单说：看早年状态、思路开阔度和外在精神面貌。",
    advice: "建议：额头有疤痕或暗沉时，报告里只作提醒，不要单独判断运势。",
  },
  yintang: {
    label: "印堂",
    plain: "简单说：看近期精神压力、心情和做事是否顺畅。",
    advice: "建议：印堂暗或有杂纹时，先减少焦虑源，把睡眠和节奏调回来。",
  },
  tiancang: {
    label: "太阳穴附近",
    plain: "简单说：看资源、人脉和积累能力的参考。",
    advice: "建议：这里不饱满或有痣疤时，建议稳住现金流，别轻易做大额冒险。",
  },
  jiamen: {
    label: "夫妻宫",
    plain: "简单说：看感情关系和伴侣相处状态的参考。",
    advice: "建议：有痣疤或暗沉时，不要吵着定输赢，多做沟通和边界管理。",
  },
  leitang: {
    label: "下眼睑",
    plain: "简单说：看情绪、睡眠和亲密关系里的消耗感。",
    advice: "建议：如果浮肿或暗沉明显，先从休息、少熬夜、少内耗开始。",
  },
  brows: {
    label: "眉毛",
    plain: "简单说：看性格表达、人际关系和行动脾气。",
    advice: "建议：眉形杂乱时，提醒自己说话慢一点，处理关系别太冲。",
  },
  eyes: {
    label: "眼神",
    plain: "简单说：看精神状态、专注力和当前气场。",
    advice: "建议：眼神疲惫或散时，先休息；状态没恢复前少做高风险决定。",
  },
  nose_root: {
    label: "山根",
    plain: "简单说：看压力承接、抗压能力和中间阶段的稳定性。",
    advice: "建议：这里暗沉或有纹时，适合把压力拆小，不要什么都自己扛。",
  },
  nose_tip: {
    label: "鼻子",
    plain: "简单说：传统里常拿它看财务观念和资源掌控。",
    advice: "建议：鼻翼薄或鼻孔明显时，提醒自己做好预算，别情绪消费。",
  },
  philtrum: {
    label: "人中",
    plain: "简单说：看承接力、耐力和生活节奏。",
    advice: "建议：人中浅或歪时，只作状态提醒，先把规律生活做好。",
  },
  mouth: {
    label: "嘴唇",
    plain: "简单说：看表达、食禄和对外沟通。",
    advice: "建议：唇色暗或嘴角下垂时，先关注疲劳和情绪，也要注意表达方式。",
  },
  law_lines: {
    label: "法令纹",
    plain: "简单说：看责任感、规则感和承担事情的能力。",
    advice: "建议：法令深不一定坏，适合把经验变成方法；断裂或开叉时少硬撑。",
  },
  ears: {
    label: "耳朵",
    plain: "简单说：看基础、听取意见和稳定感。",
    advice: "建议：耳形只作参考，现实里更重要的是多听有效建议、少冲动。",
  },
  chin: {
    label: "下巴",
    plain: "简单说：看后劲、稳定度和生活承载。",
    advice: "建议：下巴弱或尖时，适合提前做长期规划，别只看眼前。",
  },
  moles_scars_qi: {
    label: "痣疤和气色",
    plain: "简单说：这是额外提醒项，代表某个部位需要重点看。",
    advice: "建议：痣疤气色不要单独断事，结合位置、八字和现实情况再看。",
  },
};

const guideForFeature = (feature) => {
  const key = feature.featureId;
  const guide = featureGuides[key] || {};
  return {
    label: guide.label || feature.name || "识别位置",
    plain: feature.plainSummary || guide.plain || "简单说：AI 看到了这个位置，但需要结合其他信息一起判断。",
    advice: feature.advice || guide.advice || "建议：把它当作提醒，不要只凭一个点下结论。",
  };
};

const renderFeatureList = (title, result) => {
  const features = result?.features || [];
  if (!features.length) {
    return `<section class="report-section"><h3>${title}</h3><p class="source">这张图暂时没有识别到清楚位置。建议重新上传更清晰的照片：画面里只放手掌或正脸，光线亮一点，不要遮挡。</p></section>`;
  }
  const items = features
    .map((feature) => {
      const confidence = Math.round((feature.confidence ?? 0) * 100);
      const review = feature.needsReview ? "，建议复核照片" : "";
      const guide = guideForFeature(feature);
      return `
        <article class="feature-item">
          <div class="feature-title">
            <strong>${escapeHtml(guide.label)}</strong>
            <span>AI把握 ${confidence}%${review}</span>
          </div>
          <p>${escapeHtml(guide.plain)}</p>
          <p><b>建议：</b>${escapeHtml(guide.advice.replace(/^建议：/, ""))}</p>
          <p class="feature-evidence"><b>AI看到：</b>${escapeHtml(feature.evidence || feature.name || "已识别到这个位置")}</p>
        </article>
      `;
    })
    .join("");
  return `<section class="report-section"><h3>${title}</h3><div class="feature-list">${items}</div></section>`;
};

const renderNarrativeSections = (sections = []) => {
  if (!sections.length) return "";
  return `
    <section class="report-section narrative-report">
      <h3>详细解读</h3>
      ${sections
        .map(
          (section) => `
            <article class="narrative-section">
              <h4>${escapeHtml(section.title || "解读")}</h4>
              ${(section.paragraphs || []).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
            </article>
          `,
        )
        .join("")}
    </section>
  `;
};

const renderReport = (report) => {
  const bazi = report.bazi;
  const elements = bazi.elements || {};
  const max = Math.max(1, ...Object.values(elements));
  const elementBars = ["木", "火", "土", "金", "水"]
    .map((name) => {
      const value = elements[name] || 0;
      return `<div class="element"><label>${name} ${value}</label><div class="bar"><i style="width:${(value / max) * 100}%"></i></div></div>`;
    })
    .join("");

  $("report").innerHTML = `
    <div class="report-title">
      <div>
        <h2>${escapeHtml(report.subject)}综合测算报告</h2>
        <p>月光LGL制作。内容只作传统文化娱乐参考，不等于现实承诺。</p>
      </div>
      <div class="score"><span>综合气势</span><strong>${report.score}</strong></div>
    </div>

    <section class="report-section">
      <h3>四柱盘式</h3>
      <div class="pillar-row">
        ${bazi.pillars.map((p) => `<div class="pillar"><span>${p.label}</span><strong>${p.value}</strong></div>`).join("")}
      </div>
    </section>

    <section class="report-section">
      <h3>五行统计</h3>
      <div class="element-bars">${elementBars}</div>
      <p class="source">${escapeHtml(bazi.summary)}</p>
    </section>

    ${renderNarrativeSections(report.sections)}

    ${renderFeatureList("手掌识别结果", report.palm)}
    ${renderFeatureList("面部识别结果", report.face)}

    <section class="report-section">
      <h3>综合解读</h3>
      <ul>${report.reading.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>

    <section class="report-section">
      <h3>参考来源</h3>
      <p class="source">参考《周易》的取象方法，也借用了《麻衣神相》《神相全编》里的手相、面相部位说法，以及《三命通会》《滴天髓》《渊海子平》里的四柱五行思路。AI 负责看图标位置，解释由规则库生成。</p>
    </section>
  `;
};

const submitReport = async (event) => {
  event.preventDefault();
  if (!$("birthDate").value || !$("birthTime").value) {
    $("report").innerHTML = `<div class="report-empty"><h2>缺少生辰</h2><p class="error">请先填写出生日期和时间。</p></div>`;
    return;
  }

  $("report").innerHTML = `<div class="report-empty"><h2>正在生成报告</h2><p>正在分析生日、手掌照片和面部照片...</p></div>`;

  if (state.palmImage && !state.palmResult) await analyze("palm");
  if (state.faceImage && !state.faceResult) await analyze("face");

  try {
    const report = await api("/api/report", {
      birth: birthPayload(),
      palm: reviewedResult("palm"),
      face: reviewedResult("face"),
    });
    renderReport(report);
  } catch (error) {
    $("report").innerHTML = `<div class="report-empty"><h2>生成失败</h2><p class="error">${escapeHtml(error.message)}</p></div>`;
  }
};

const fillDemo = () => {
  $("personName").value = "月下问命者";
  $("gender").value = "male";
  $("birthDate").value = "1992-08-18";
  $("birthTime").value = "21:35";
  $("timezone").value = "8";
  $("birthPlace").value = "上海";
};

const clearAll = () => {
  $("readingForm").reset();
  $("birthTime").value = "12:00";
  for (const kind of ["palm", "face"]) {
    state[`${kind}Image`] = null;
    state[`${kind}Result`] = null;
    $(`${kind}Preview`).hidden = true;
    $(`${kind}Preview`).removeAttribute("src");
    $(`${kind}Stage`).style.removeProperty("aspect-ratio");
    $(`${kind}Empty`).hidden = false;
    $(`${kind}Marks`).innerHTML = "";
    clearReview(kind);
    setMessage(`${kind}Status`, "");
  }
};

const handleReviewClick = (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "save") {
    saveReviewEdit(button.dataset.kind, Number(button.dataset.index), button);
    return;
  }
  updateReviewStatus(button.dataset.kind, Number(button.dataset.index), button.dataset.action);
};

$("unlockButton").addEventListener("click", unlock);
$("accessCode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") unlock();
});
$("palmImage").addEventListener("change", (event) => loadImage("palm", event.target.files[0]));
$("faceImage").addEventListener("change", (event) => loadImage("face", event.target.files[0]));
$("analyzePalm").addEventListener("click", () => analyze("palm"));
$("analyzeFace").addEventListener("click", () => analyze("face"));
$("palmReview").addEventListener("click", handleReviewClick);
$("faceReview").addEventListener("click", handleReviewClick);
$("readingForm").addEventListener("submit", submitReport);
$("fillDemo").addEventListener("click", fillDemo);
$("clearAll").addEventListener("click", clearAll);

if (state.accessCode) {
  $("accessCode").value = state.accessCode;
  unlock();
}
