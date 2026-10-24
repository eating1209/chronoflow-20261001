# vision 模块 · 图片识别日程

**管什么**：拍照/选图 → 端侧 OCR（图片不出手机）→ 服务端文字解析 → 确认页 → 写进日历。

**对外出口**：`index.ts`（别的模块只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `ocrImageText(uri)` | 端侧 OCR：图片 → 文字 |
| `warmUpOcrEngine()` | 预热引擎（打开选图面板时调，把建 session 的几秒藏进交互） |
| `registerBundledOcrEngine()` | 启动时注册 PaddleOCR 引擎 |
| `DeviceRecognitionUnavailable` | 设备不具备端侧识别能力（缺原生库 / 模型未就绪） |
| `draftsFromItems` / `draftDateKey` / `draftToEventDraft` | 解析结果 → 日程草稿的纯函数 |
| `EventImportScreen` / `DraftEdit` | 识别确认页 |
| `RecognizedDraft` | 草稿类型 |

**目录**

```
vision/
├── ocr/        端侧识别：PaddleOCR + ONNX Runtime（paddleOcr/register/onDevice + ppocr/ 算法）
├── domain/     纯逻辑：草稿归一与映射，可在 node 里单测
├── screens/    识别确认页
└── index.ts    唯一出口
```

**依赖谁**：`modules/calendar/pure`、`shared/ui`、`shared/api`、`context/AppContext`。
**谁依赖它**：`App.tsx`（注册引擎）、`calendar`（日历页的「上传图片」入口）。

**测试**：`app/test/` 下 `ppocr*.test.ts`、`orientation.test.ts`、`vision.test.ts`（共 41 项）。
这些是白盒测试，直接 import 模块内部文件，**不受「只能走 index」限制**（测试目录不在边界检查范围）。

**注意**

- 模型文件不进仓库（16MB），由 `scripts/fetch_ppocr_models.sh` 拉取，`build_apk.sh` 每次构建前校验。
- OCR 全程在设备本地完成，**原始图片不上传**——这条是隐私政策的承诺，改动前先看 `docs/legal/privacy-policy.md`。
- 服务端解析接口是 `POST /ai/events/parse-text`（文字进、JSON 出），不要在客户端调大模型。
