/**
 * calendar 模块的「系统能力」公开入口。
 *
 * 与另外三个入口的区别：
 * - `index.ts`      页面与完整能力（只有 App 导航层该用，会带进页面组件）
 * - `pure.ts`       纯逻辑（无原生依赖，可进 Node 单测）
 * - `components.ts` 可复用组件
 * - `system.ts`     需要原生模块、但**不含页面组件**的能力（系统日历导出等）
 *
 * 其他模块要同步系统日历时走这里：走 `index.ts` 会连带拉起
 * `AgendaScreen` 等页面，形成 modules 之间的循环依赖（dependency-cruiser 会报错）。
 */

export * from './systemCalendar';
