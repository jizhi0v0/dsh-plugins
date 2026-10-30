# DeepSeek 官方 API 余额

在 DSH Web 界面的输入框下方显示 **DeepSeek 官方 API** 的账户余额与可用状态。数据来自官方 `GET https://api.deepseek.com/user/balance`。

![插件图标](./icon.svg)

## 功能

- 输入框下方常驻一个小状态条：`DeepSeek · ¥110.00`，用圆点表示 API 是否可用。
- 点开状态条查看：
  - 可用状态（`is_available`）
  - 每个币种的总额、赠金、充值余额
  - 最近更新时间
  - 错误原因（Key 无效、限流、网络不通、超时等）
- 在卡片内填写、替换、清除 API Key。
- 自动刷新间隔可选 30 秒 / 1 分钟 / 5 分钟 / 15 分钟 / 关闭。
- 卡片是浮层：上方空间够就向上展开，否则向下；不推挤输入框，点击外部或按 Esc 关闭。
- 中英文界面跟随 DSH 的语言设置。

## 安装

GitHub 仓库：<https://github.com/jizhi0v0/dsh-plugins>

### 通过 GitHub 直接安装（推荐）

DSH 的插件安装底层使用 pnpm，pnpm 支持用 `#path:` 安装 monorepo 的子目录，所以不需要把插件单独拆一个仓库。

1. 打开 DSH Web，侧边栏进入 **Plugins**（插件）页面。
2. 点击 **Add plugin**（添加插件），粘贴：

   ```text
   https://github.com/jizhi0v0/dsh-plugins.git#path:/packages/deepseek-balance
   ```

   或等价的 pnpm/GitHub 简写：

   ```text
   github:jizhi0v0/dsh-plugins#path:/packages/deepseek-balance
   ```

   需要固定版本时，用 tag + path（v0.1.2 已打 tag）：

   ```text
   https://github.com/jizhi0v0/dsh-plugins.git#v0.1.2&path:/packages/deepseek-balance
   ```

3. 安装完成后点击 **Enable now**（或打开插件的开关）。
4. 回到任意已发送过消息的会话。输入框下方应出现 `DeepSeek` 状态条；如果还没有出现，刷新页面或重启 DSH。
5. 点击状态条右侧的齿轮，粘贴 API Key，点 **保存**。Key 可以在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建。

### 更新已安装的插件

第三方 Git 插件没有官方插件卡片上的 **Update** 按钮；而且在开启了 HMR 的 profile 里，直接用同一个包名再安装会被 `already-installed` 拒绝。更新流程是：

1. Plugins 页面找到 **DeepSeek 官方 API 余额**，点 **Remove / 卸载**
2. 点 **Add plugin**，粘贴新的 tag URL，例如：

   ```text
   https://github.com/jizhi0v0/dsh-plugins.git#v0.1.2&path:/packages/deepseek-balance
   ```

3. 安装后点 **Enable now**
4. 刷新页面；如果 Host 端代码没有热替换，重启 DSH

卸载只会移除包和 bundle 行，不会删除 `~/.dsh/deepseek-balance/config.json`，所以重新装好后 API Key 还在，不需要重新填写。

如果插件卡片/详情里显示的版本仍是旧的，说明新包没有装上；可以确认版本号是否为 `0.1.2`。

### 本地路径安装（开发时）

如果正在改这个插件，直接安装本地目录，插件管理器会以 `link:` 方式链接，改完刷新即可：

```text
/Users/bobby/Developer/github/dsh-plugins/packages/deepseek-balance
```

### 通过 Creator 模式的 `plugin_manager` 工具

`install_bundle` 的 `target` 用上面的 GitHub spec 或本地绝对路径都可以：

```text
install_bundle
  target: https://github.com/jizhi0v0/dsh-plugins.git#path:/packages/deepseek-balance
```

安装后读取返回的 `application` 字段；只有 `applied` 才表示已经在运行中的 composition 里生效。

## 使用

