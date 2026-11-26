# vision 模块 · 图片识别安排

**管什么**：拍照/选图 → 端侧 OCR（图片不出手机）→ 服务端文字解析并自动判断日程/待办 → 确认页 → 分别写进日历 / 待办。

**对外出口**：`index.ts`（别的模块只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `ocrImageText(uri)` | 端侧 OCR：图片 → 文字 |
| `recognizeScheduleImage(...)` | 复用链路：OCR → 服务端解析 → 草稿（日历选图 / 系统分享共用） |
| `warmUpOcrEngine()` | 预热引擎（打开选图面板时调，把建 session 的几秒藏进交互） |
| `registerBundledOcrEngine()` | 启动时注册 PaddleOCR 引擎 |
| `DeviceRecognitionUnavailable` | 设备不具备端侧识别能力（缺原生库 / 模型未就绪） |
| `draftsFromItems` / `inferDraftKind` / `draftDateKey` / `draftToEventDraft` | 解析结果归一、日程/待办分类、映射成日程草稿的纯函数 |
| `EventImportScreen` / `DraftEdit` | 识别确认页 |
| `RecognizedDraft` | 草稿类型 |
| `consumeSharedImage` / `discardSharedImage` / `subscribeSharedImages` | Android 系统分享图片进 App 的入口与本地缓存清理 |

**目录**

```
vision/
├── pipeline.ts 日历选图 / 系统分享共用的 OCR → 解析链路
├── shareImport.ts Android 系统分享图片的原生桥
├── ocr/        端侧识别：PaddleOCR + ONNX Runtime（paddleOcr/register/onDevice + ppocr/ 算法）
├── domain/     纯逻辑：草稿归一与映射，可在 node 里单测
├── screens/    识别确认页
└── index.ts    唯一出口
```

**依赖谁**：`modules/calendar/pure`、`modules/tasks`（待办草稿）、`shared/ui`、`shared/api`、`context/AppContext`。
**谁依赖它**：`App.tsx`（注册引擎、系统分享）、`calendar`（日历页的「上传图片」入口）。

**测试**：`app/test/` 下 `ppocr*.test.ts`、`orientation.test.ts`、`vision.test.ts`、`visionPipeline.test.ts`。
这些是白盒测试，直接 import 模块内部文件，**不受「只能走 index」限制**（测试目录不在边界检查范围）。

**注意**

- 模型文件不进仓库（16MB），由 `scripts/fetch_ppocr_models.sh` 拉取，`build_apk.sh` 每次构建前校验。
- OCR 全程在设备本地完成，**原始图片不上传**——这条是隐私政策的承诺，改动前先看 `docs/legal/privacy-policy.md`。
- 服务端解析接口是 `POST /ai/events/parse-text`（文字进、JSON 出），不要在客户端调大模型。
- 日期交给服务端模型理解：「明天 / 后天 / 下周三 / 下个月 5 号」换算成具体日期；只说「下个月」这类没有具体哪一天时保持日期为空，日程在确认页标成「日期待定」，**不要猜成 1 号或月底**。
