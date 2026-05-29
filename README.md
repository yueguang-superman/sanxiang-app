# 三相命理测算

月光LGL制作。小范围公网体验版，适合 10-20 人使用。

## 功能

- 共享访问码进入，不做账号系统。
- 上传手掌图、面部图，前端压缩后传到 Cloudflare Pages Functions。
- 后端调用 OpenAI-compatible 全模态/视觉 AI，优先返回生命线、智慧线、感情线、事业线、婚姻线等普通用户看得懂的位置。
- 后端排四柱八字，生成五行、十神和通俗综合报告。
- 图片只在本次请求中使用，不落长期存储。

## 部署

1. 把 `命理测算软件` 目录推到 GitHub 仓库。
2. 在 Cloudflare Pages 新建项目，连接 GitHub。
3. Build command 留空，Build output directory 填 `.`。
4. 在 Cloudflare Pages 的 Settings -> Environment variables 配置：
   - `ACCESS_CODE`：共享访问码。
   - `DAILY_LIMIT`：每日次数，比如 `20`。
   - `AI_API_KEY`：通义千问 / 阿里云百炼 API Key。
   - `AI_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`，可不改。
   - `AI_VISION_MODEL`：默认 `qwen3.6-plus`，用于图片识别。必须选择支持图片输入的模型。
   - `AI_REPORT_MODEL`：默认 `qwen3.7-max`，用于把报告写成大白话总结和建议。
5. 建议创建 Cloudflare KV，并绑定为 `RATE_LIMIT_KV`，用于稳定记录每日限次。

## 通义千问配置

本项目默认走阿里云百炼 DashScope 的 OpenAI 兼容接口：

- `AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_VISION_MODEL=qwen3.6-plus`
- `AI_REPORT_MODEL=qwen3.7-max`
- `AI_API_KEY=你的百炼 API Key`

不要把 `AI_API_KEY` 写进前端代码或 GitHub 仓库。请只放在 Cloudflare Pages 的环境变量或 Secret 里。

图片识别和报告撰写分开配置：手掌、面部定位用图像与视频理解模型；报告总结用 Max 模型。如果后期想省钱，再把 `AI_VISION_MODEL` 换成百炼里更便宜且支持图片的模型。

## 拍照建议

- 手掌图：掌心朝上，手掌尽量占满画面，光线亮一点，别太斜，别只拍手指。
- 面部图：正脸无遮挡，别戴墨镜，脸部不要太暗。
- 如果系统提示“没有识别到清楚位置”，通常不是报告坏了，而是照片里的纹路线条不够清楚，换一张近一点、亮一点的图即可。

## 低成本建议

- 小范围使用时先用 Cloudflare 免费层。
- 图片在前端压缩，减少视觉 AI 成本。
- 访问码 + 每日限次避免接口被乱用。
- 后期人数多了再接登录、支付、报告历史和国内备案部署。

## 传统文化声明

报告取意于《周易》《麻衣神相》《神相全编》《三命通会》《滴天髓》《渊海子平》等术数传统，仅作文化娱乐与自我观察参考，不作为医学、法律、投资或人生重大决策依据。