- **状态条**：显示 DeepSeek 标识、主要余额（优先 CNY）和可用状态圆点。
- **刷新按钮**：立即请求一次余额，绕过 Host 的 15 秒缓存。
- **齿轮**：展开卡片并直接进入设置区域。
- **API Key**：只提交给 DSH Host；浏览器端不会再次读回完整 Key，只显示末四位。
- **自动刷新**：保存在浏览器 `localStorage` 的 `dsh-deepseek-balance.refreshMs`，只影响刷新频率，不影响 Key。

## 数据与安全

- API Key 由 Host 半保存到：

  ```text
  $DSH_HOME/deepseek-balance/config.json
  # 未设置 DSH_HOME 时为 ~/.dsh/deepseek-balance/config.json
  ```

  文件权限为 `0600`，目录为 `0700`。Key 以明文 JSON 保存，和大多数本地 CLI 配置一样；如果机器多人共用，请自行评估。
- 浏览器只向 **同源** 路由 `/dsh-deepseek-balance/state` 和 `/dsh-deepseek-balance/key` 发请求，不会直接携带 Key 访问外网。
- Host 半只访问 `https://api.deepseek.com`，不把 Key 写入日志。
- 路由复用 DSH 的 `connection.requestRejection`（Host/Origin 校验 + 浏览器登录态）；没有该服务时退化为仅允许 loopback 且同 Origin。
- 请求体限制 8 KiB；余额结果缓存 15 秒，避免频繁打官方接口。

## 工作原理

```text
Browser (client.js)                 Host (index.js)                DeepSeek
─────────────────────               ───────────────                ────────
GET  /dsh-deepseek-balance/state ─▶ read config, cache 15s
                                     └─ GET /user/balance ────────▶ api.deepseek.com
POST /dsh-deepseek-balance/key   ─▶ write config (0600), refresh
```

- Host 半注册两个 exact 路由到 `ctx.webServer`，并在 `ctx.inject(['webServer'])` 中挂载，卸载时自动移除。
- Client 半通过 `ctx.slots.inject('conversation.composer.dock', ...)` 注册一个 React 组件；样式全部使用 `--dsw-alias-*` / `--dsw-*` 主题变量，跟随明暗主题。
- 不使用 iframe、不读写其他插件的 DOM、不引入第三方 UI 依赖。

## 开发与验证

```bash
# 语法检查
node --check packages/deepseek-balance/index.js
node --check packages/deepseek-balance/client.js

# 单元测试（Host 路由、官方响应解析、Key 存储、权限、缓存）
node --test packages/deepseek-balance/test/*.test.mjs
```

当前验证情况：

- ✅ Host 端 14 个单元测试通过（响应归一化、401/429/5xx/超时/网络错误、Key 校验与掩码、文件权限、路由鉴权/方法/缓存/清除）。
- ✅ 1 个真实 `node:http` 集成测试通过（实际 HTTP 请求下的 no-key、保存、读取、405）。
- ✅ Client 端 2 个测试通过（模块注册 id、注入服务、slot 注册、zh/en 字典键完整、静态文案 key 覆盖）。
- ✅ `package.json`、`cordis.patch.yml`、`locale/*.json`、`icon.svg` 均可解析。
- ⚠️ 尚未在当前运行中的 DSH profile 里安装，因此 **没有做真实浏览器渲染验证**。安装后请确认：状态条出现、明暗主题正常、保存 Key 后能读到余额、刷新与自动刷新生效。

## 已知限制

- 只显示官方余额接口能提供的信息，不包含按模型拆分的 token 用量或账单明细。
- 需要 DSH 的 Web host（`ctx.webServer`）；纯 `file://` 加载的 Electron 壳没有同源路由，会显示“插件后端未挂载”。
- 如果 DSH 升级后修改了 `connection.requestRejection` 或 slot 名称，需要同步适配。
- Key 明文落盘；后续可以改为复用 DSH 的凭据服务或系统钥匙串。

## 文件结构

```text
packages/deepseek-balance/
├── package.json          # bundle + client manifest
├── cordis.patch.yml      # 插入 deepseek-balance 行
├── index.js              # Host：路由、官方请求、Key 存储
├── client.js             # Client：composer dock 组件、卡片、设置
├── locale/en.json        # 插件管理器显示元数据（英文）
├── locale/zh.json        # 插件管理器显示元数据（中文）
├── icon.svg              # 原创图标
└── test/                 # node:test 测试
```
