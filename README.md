# dsh-plugins

DeepSeek Harness（DSH）插件集合。

GitHub：<https://github.com/jizhi0v0/dsh-plugins>

## 插件

| 插件 | 说明 | 直接安装 spec |
|---|---|---|
| [DeepSeek 官方 API 余额](packages/deepseek-balance/README.md) | 在输入框下方显示 DeepSeek 官方 API 的账户余额、可用状态，并支持在插件卡片内配置 API Key。 | `https://github.com/jizhi0v0/dsh-plugins.git#path:/packages/deepseek-balance` |

## 安装

DSH → **Plugins** → **Add plugin**，粘贴上表的 spec，安装后点 **Enable now**。

DSH 的插件安装底层用 pnpm，`#path:` 是 pnpm 安装 Git monorepo 子目录的语法。固定版本可以写成：

```text
https://github.com/jizhi0v0/dsh-plugins.git#v0.1.0&path:/packages/deepseek-balance
```

## 开发

```bash
npm run check   # 语法检查
npm test        # Host + Client 单元测试
```

每个插件都是一个独立、可直接安装的 DSH bundle：

```text
packages/<plugin>/
├── package.json       # dsh.bundle.patch + dsh.client
├── cordis.patch.yml   # 插入 Loader 行
├── index.js           # Host 半
├── client.js          # Client 半（可选）
├── locale/*.json      # 插件管理器显示元数据
└── icon.svg
```

## 添加新插件

1. 复制 `packages/deepseek-balance` 到 `packages/<your-plugin>`。
2. 修改 `package.json` 的 `name`、`description`、`exports`、`files`。
3. 修改 `cordis.patch.yml` 的行 id 与包名。
4. 保留/替换 `locale`、`icon.svg`，然后运行 `npm test`。
5. 通过 DSH 的 Plugins 页面或 `plugin_manager` 工具安装该目录。
