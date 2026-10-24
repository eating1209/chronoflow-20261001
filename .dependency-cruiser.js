/**
 * 模块边界规则（dependency-cruiser）。
 *
 * 目的：让「一个人改一块」这件事有机器兜底，而不是靠自觉。
 * `app/src` 已完成业务模块与 shared 底座拆分，下面的边界规则现在全部生效。
 *
 * 用法：
 *   npm run check:boundaries          # 只报错
 *   npx depcruise app/src --output-type dot | dot -T svg > deps.svg   # 画依赖图
 */
module.exports = {
  forbidden: [
    // ───────────────── 今天就有用 ─────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖：A 依赖 B、B 又依赖 A，改一边必崩另一边，必须打断',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-must-not-import-ui',
      severity: 'error',
      comment:
        'domain/ 是纯逻辑（可单测、可在 node 里跑），不能反向依赖页面或组件；' +
        '一旦 domain 里 import 了 React 组件，这条链路就没法单测了',
      from: { path: '^app/src/domain/' },
      to: { path: '^app/src/(screens|components)/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: '没人引用的文件（重构前先清一遍，搬完再删会省很多事）',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', // 点文件
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack|metro|vite)\\.config\\.(js|cjs|mjs|ts)$',
          '^app/(App|index)\\.(ts|tsx)$',
          '^web-admin/src/main\\.tsx$',
        ],
      },
      to: {},
    },

    // ───────────────── 模块与共享层边界 ─────────────────
    {
      name: 'shared-must-not-import-modules',
      severity: 'error',
      comment: 'shared/ 是公共底座，绝不能反向依赖任何业务模块',
      from: { path: '^app/src/shared/' },
      to: { path: '^app/src/modules/' },
    },
    {
      name: 'no-deep-import-into-other-module',
      severity: 'error',
      comment:
        '模块之间只能 import 对方的公开入口（index.ts / pure.ts / components.ts），不许伸手进 screens/domain/components 内部',
      // $1 = 来源模块名。目标路径里「不是同一个模块、且不是公开入口」才算越界。
      // pure.ts 给 Node 单测和纯逻辑复用，components.ts 给共享组件复用；
      // 两者都不把 React Native 页面带进调用方。
      from: { path: '^app/src/modules/([^/]+)/' },
      to: {
        path: '^app/src/modules/(?!$1/)[^/]+/(?!index\\.ts$|pure\\.ts$|components\\.ts$).+',
      },
    },
    {
      name: 'modules-must-not-touch-shared-internals',
      severity: 'warn',
      comment:
        '模块可以用 shared/ 的公开出口（各子目录的 index.ts），但别深挖 shared 内部实现',
      from: { path: '^app/src/modules/' },
      to: {
        path: '^app/src/shared/.+/.+',
        pathNot: [
          '^app/src/shared/[^/]+/index\\.ts$',
          // 通知可用性依赖 Expo / RN，不能被纯 barrel 带进 Node 单测；
          // 这是给 runtime / 权限适配层 / 通知监听器的窄入口。
          '^app/src/shared/notifications/availability\\.ts$',
        ],
      },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // 连同 `import type` 一起算依赖，否则纯类型文件会被误判成没人用
    tsPreCompilationDeps: true,
    exclude: {
      path: [
        'node_modules',
        'app/android',
        'app/ios',
        'app/test', // 测试文件先不纳入，避免一开始就几百条噪音
        'archive',
        'docs',
      ],
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
