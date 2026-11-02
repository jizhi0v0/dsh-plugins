# Claude 记忆

让 DSH 读取本机 **Claude Code 的记忆**：在 DSH 会话里直接列出、搜索、读取 Claude Code 的 auto memory、用户级 `CLAUDE.md` 与 `rules/*.md`。只读——不写入、不联网。

![插件图标](./icon.svg)

## 功能

模型可用的三个只读工具，外加一段自动注入的记忆索引：

| 工具 | 作用 |
|---|---|
| `claude_memory_list` | 按修改时间从新到旧列出记忆条目（时间、类型、路径、描述）；`project: "all"` 可看全部项目，默认只看当前会话所在项目。 |
| `claude_memory_search` | 对记忆全文做大小写不敏感的子串搜索，按文件新旧返回命中行与行号。 |
| `claude_memory_read` | 读取单个记忆文件（带行号，`offset`/`limit` 分页），路径必须落在 Claude 配置目录内。 |

### 自动索引

插件会把当前项目的 `MEMORY.md` 索引自动注入 DSH 的 runtime context（`ctx.systemPrompt.context`），模型不用先调用 `claude_memory_list` / `claude_memory_search` 就能看到有哪些记忆，再按需用 `claude_memory_read` 读正文。

索引只在 `MEMORY.md` 的 mtime/size 变化时刷新，且只在快照内容变化时由 DSH 追加；只覆盖当前项目，超过 4000 字符优先按行截断（单行超长时按 code point 硬切，不切断 emoji）。

## 记忆在哪

| 来源 | 位置 |
|---|---|
| 项目 auto memory | `~/.claude/projects/<project>/memory/`（`MEMORY.md` 索引 + 每个记忆一个 `.md`） |
| 用户级指令 | `~/.claude/CLAUDE.md` |
| 用户级规则 | `~/.claude/rules/**/*.md` |

设置 `CLAUDE_CONFIG_DIR` 可整体挪走 `~/.claude`，插件会跟随。
> 范围说明：项目级 `CLAUDE.md`/`AGENTS.md` 不在扫描范围——DSH 自带的 `dsh-agent-instructions` 会在每个会话自动加载它们。本插件聚焦 Claude Code 特有的 auto memory 与用户级文件。


`<project>` 的判定与 Claude Code 一致：会话工作目录所在 **git 仓库根目录** 的路径，所有非字母数字字符替换为 `-`；worktree（`.git` 文件指向 `<主仓库>/.git/worktrees/<name>`）归并到主仓库，因此和工作树、子目录共享同一份记忆；不在 git 仓库时用工作目录本身。解析时先试仓库根、再试目录本身，取第一个已存在 `memory/` 的。

## 安装

### 通过 GitHub 直接安装（推荐）

DSH → **Plugins** → **Add plugin**，粘贴：

```text
https://github.com/jizhi0v0/dsh-plugins.git#path:/packages/claude-memory
```

需要固定版本时，用 tag + path（格式如下，先给仓库打对应 tag）：

```text
https://github.com/jizhi0v0/dsh-plugins.git#v0.1.5&path:/packages/claude-memory
```

### 本地路径安装（开发时）

```text
/Users/bobby/Developer/github/dsh-plugins/packages/claude-memory
```

### CLI

```sh
dsh plugin --profile desktop add github:jizhi0v0/dsh-plugins#path:/packages/claude-memory
```

安装后可用 `dsh --profile <name> --dump-config` 确认组合里出现 `id: claude-memory` 行。

## 使用

装好后无须任何配置。自动索引让模型不用被提醒也能发现旧结论，例如：

- 「给设置页加个自定义返回按钮，别把左滑返回弄没了」→ 模型从索引看到 `swiftui-ios26-navigation-facts`，主动 `claude_memory_read` 读这条实测结论
- 「看看我在 Claude 里记过哪些和发版有关的规则」→ 模型调用 `claude_memory_search { query: "发版" }`
- 「列出这个项目 Claude 的记忆」→ `claude_memory_list`（当前项目）
- 「其他项目都记了什么」→ `claude_memory_list { project: "all" }`
- 「把 deploy-notes 那条完整读出来」→ `claude_memory_read { file: "projects/<project>/memory/deploy-notes.md" }`

## 数据与安全

- **只读**：不写任何文件、不发任何网络请求。
- 读取路径被限制在 Claude 配置目录内（`claude_memory_read` 会拒绝 `..` 与目录外绝对路径）。
- 扫描跳过大于 2 MB 的文件；单次读取输出上限 64 KB，超出以分页 footer 提示。
- `claude_memory_list` / `claude_memory_search` 输出有 limit（默认 30 / 25），避免一次灌爆上下文。
- 自动索引只读当前项目的 `MEMORY.md`，同步读 + mtime/size 缓存；截断到 4000 字符，索引没变化时 DSH 不会重复注入快照。

## 工作原理

Host 半做两件事，无 Client 半、无界面：

1. 如果宿主提供 `system-prompt` 服务，注册 `systemPrompt.context`（`claude-memory:index`，`interpolate: false`）：每次 prompt 组装时按会话 cwd 同步定位当前项目的 `memory/MEMORY.md`，读不到就返回空字符串；缺失该服务时跳过这一步，三个工具仍然可用；
2. 注册三个面向模型的工具（`ctx.tools.register`）。工具每次执行时：
   - 用 `workingDirectory` 服务（或会话 header 的 `cwd`）取会话目录；
   - 解析 `<project>` 并定位 `memory/` 目录与用户级文件；
   - 扫描 `.md`，解析 Claude Code 写的轻量 frontmatter（`name`/`description`/`metadata.type`/`modified`，缺失时回退文件名、首行与 mtime）；
   - 返回排序后的纯文本。

## 开发与验证

```bash
# 语法检查（仓库根目录）
npm run check

# 单元测试（仓库根目录）
npm test
```

测试覆盖：工具注册面（三个工具名、参数 schema 属于 DSH 受支持子集、`output.render`）、`projectSlug`、git 根 / worktree 解析（异步与同步两套）、`resolveMemoryProject` 回退、frontmatter 解析、自动索引（子目录归并到仓库根、worktree、无索引返回空、4000 字符截断、代理对安全、mtime/size 缓存刷新、`interpolate: false` 的 context 注册）、三个工具的真实读写行为（伪造 `~/.claude` 树：列表排序、全项目列举、子串搜索、大小写不敏感、行号、分页、路径越界拒绝、参数校验）。

### 当前验证情况（2026-11-02）

- ✅ 仓库测试：`npm run check`、`npm test` 通过；本插件 24 个测试（整套 75 个）。
- ✅ 自动索引：用 agent-loop 实际使用的 `assembleContextFor()` + 真实 `SystemPrompt.assemble()`（Electron + app.asar）组装，出现 `claude-memory:index`，快照包含本仓库 `MEMORY.md` 的真实条目；含字面 `{{bogus}}` 的记忆不触发插值错误。
- ✅ DSH Desktop 实测（2026-11-02）：把 v0.1.5 文件装进 `~/.dsh/profiles/desktop/node_modules/dsh-claude-memory/`，用一次 profile 配置变更触发 HMR 重载后，当前会话的 runtime context 直接出现了本仓库 `MEMORY.md` 索引；随后模型按索引主动 `claude_memory_read` 了 `dsh-plugin-verify-headless.md`。
- ⚠️ desktop profile 的依赖声明仍是 GitHub `v0.1.4`（运行中的已安装副本是 v0.1.5）。要变成真正的本地 link，请在 Plugins 页 Remove 后用本地路径 Add，或重新按 v0.1.5 tag 安装。

## 已知限制

- 自动索引依赖 `system-prompt` 服务（`dsh-base` 默认包含）；缺失时插件仍注册三个工具，只是不注入索引。
- 不识别 Claude Code 的 `autoMemoryDirectory` 设置覆盖与 `CLAUDE_CODE_PROJECT_DIR_NAME` 环境变量（按默认布局读）。
- 搜索是子串匹配，不是正则或语义检索。
- 位于配置目录内的符号链接会被跟随（`rules/`、`MEMORY.md` 都适用，属预期行为）。
- 自动索引只读 `MEMORY.md`：索引缺失、过期或描述写得太含糊时，模型仍然发现不了对应记忆；只覆盖当前项目，其他项目仍需 `project: "all"`。
- 缓存按 mtime+size 判断：同一毫秒内、长度相同的改写不会触发刷新（概率极低）。
- 索引进入会话历史后，后续请求都会带上，直到压缩：当前仓库快照约 1.4K 字符；满 4000 个 CJK 字符可能到 2–3k token，记忆特别多的项目建议保持 `MEMORY.md` 精简。

## 文件结构

```text
packages/claude-memory/
├── package.json          # bundle manifest（dsh.bundle.patch）
├── cordis.patch.yml      # 插入 claude-memory 行
├── index.js              # Host：三个工具 + 自动索引
├── locale/en.json        # 插件管理器显示元数据（英文）
├── locale/zh.json        # 插件管理器显示元数据（中文）
├── icon.svg              # 原创图标
├── test/                 # node:test 测试
└── README.md
```
